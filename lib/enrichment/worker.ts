import { createAiGenerationLedger } from "@/lib/ai/ledger";
import { aiGatewayConfigured } from "@/lib/ai/policy";
import { AiGenerationError, generateStructuredAi } from "@/lib/ai/router";
import {
  requiredFieldCompletionError,
  requiredFieldProposalLineageError,
  type RequiredFieldPendingChange,
} from "@/lib/claude-job-completion";
import {
  boundSources,
  boundedText,
  emailOrganizationDomain,
  extractProfileLinks,
  instagramProfileText,
  linkedinCandidatesFromSearch,
  linkedinProfileText,
  nameTokens,
  profileCandidatesFromSearch,
  searchResultsFromApify,
  searchResultsText,
  textNamesPerson,
  urlKey,
  type EnrichmentSource,
  type SearchResult,
} from "@/lib/enrichment/evidence";
import {
  buildEnrichmentProposals,
  enrichmentFields,
  enrichmentOutputSchema,
  enrichmentPrompt,
  enrichmentPromptVersion,
  enrichmentWorkerSource,
  normalizeEnrichmentOutput,
  requiredFieldDispositions,
  type EnrichmentContactSnapshot,
  type EnrichmentModelOutput,
  type ExistingProposal,
} from "@/lib/enrichment/proposals";
import {
  apifySpendTracker,
  fetchWebsite,
  fetchWebsiteWithFallback,
  runResearchActor,
  type WebsiteFetchResult,
} from "@/lib/enrichment/research";
import {
  enrichmentMaxAttempts,
  enrichmentQueueStaleHours,
  enrichmentRetryDelaySeconds,
  enrichmentStaleLeaseMinutes,
  utcDayStart,
  workerCanProcessJob,
} from "@/lib/enrichment/schedule";
import { enrichmentPace } from "@/lib/automation/enrichment-settings";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import type { AdminClient } from "@/lib/server-action-context";

type JobRow = {
  id: string;
  tenant_id: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  attempts: number;
  created_at: string;
  locked_at?: string | null;
};

type TenantRow = { id: string; name: string | null; settings: unknown };

type JobOutcome = {
  job_id: string;
  contact_id: string | null;
  status: "succeeded" | "retrying" | "failed" | "cancelled";
  proposals: number;
  error?: string;
};

const contactColumns = [
  "id",
  "full_name",
  "email",
  "source",
  "created_at",
  "archived_at",
  ...enrichmentFields,
].filter((column, index, all) => all.indexOf(column) === index);

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Contact enrichment failed.")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 400);
}

function dateOnly(value: unknown) {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

async function audit(
  admin: AdminClient,
  row: { tenant_id: string; action: string; record_id: string; after?: unknown; before?: unknown; metadata?: unknown },
) {
  await admin.from("audit_log").insert({
    tenant_id: row.tenant_id,
    actor_type: "system",
    action: row.action,
    table_name: "jobs",
    record_id: row.record_id,
    before: row.before ?? null,
    after: row.after ?? null,
    metadata: row.metadata ?? {},
  });
}

async function runningContactIds(admin: AdminClient, tenantId: string) {
  const { data } = await admin
    .from("jobs")
    .select("payload")
    .eq("tenant_id", tenantId)
    .eq("job_type", "contact_enrichment")
    .eq("status", "running")
    .limit(200);
  return new Set(
    ((data ?? []) as Array<{ payload: Record<string, unknown> }>)
      .map((row) => objectValue(row.payload).contact_id)
      .filter((id): id is string => typeof id === "string"),
  );
}

/**
 * Claim the next due job whose person is not already being researched, so two
 * queue entries for one person never run side by side.
 */
async function claimNextJob(
  admin: AdminClient,
  tenantId: string,
  now: Date,
  busyContactIds: Set<string>,
): Promise<JobRow | null> {
  const nowIso = now.toISOString();
  const { data, error } = await admin
    .from("jobs")
    .select("id, tenant_id, status, payload, result, attempts, created_at")
    .eq("tenant_id", tenantId)
    .eq("job_type", "contact_enrichment")
    .eq("status", "queued")
    .lte("run_after", nowIso)
    .order("run_after", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(`Enrichment queue could not be read: ${error.message}`);

  for (const candidate of (data ?? []) as JobRow[]) {
    const payload = objectValue(candidate.payload);
    if (!workerCanProcessJob(payload)) continue;
    if (busyContactIds.has(String(payload.contact_id))) continue;
    const { data: claimed, error: claimError } = await admin
      .from("jobs")
      .update({
        status: "running",
        attempts: candidate.attempts + 1,
        locked_at: nowIso,
        result: {
          ...objectValue(candidate.result),
          claimed_at: nowIso,
          claimed_from: enrichmentWorkerSource,
          worker_claimed_at: nowIso,
        },
      })
      .eq("tenant_id", tenantId)
      .eq("id", candidate.id)
      .eq("status", "queued")
      .select("id, tenant_id, status, payload, result, attempts, created_at")
      .maybeSingle();
    if (claimError) throw new Error(`Enrichment job could not be claimed: ${claimError.message}`);
    if (claimed) {
      busyContactIds.add(String(payload.contact_id));
      await audit(admin, {
        tenant_id: tenantId,
        action: "job.claimed",
        record_id: candidate.id,
        after: { status: "running", attempts: candidate.attempts + 1 },
        metadata: { job_type: "contact_enrichment", claimed_from: enrichmentWorkerSource },
      });
      return claimed as JobRow;
    }
  }
  return null;
}

async function claimedToday(admin: AdminClient, tenantId: string, now: Date) {
  const { count, error } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("job_type", "contact_enrichment")
    .gte("result->>worker_claimed_at", utcDayStart(now));
  if (error) throw new Error(`Enrichment pace could not be checked: ${error.message}`);
  return count ?? 0;
}

/**
 * AI configuration, budget, or audit-ledger problems are not the job's fault:
 * pause the whole run and hand the attempt back instead of burning retries.
 */
function isSystemProblem(error: unknown) {
  return error instanceof AiGenerationError
    && (error.kind === "configuration" || error.kind === "budget" || error.code === "ledger_write_failed");
}

async function releaseForRetry({
  admin,
  job,
  error,
  now,
}: {
  admin: AdminClient;
  job: JobRow;
  error: unknown;
  now: Date;
}): Promise<JobOutcome["status"]> {
  const classified = error instanceof AiGenerationError ? error : null;
  const message = safeError(error);
  const systemProblem = isSystemProblem(error);
  const terminal = !systemProblem && job.attempts >= enrichmentMaxAttempts;
  const delay = systemProblem ? 21_600 : enrichmentRetryDelaySeconds(job.attempts, classified?.kind ?? null);
  const { error: updateError } = await admin
    .from("jobs")
    .update({
      status: terminal ? "failed" : "queued",
      attempts: systemProblem ? Math.max(job.attempts - 1, 0) : job.attempts,
      locked_at: null,
      run_after: terminal ? undefined : new Date(now.getTime() + delay * 1_000).toISOString(),
      last_error: message,
      result: {
        ...objectValue(job.result),
        last_failure_at: now.toISOString(),
        last_failure_kind: classified?.kind ?? "unavailable",
        last_failure_code: classified?.code ?? "contact_enrichment_failed",
      },
    })
    .eq("tenant_id", job.tenant_id)
    .eq("id", job.id)
    .eq("status", "running");
  if (updateError) throw new Error(`Enrichment failure could not be saved: ${updateError.message}`);
  await audit(admin, {
    tenant_id: job.tenant_id,
    action: terminal ? "job.failed" : "job.retry_scheduled",
    record_id: job.id,
    after: { status: terminal ? "failed" : "queued", retry_after_seconds: terminal ? null : delay },
    metadata: { job_type: "contact_enrichment", error: message, attempts: job.attempts },
  });
  return terminal ? "failed" : "retrying";
}

/** Put back worker jobs whose run died mid-flight (function timeout, deploy). */
async function recoverStaleJobs(admin: AdminClient, now: Date) {
  const cutoff = new Date(now.getTime() - enrichmentStaleLeaseMinutes * 60_000).toISOString();
  const { data, error } = await admin
    .from("jobs")
    .select("id, tenant_id, status, payload, result, attempts, created_at, locked_at")
    .eq("job_type", "contact_enrichment")
    .eq("status", "running")
    .eq("result->>claimed_from", enrichmentWorkerSource)
    .lt("locked_at", cutoff)
    .limit(25);
  if (error) return 0;
  let recovered = 0;
  for (const job of (data ?? []) as JobRow[]) {
    await releaseForRetry({
      admin,
      job,
      error: new Error("The previous run stopped before finishing."),
      now,
    }).then(() => { recovered += 1; }, () => undefined);
  }
  return recovered;
}

type BookContext = {
  contact: EnrichmentContactSnapshot & { email?: string | null; archived_at?: string | null };
  sources: EnrichmentSource[];
  existingProposals: ExistingProposal[];
};

function proposalFields(payload: Record<string, unknown>) {
  const nested = payload.fields ?? payload.contact ?? payload.candidate;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as Record<string, unknown>;
  const field = typeof payload.field === "string" ? payload.field : null;
  const value = payload.proposed_value ?? payload.proposed_addition;
  return field && value !== undefined ? { [field]: value } : {};
}

async function loadBookContext(admin: AdminClient, tenantId: string, contactId: string): Promise<BookContext | null> {
  const { data: contact, error } = await admin
    .from("contacts")
    .select(contactColumns.join(", "))
    .eq("tenant_id", tenantId)
    .eq("id", contactId)
    .maybeSingle();
  if (error) throw new Error(`Contact could not be loaded: ${error.message}`);
  if (!contact) return null;
  const row = contact as unknown as BookContext["contact"];
  if (row.archived_at) return null;

  const dismissedSince = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const [links, content, attendees, pending, dismissed] = await Promise.all([
    admin.from("interaction_contacts").select("interaction_id").eq("tenant_id", tenantId).eq("contact_id", contactId).limit(20),
    admin
      .from("content_items")
      .select("platform, source_url, title, content, published_at")
      .eq("tenant_id", tenantId)
      .eq("contact_id", contactId)
      .order("published_at", { ascending: false })
      .limit(6),
    admin.from("calendar_attendees").select("event_id").eq("tenant_id", tenantId).eq("matched_contact_id", contactId).limit(20),
    admin
      .from("pending_changes")
      .select("status, created_at, payload")
      .eq("tenant_id", tenantId)
      .eq("contact_id", contactId)
      .eq("status", "pending")
      .limit(50),
    admin
      .from("pending_changes")
      .select("status, created_at, payload")
      .eq("tenant_id", tenantId)
      .eq("contact_id", contactId)
      .eq("status", "dismissed")
      .gte("created_at", dismissedSince)
      .limit(50),
  ]);

  const interactionIds = (links.data ?? []).map((link) => link.interaction_id as string);
  const eventIds = (attendees.data ?? []).map((attendee) => attendee.event_id as string);
  const [interactions, transcripts, events] = await Promise.all([
    interactionIds.length
      ? admin
          .from("interactions")
          .select("id, occurred_at, interaction_type, title, summary, source")
          .eq("tenant_id", tenantId)
          .in("id", interactionIds)
          .order("occurred_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    interactionIds.length
      ? admin
          .from("transcripts")
          .select("interaction_id, title, distilled_summary, action_items, occurred_at")
          .eq("tenant_id", tenantId)
          .in("interaction_id", interactionIds)
          .is("purged_at", null)
          .limit(6)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    eventIds.length
      ? admin
          .from("calendar_events")
          .select("title, starts_at, status")
          .eq("tenant_id", tenantId)
          .in("id", eventIds)
          .order("starts_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const sources: EnrichmentSource[] = [];
  const profileLines = [
    `Name: ${row.full_name}`,
    row.email ? `Email: ${row.email}` : null,
    typeof row.source === "string" ? `Added to the Book from: ${row.source}` : null,
    dateOnly(row.created_at) ? `Added on: ${dateOnly(row.created_at)}` : null,
    ...enrichmentFields
      .filter((field) => {
        const value = row[field];
        return Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim();
      })
      .map((field) => `${field}: ${Array.isArray(row[field]) ? (row[field] as string[]).join("; ") : row[field]}`),
  ].filter(Boolean);
  sources.push({
    id: "B1",
    kind: "book_profile",
    label: "Book profile",
    url: null,
    observed_at: null,
    text: profileLines.join("\n"),
  });

  const transcriptByInteraction = new Map(
    ((transcripts.data ?? []) as Record<string, unknown>[]).map((transcript) => [transcript.interaction_id, transcript]),
  );
  let noteIndex = 0;
  for (const interaction of (interactions.data ?? []) as Record<string, unknown>[]) {
    const transcript = transcriptByInteraction.get(interaction.id) as Record<string, unknown> | undefined;
    const summary = typeof interaction.summary === "string" ? interaction.summary : "";
    const distilled = typeof transcript?.distilled_summary === "string" ? transcript.distilled_summary : "";
    const actionItems = Array.isArray(transcript?.action_items)
      ? (transcript.action_items as unknown[])
          .map((item) => (typeof item === "string" ? item : typeof objectValue(item).text === "string" ? objectValue(item).text : null))
          .filter(Boolean)
      : [];
    const text = [
      summary,
      distilled && distilled !== summary ? distilled : "",
      actionItems.length && !summary.includes(String(actionItems[0])) ? `Action items: ${actionItems.join("; ")}` : "",
    ].filter(Boolean).join("\n");
    if (!text.trim()) continue;
    noteIndex += 1;
    const date = dateOnly(interaction.occurred_at);
    sources.push({
      id: `N${noteIndex}`,
      kind: transcript ? "meeting_notes" : "interaction",
      label: `${transcript ? "Call notes" : "Logged interaction"}: ${boundedText(interaction.title, 80) || "untitled"}${date ? ` (${date})` : ""}`,
      url: null,
      observed_at: date,
      text,
    });
  }

  const eventLines = ((events.data ?? []) as Record<string, unknown>[])
    .filter((event) => event.status !== "cancelled")
    .map((event) => `${dateOnly(event.starts_at) ?? "undated"} · ${boundedText(event.title, 160)}`);
  if (eventLines.length) {
    sources.push({ id: "C1", kind: "calendar", label: "Calendar meetings", url: null, observed_at: null, text: eventLines.join("\n") });
  }

  const posts = ((content.data ?? []) as Record<string, unknown>[]).map((item) =>
    [
      `${dateOnly(item.published_at) ?? "undated"} · ${item.platform} · ${item.source_url}`,
      boundedText(item.title, 200),
      boundedText(item.content, 700),
    ].filter(Boolean).join("\n"),
  );
  if (posts.length) {
    sources.push({
      id: "P1",
      kind: "social_post",
      label: "Their recent posts (from the Book's social scans)",
      url: null,
      observed_at: dateOnly((content.data?.[0] as Record<string, unknown> | undefined)?.published_at),
      text: posts.join("\n\n"),
    });
  }

  const existingProposals: ExistingProposal[] = [...(pending.data ?? []), ...(dismissed.data ?? [])].map((proposal) => ({
    status: String(proposal.status),
    created_at: String(proposal.created_at),
    fields: proposalFields(objectValue(proposal.payload)),
  }));

  return { contact: row, sources, existingProposals };
}

function websiteSource(id: string, result: WebsiteFetchResult): EnrichmentSource | null {
  if (!result.ok) return null;
  const page = result.page;
  const host = (() => {
    try {
      return new URL(result.finalUrl).hostname.replace(/^www\./, "");
    } catch {
      return result.finalUrl;
    }
  })();
  const socialLinks = Object.values(extractProfileLinks(page.links)).flat();
  return {
    id,
    kind: "website",
    label: `Website: ${host}${new URL(result.finalUrl).pathname.length > 1 ? new URL(result.finalUrl).pathname : ""}`,
    url: result.finalUrl,
    observed_at: new Date().toISOString().slice(0, 10),
    text: [
      page.title ? `Title: ${page.title}` : null,
      page.description ? `Description: ${page.description}` : null,
      socialLinks.length ? `Profile links on this site: ${socialLinks.join(" ")}` : null,
      page.text,
    ].filter(Boolean).join("\n"),
  };
}

function aboutPageLink(result: WebsiteFetchResult) {
  if (!result.ok) return null;
  const host = new URL(result.finalUrl).hostname;
  return result.page.links.find((link) => {
    try {
      const url = new URL(link);
      return url.hostname === host && /\/(about|about-us|about-me|bio|team)\/?$/i.test(url.pathname);
    } catch {
      return false;
    }
  }) ?? null;
}

const aggregatorHosts = /(^|\.)(linkedin|instagram|facebook|x|twitter|youtube|tiktok|crunchbase|zoominfo|rocketreach|apollo|signalhire|contactout|wikipedia|pinterest|medium|substack|podcasts\.apple|spotify|amazon|yelp|glassdoor|indeed)\./i;

/** A search hit that looks like the person's own site (their name in the domain). */
function personalSiteFromSearch(
  results: SearchResult[],
  fullName: string,
  companyName: string | null,
  skip: Set<string>,
) {
  const tokens = nameTokens(fullName);
  const companyTokens = nameTokens(companyName ?? "");
  return results.find((result) => {
    try {
      const host = new URL(result.url).hostname.toLowerCase().replace(/^www\./, "");
      if (aggregatorHosts.test(`.${host}`) || skip.has(host)) return false;
      const bare = host.replace(/[^a-z0-9]/g, "");
      if (tokens.length >= 2 && tokens.every((token) => bare.includes(token))) return true;
      const resultText = `${result.title} ${result.description}`;
      return textNamesPerson(resultText, fullName)
        && companyTokens.length > 0
        && companyTokens.some((token) => bare.includes(token) || resultText.toLowerCase().includes(token));
    } catch {
      return false;
    }
  })?.url ?? null;
}

/** Saved profile URLs are typed by hand; accept "example.com" as https://example.com. */
function savedUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`;
}

type Research = { sources: EnrichmentSource[]; checked: string[]; apify: Awaited<ReturnType<typeof apifySpendTracker>> };

async function researchPublicSources({
  admin,
  tenantId,
  plan,
  job,
  context,
  now,
}: {
  admin: AdminClient;
  tenantId: string;
  plan: ReturnType<typeof normalizeTenantSettings>["providers"]["apify"];
  job: JobRow;
  context: BookContext;
  now: Date;
}): Promise<Research> {
  const contact = context.contact;
  const sources: EnrichmentSource[] = [];
  const checked: string[] = ["Book profile and notes"];
  const tracker = await apifySpendTracker({ admin, tenantId, plan, now });
  const domain = emailOrganizationDomain(contact.email ?? null);
  const savedWebsite = savedUrl(contact.website);
  const primaryUrl = savedWebsite ?? (domain ? `https://${domain}` : null);
  const actorArgs = { admin, tenantId, plan, tracker, jobId: job.id, contactId: contact.id };

  const company = typeof contact.company_name === "string" ? contact.company_name : null;
  const initialDiscovery = ["manual_add", "calendar_review", "approved_new_contact"]
    .includes(String(job.payload.trigger ?? ""));
  const needsSearch = initialDiscovery || !contact.linkedin || !savedWebsite || !company;
  const identityQuery = [`"${contact.full_name}"`, company ? `"${company}"` : domain]
    .filter(Boolean)
    .join(" ");
  const searchQueries = initialDiscovery
    ? [
        identityQuery,
        `"${contact.full_name}" podcast`,
        `"${contact.full_name}" LinkedIn Instagram YouTube Facebook Twitter`,
      ]
    : [identityQuery];
  const query = searchQueries.join("\n");
  const [site, searchItems] = await Promise.all([
    primaryUrl ? fetchWebsiteWithFallback(primaryUrl) : Promise.resolve(null),
    needsSearch
      ? runResearchActor({
          ...actorArgs,
          kind: "search",
          input: {
            queries: query,
            maxPagesPerQuery: 1,
            saveHtml: false,
            saveHtmlToKeyValueStore: false,
            includeIcons: false,
          },
        })
      : Promise.resolve([] as unknown[]),
  ]);

  const healthNotes: string[] = [];
  let siteResult: WebsiteFetchResult | null = null;
  if (site && primaryUrl) {
    checked.push(`Website ${primaryUrl}`);
    // A plain-HTTP fallback only informs the health note; it is not treated as their site.
    siteResult = site.primary;
    if (!site.primary.ok) {
      healthNotes.push(`${primaryUrl}: ${site.primary.problem}`);
      if (site.fallback) {
        healthNotes.push(
          site.fallback.ok
            ? `Plain HTTP version loads, titled "${site.fallback.page.title ?? "untitled"}".`
            : `Plain HTTP version: ${site.fallback.problem}`,
        );
      }
    }
    const main = websiteSource("W1", siteResult);
    if (main) sources.push(main);
  }

  const searchResults = searchResultsFromApify(searchItems);
  if (needsSearch) {
    const searchError = tracker.errors.find((entry) => entry.actor.includes("google-search"));
    checked.push(
      searchResults.length
        ? `Google discovery search for ${contact.full_name}`
        : searchError
          ? `Google search failed (${searchError.error})`
          : tracker.allowed
            ? `Google discovery search for ${contact.full_name} (no results)`
            : `Google search skipped (${tracker.reason ?? "unavailable"})`,
    );
  }
  if (searchResults.length) {
    sources.push({
      id: "S1",
      kind: "search_results",
      label: `Google identity, social, and podcast results for ${contact.full_name}`,
      url: null,
      observed_at: now.toISOString().slice(0, 10),
      text: searchResultsText(searchResults),
    });
  }

  // Second pages: the site's about page, or the person's own site found by search when the saved one failed.
  const skipHosts = new Set<string>();
  if (siteResult?.ok) skipHosts.add(new URL(siteResult.finalUrl).hostname.replace(/^www\./, ""));
  const aboutUrl = siteResult ? aboutPageLink(siteResult) : null;
  const personalUrl = !siteResult?.ok || site?.primary.ok === false
    ? personalSiteFromSearch(searchResults, contact.full_name, company, skipHosts)
    : null;
  const secondUrl = personalUrl ?? aboutUrl;
  if (secondUrl) {
    const second = await fetchWebsite(secondUrl);
    checked.push(`Website ${secondUrl}`);
    const source = websiteSource("W2", second);
    if (source) sources.push(source);
    else if (!second.ok) healthNotes.push(`${secondUrl}: ${second.problem}`);
  }
  if (healthNotes.length) {
    sources.push({
      id: "H1",
      kind: "site_health",
      label: "Website check",
      url: primaryUrl,
      observed_at: now.toISOString().slice(0, 10),
      text: healthNotes.join("\n"),
    });
  }

  // Social profiles: saved values first, then links on their own site, then a name-matched search hit.
  const ownSiteLinks = extractProfileLinks(
    sources.filter((source) => source.kind === "website").flatMap((source) => [source.text]),
  );
  const searchedProfileLinks = profileCandidatesFromSearch(searchResults, contact.full_name);
  const savedLinkedin = savedUrl(contact.linkedin);
  const linkedinUrl = savedLinkedin
    ?? ownSiteLinks.linkedin[0]
    ?? linkedinCandidatesFromSearch(searchResults, contact.full_name)[0]
    ?? null;
  const savedInstagram = savedUrl(contact.instagram);
  const instagramUrl = savedInstagram
    ?? ownSiteLinks.instagram[0]
    ?? searchedProfileLinks.instagram[0]
    ?? null;
  const instagramHandle = instagramUrl?.match(/instagram\.com\/([A-Za-z0-9._]{1,30})/i)?.[1] ?? null;

  const [linkedinItems, instagramItems] = await Promise.all([
    linkedinUrl
      ? runResearchActor({
          ...actorArgs,
          kind: "linkedin",
          input: { urls: [linkedinUrl], profileScraperMode: "Profile details no email ($4 per 1k)" },
        })
      : Promise.resolve([] as unknown[]),
    instagramHandle
      ? runResearchActor({ ...actorArgs, kind: "instagram", input: { usernames: [instagramHandle] } })
      : Promise.resolve([] as unknown[]),
  ]);
  if (linkedinUrl) checked.push(`LinkedIn ${linkedinUrl}`);
  if (instagramHandle) checked.push(`Instagram @${instagramHandle}`);
  const linkedinText = linkedinItems.length ? linkedinProfileText(linkedinItems[0]) : "";
  if (linkedinText && linkedinUrl) {
    sources.push({
      id: "L1",
      kind: "linkedin_profile",
      label: `LinkedIn ${urlKey(linkedinUrl).replace(/^linkedin\.com/, "")}`,
      url: linkedinUrl,
      observed_at: now.toISOString().slice(0, 10),
      text: linkedinText,
    });
  }
  const instagramText = instagramItems.length ? instagramProfileText(instagramItems[0]) : "";
  if (instagramText && instagramUrl) {
    sources.push({
      id: "I1",
      kind: "instagram_profile",
      label: `Instagram @${instagramHandle}`,
      url: instagramUrl,
      observed_at: now.toISOString().slice(0, 10),
      text: instagramText,
    });
  }
  if (!tracker.allowed && tracker.reason) checked.push(`Social research limited: ${tracker.reason}`);
  return { sources, checked, apify: tracker };
}

async function createProposals({
  admin,
  job,
  contactId,
  proposals,
}: {
  admin: AdminClient;
  job: JobRow;
  contactId: string;
  proposals: ReturnType<typeof buildEnrichmentProposals>["proposals"];
}) {
  const created: Array<{ id: string; fields: Record<string, unknown> }> = [];
  for (const proposal of proposals) {
    const { data, error } = await admin.rpc("lbb_create_pending_change", {
      p_tenant_id: job.tenant_id,
      p_idempotency_key: proposal.idempotencyKey,
      p_contact_id: contactId,
      p_change_type: "contact_enrichment",
      p_summary: proposal.summary,
      p_payload: proposal.payload,
      p_source: enrichmentWorkerSource,
      p_risk_level: proposal.riskLevel,
    });
    if (error) throw new Error(`Proposal could not be saved: ${error.message}`);
    const id = objectValue(data).id;
    if (typeof id === "string") created.push({ id, fields: objectValue(proposal.payload.fields) });
  }
  return created;
}

/**
 * Other queued entries for the same person (an approval follow-up next to a
 * profile-gap refresh, say) are covered by the research just finished.
 * Entries that need a person in the loop are left alone.
 */
async function closeCoveredSiblingJobs(admin: AdminClient, job: JobRow, contactId: string) {
  const { data } = await admin
    .from("jobs")
    .select("id, payload, result")
    .eq("tenant_id", job.tenant_id)
    .eq("job_type", "contact_enrichment")
    .eq("status", "queued")
    .contains("payload", { contact_id: contactId })
    .neq("id", job.id)
    .limit(20);
  const siblings = ((data ?? []) as Array<{ id: string; payload: Record<string, unknown>; result: Record<string, unknown> | null }>)
    .filter((sibling) => workerCanProcessJob(objectValue(sibling.payload)));
  for (const sibling of siblings) {
    await admin
      .from("jobs")
      .update({
        status: "cancelled",
        result: {
          ...objectValue(sibling.result),
          outcome: "covered_by_job",
          covered_by_job_id: job.id,
          completed_from: enrichmentWorkerSource,
        },
      })
      .eq("tenant_id", job.tenant_id)
      .eq("id", sibling.id)
      .eq("status", "queued");
  }
  return siblings.length;
}

async function completeJob({
  admin,
  job,
  contactId,
  created,
  completion,
}: {
  admin: AdminClient;
  job: JobRow;
  contactId: string;
  created: Array<{ id: string; fields: Record<string, unknown> }>;
  completion: Record<string, unknown>;
}) {
  const createdIds = created.map((row) => row.id);
  const coverageError = requiredFieldCompletionError({
    jobPayload: job.payload,
    completionResult: completion,
    createdPendingChangeIds: createdIds,
    createdInteractionIds: [],
  });
  if (coverageError) throw new Error(coverageError);
  if (createdIds.length) {
    const { data, error } = await admin
      .from("pending_changes")
      .select("id, contact_id, change_type, payload, status, created_at")
      .eq("tenant_id", job.tenant_id)
      .in("id", createdIds);
    if (error) throw new Error(`Created proposals could not be checked: ${error.message}`);
    const lineageError = requiredFieldProposalLineageError({
      jobId: job.id,
      jobPayload: job.payload,
      jobCreatedAt: job.created_at,
      completionResult: completion,
      expectedContactId: contactId,
      pendingChanges: (data ?? []) as RequiredFieldPendingChange[],
    });
    if (lineageError) throw new Error(lineageError);
  }
  const completedAt = new Date().toISOString();
  const result = {
    ...objectValue(job.result),
    ...completion,
    created_pending_change_ids: createdIds,
    created_interaction_ids: [],
    completed_at: completedAt,
    completed_from: enrichmentWorkerSource,
  };
  const { data: updated, error } = await admin
    .from("jobs")
    .update({ status: "succeeded", result, locked_at: null, last_error: null })
    .eq("tenant_id", job.tenant_id)
    .eq("id", job.id)
    .eq("status", "running")
    .select("id")
    .maybeSingle();
  if (error || !updated) throw new Error(error?.message ?? "Enrichment job was no longer running.");
  await Promise.all([
    audit(admin, {
      tenant_id: job.tenant_id,
      action: "job.completed",
      record_id: job.id,
      before: { status: "running" },
      after: { status: "succeeded", outcome: completion.outcome },
      metadata: { job_type: "contact_enrichment", contact_id: contactId, created_pending_change_ids: createdIds },
    }),
    admin.from("usage_events").insert({
      tenant_id: job.tenant_id,
      actor_type: "system",
      event_type: "job_completed",
      quantity: 1,
      unit: "job",
      metadata: { job_id: job.id, job_type: "contact_enrichment", completed_from: enrichmentWorkerSource, created_pending_change_ids: createdIds },
    }),
  ]);
}

/**
 * Another active record with the same email that was added earlier means this
 * one is a duplicate: researching both doubles the owner's review queue, so the
 * worker flags it for a merge instead.
 */
async function olderRecordWithSameEmail(
  admin: AdminClient,
  tenantId: string,
  contact: BookContext["contact"],
) {
  const email = typeof contact.email === "string" ? contact.email.trim() : "";
  if (!email || typeof contact.created_at !== "string") return null;
  const { data } = await admin
    .from("contacts")
    .select("id, full_name, created_at")
    .eq("tenant_id", tenantId)
    .ilike("email", email.replace(/[%_\\]/g, (char) => `\\${char}`))
    .is("archived_at", null)
    .neq("id", contact.id)
    .lt("created_at", contact.created_at)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { id: string; full_name: string } | null) ?? null;
}

/** The "how I know them" labels this Book already uses, most common first. */
async function howIKnowThemLabels(admin: AdminClient, tenantId: string) {
  const { data } = await admin
    .from("contacts")
    .select("how_i_know_them")
    .eq("tenant_id", tenantId)
    .not("how_i_know_them", "is", null)
    .limit(2000);
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ how_i_know_them: string[] | null }>) {
    for (const label of row.how_i_know_them ?? []) {
      const clean = label?.trim();
      if (clean && clean.length <= 80) counts.set(clean, (counts.get(clean) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([label]) => label);
}

async function processJob({
  admin,
  tenant,
  job,
  now,
}: {
  admin: AdminClient;
  tenant: TenantRow;
  job: JobRow;
  now: Date;
}): Promise<JobOutcome> {
  const contactId = String(job.payload.contact_id);
  const context = await loadBookContext(admin, job.tenant_id, contactId);
  if (!context) {
    await admin
      .from("jobs")
      .update({
        status: "cancelled",
        locked_at: null,
        result: { ...objectValue(job.result), outcome: "contact_missing", completed_from: enrichmentWorkerSource },
      })
      .eq("tenant_id", job.tenant_id)
      .eq("id", job.id)
      .eq("status", "running");
    return { job_id: job.id, contact_id: contactId, status: "cancelled", proposals: 0 };
  }

  const duplicateOf = await olderRecordWithSameEmail(admin, job.tenant_id, context.contact);
  if (duplicateOf) {
    await admin
      .from("jobs")
      .update({
        status: "cancelled",
        locked_at: null,
        result: {
          ...objectValue(job.result),
          outcome: "duplicate_contact",
          duplicate_of_contact_id: duplicateOf.id,
          completed_from: enrichmentWorkerSource,
        },
      })
      .eq("tenant_id", job.tenant_id)
      .eq("id", job.id)
      .eq("status", "running");
    await audit(admin, {
      tenant_id: job.tenant_id,
      action: "contact_enrichment.duplicate_contact",
      record_id: job.id,
      metadata: { contact_id: contactId, duplicate_of_contact_id: duplicateOf.id, full_name: duplicateOf.full_name },
    }).catch(() => undefined);
    return { job_id: job.id, contact_id: contactId, status: "cancelled", proposals: 0 };
  }
  const tenantSettings = normalizeTenantSettings(tenant.settings);
  const howIKnowThemVocabulary = await howIKnowThemLabels(admin, job.tenant_id);
  const research = await researchPublicSources({
    admin,
    tenantId: job.tenant_id,
    plan: tenantSettings.providers.apify,
    job,
    context,
    now,
  });
  const sources = boundSources([...context.sources, ...research.sources], 70_000);
  const prompt = enrichmentPrompt({
    contact: context.contact,
    ownerName: tenant.name,
    today: now.toISOString().slice(0, 10),
    sources,
    howIKnowThemVocabulary,
  });
  const generated = await generateStructuredAi<EnrichmentModelOutput>({
    task: "contact_enrichment",
    system: prompt.system,
    prompt: prompt.prompt,
    schema: enrichmentOutputSchema,
    context: {
      tenantId: job.tenant_id,
      userId: null,
      promptVersion: enrichmentPromptVersion,
      tags: ["trigger:enrichment-cron"],
      ledger: createAiGenerationLedger(admin),
    },
  });
  const normalized = normalizeEnrichmentOutput(generated.output, sources, { howIKnowThemVocabulary });
  const { proposals, skipped } = buildEnrichmentProposals({
    jobId: job.id,
    contact: context.contact,
    facts: normalized.facts,
    identity: normalized.identity,
    siteHealthNotes: normalized.siteHealthNotes,
    existingProposals: context.existingProposals,
    now,
    generation: {
      promptVersion: generated.promptVersion,
      gatewayGenerationId: generated.gatewayGenerationId,
      model: generated.model,
    },
  });
  const created = await createProposals({ admin, job, contactId, proposals });
  const requiredFields = Array.isArray(job.payload.required_fields)
    ? job.payload.required_fields.filter((field): field is string => typeof field === "string")
    : [];
  const sourcesChecked = [...research.checked];
  const completion: Record<string, unknown> = {
    outcome: created.length ? "submitted_changes" : "no_change_needed",
    summary: created.length
      ? `Researched ${sourcesChecked.length} sources and proposed ${created.length} update${created.length === 1 ? "" : "s"} for review.`
      : "Researched the available sources; nothing new could be backed by a source.",
    verification_summary: `Identity ${normalized.identity.status}: ${normalized.identity.reason}`,
    required_field_dispositions: requiredFieldDispositions({
      requiredFields,
      contact: context.contact,
      created,
      sourcesChecked,
      identityReason: normalized.identity.reason,
    }),
    research: {
      sources: sources.map(({ id, kind, label, url }) => ({ id, kind, label, url })),
      sources_checked: sourcesChecked,
      identity: normalized.identity,
      rejected_facts: normalized.rejected,
      skipped_facts: skipped,
      site_health_notes: normalized.siteHealthNotes,
      apify_runs: research.apify.runs,
      apify_errors: research.apify.errors,
      prompt_version: generated.promptVersion,
      gateway_generation_id: generated.gatewayGenerationId,
    },
  };
  await completeJob({ admin, job, contactId, created, completion });
  await closeCoveredSiblingJobs(admin, job, contactId).catch(() => 0);
  return { job_id: job.id, contact_id: contactId, status: "succeeded", proposals: created.length };
}

/**
 * When due jobs have waited longer than a day the queue is not keeping up:
 * log it for Vercel alerts and leave an audit marker (at most every 12 hours)
 * that the Ops page and operators can see.
 */
async function reportStaleQueue(admin: AdminClient, tenantId: string, now: Date) {
  const cutoff = new Date(now.getTime() - enrichmentQueueStaleHours * 3_600_000).toISOString();
  const { data, count, error } = await admin
    .from("jobs")
    .select("id, created_at", { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("job_type", "contact_enrichment")
    .eq("status", "queued")
    .lte("run_after", cutoff)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error || !count) return { stale: 0 };
  const oldest = (data?.[0] as { id: string; created_at: string } | undefined) ?? null;
  console.error("[automation.enrichment] queue_stale", { tenantId, staleJobs: count, oldest: oldest?.created_at });
  const { data: recent } = await admin
    .from("audit_log")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("action", "contact_enrichment.queue_stale")
    .gte("created_at", new Date(now.getTime() - 12 * 3_600_000).toISOString())
    .limit(1)
    .maybeSingle();
  if (!recent && oldest) {
    await audit(admin, {
      tenant_id: tenantId,
      action: "contact_enrichment.queue_stale",
      record_id: oldest.id,
      metadata: { stale_jobs: count, oldest_created_at: oldest.created_at, threshold_hours: enrichmentQueueStaleHours },
    }).catch(() => undefined);
  }
  return { stale: count };
}

async function runClaimedJob(admin: AdminClient, tenant: TenantRow, job: JobRow) {
  try {
    return { outcome: await processJob({ admin, tenant, job, now: new Date() }), systemProblem: null as string | null };
  } catch (caught) {
    const status = await releaseForRetry({ admin, job, error: caught, now: new Date() }).catch(
      () => "failed" as const,
    );
    console.error("contact_enrichment_failed", {
      jobId: job.id,
      tenantId: job.tenant_id,
      attempts: job.attempts,
      error: safeError(caught),
    });
    return {
      outcome: {
        job_id: job.id,
        contact_id: typeof job.payload.contact_id === "string" ? job.payload.contact_id : null,
        status,
        proposals: 0,
        error: safeError(caught),
      } satisfies JobOutcome,
      systemProblem: isSystemProblem(caught) ? safeError(caught) : null,
    };
  }
}

/**
 * Work through queued contact-enrichment jobs for every install at that
 * install's pace (tenants.settings.automation.enrichment), researching the
 * claimed people in parallel and stopping before `deadline`.
 */
export async function processContactEnrichmentQueue({
  admin,
  deadline,
  env = process.env,
}: {
  admin: AdminClient;
  deadline: number;
  env?: Readonly<Record<string, string | undefined>>;
}) {
  if (/^(0|false|no|off)$/i.test(env.LBB_ENRICHMENT_WORKER_ENABLED?.trim() ?? "")) {
    return { status: "disabled" as const, outcomes: [] as JobOutcome[] };
  }
  if (!aiGatewayConfigured(env)) return { status: "ai_not_configured" as const, outcomes: [] as JobOutcome[] };
  const now = new Date();
  const recovered = await recoverStaleJobs(admin, now);
  const { data: tenants, error } = await admin.from("tenants").select("id, name, settings");
  if (error) throw new Error(`Tenants could not be loaded: ${error.message}`);

  const outcomes: JobOutcome[] = [];
  const pace: Array<Record<string, unknown>> = [];
  let paused: string | null = null;
  for (const tenant of (tenants ?? []) as TenantRow[]) {
    const queue = await reportStaleQueue(admin, tenant.id, now);
    const tenantPace = enrichmentPace(normalizeTenantSettings(tenant.settings).automation.enrichment, env, now);
    if (!tenantPace.enabled) {
      pace.push({ tenant_id: tenant.id, status: "disabled", stale_jobs: queue.stale });
      continue;
    }
    const { data: recentPause } = await admin
      .from("audit_log")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("action", "contact_enrichment.paused")
      .gte("created_at", new Date(now.getTime() - 21_600_000).toISOString())
      .limit(1)
      .maybeSingle();
    if (recentPause) {
      pace.push({ tenant_id: tenant.id, status: "paused", stale_jobs: queue.stale });
      continue;
    }
    const already = await claimedToday(admin, tenant.id, now);
    const slots = Math.min(tenantPace.dailyLimit - already, tenantPace.perRunLimit);
    pace.push({
      tenant_id: tenant.id,
      status: tenantPace.catchingUp ? "catching_up" : "normal",
      claimed_today: already,
      daily_limit: tenantPace.dailyLimit,
      catchup_ends_at: tenantPace.catchupEndsAt,
      stale_jobs: queue.stale,
    });
    if (slots <= 0 || Date.now() >= deadline) continue;

    const claimed: JobRow[] = [];
    const busyContactIds = await runningContactIds(admin, tenant.id);
    while (claimed.length < slots) {
      const job = await claimNextJob(admin, tenant.id, new Date(), busyContactIds);
      if (!job) break;
      claimed.push(job);
    }
    const results = await Promise.all(claimed.map((job) => runClaimedJob(admin, tenant, job)));
    outcomes.push(...results.map((result) => result.outcome));
    const problem = results.find((result) => result.systemProblem)?.systemProblem ?? null;
    if (problem) {
      paused = problem;
      await audit(admin, {
        tenant_id: tenant.id,
        action: "contact_enrichment.paused",
        record_id: claimed[0]?.id ?? tenant.id,
        metadata: { error: problem, resumes_after_hours: 6 },
      }).catch(() => undefined);
    }
  }
  return { status: paused ? "paused" as const : "ok" as const, paused, recovered, pace, outcomes };
}
