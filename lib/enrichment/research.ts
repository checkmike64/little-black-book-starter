import { isIP } from "node:net";
import { runApifyActor, apifyTokenConfigured } from "@/lib/integrations/apify";
import { recordProviderUsage } from "@/lib/provider-billing";
import { providerPricingSnapshot, type ProviderPlan } from "@/lib/provider-plans";
import type { AdminClient } from "@/lib/server-action-context";
import { parseHtmlPage, type ParsedPage } from "@/lib/enrichment/evidence";
import { utcMonthStart } from "@/lib/enrichment/schedule";

export type WebsiteFetchResult =
  | { ok: true; requestedUrl: string; finalUrl: string; page: ParsedPage }
  | { ok: false; requestedUrl: string; problem: string };

const blockedHostnames = new Set(["localhost", "metadata.google.internal"]);

function privateAddress(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (blockedHostnames.has(host) || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const version = isIP(host);
  if (version === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (version === 6) {
    return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
  }
  return false;
}

function fetchProblem(error: unknown) {
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  const code = cause?.code ?? (error as { code?: string })?.code ?? "";
  if (/CERT|SSL|TLS|SELF_SIGNED|ALTNAME|UNABLE_TO_VERIFY/i.test(code)) {
    return `Security certificate problem (${code}). Browsers show visitors a warning or block the site.`;
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "Domain does not resolve (DNS lookup failed).";
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return `Server refused the connection (${code}).`;
  if (error instanceof Error && /abort|timeout/i.test(error.name + error.message)) return "No response within 10 seconds.";
  return `Could not load the site${code ? ` (${code})` : ""}.`;
}

async function readCapped(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks).subarray(0, maxBytes));
}

/**
 * Fetch one public web page with manual redirects (max 3), private-address
 * blocking, a 10 second timeout, and a 800 KB read cap.
 */
export async function fetchWebsite(rawUrl: string): Promise<WebsiteFetchResult> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    return { ok: false, requestedUrl: rawUrl, problem: "Saved URL is not a valid web address." };
  }
  for (let hop = 0; hop < 4; hop += 1) {
    if (!["http:", "https:"].includes(current.protocol) || privateAddress(current.hostname)) {
      return { ok: false, requestedUrl: rawUrl, problem: "Address is not a public website." };
    }
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; LittleBlackBook/1.0; profile research)",
          accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
    } catch (error) {
      return { ok: false, requestedUrl: rawUrl, problem: fetchProblem(error) };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) return { ok: false, requestedUrl: rawUrl, problem: `Redirect (${response.status}) without a destination.` };
      current = new URL(location, current);
      continue;
    }
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, requestedUrl: rawUrl, problem: `Site returned HTTP ${response.status}.` };
    }
    if (type && !/html|text\/plain/i.test(type)) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, requestedUrl: rawUrl, problem: `Not a web page (${type.split(";")[0]}).` };
    }
    const html = await readCapped(response, 800_000);
    return { ok: true, requestedUrl: rawUrl, finalUrl: current.toString(), page: parseHtmlPage(html, current.toString()) };
  }
  return { ok: false, requestedUrl: rawUrl, problem: "Too many redirects." };
}

/** Load a site; if HTTPS fails with a certificate problem, read the HTTP version too so the owner sees what visitors get. */
export async function fetchWebsiteWithFallback(url: string) {
  const primary = await fetchWebsite(url);
  if (primary.ok || !/certificate/i.test(primary.problem) || !url.startsWith("https:")) {
    return { primary, fallback: null as WebsiteFetchResult | null };
  }
  const fallback = await fetchWebsite(url.replace(/^https:/, "http:"));
  return { primary, fallback };
}

/**
 * `reserveUsd` is what the budget check sets aside per call (a typical run
 * costs less). `maxChargeUsd` is the hard ceiling passed to Apify; the Google
 * scraper refuses to start below its $0.50 minimum, while one results page
 * actually costs about $0.004.
 */
export const enrichmentApifyActors = {
  search: { actorId: "apify/google-search-scraper", reserveUsd: 0.01, maxChargeUsd: 0.5 },
  linkedin: { actorId: "harvestapi/linkedin-profile-scraper", reserveUsd: 0.01, maxChargeUsd: 0.05 },
  instagram: { actorId: "apify/instagram-profile-scraper", reserveUsd: 0.01, maxChargeUsd: 0.05 },
} as const;

export type ApifySpendTracker = {
  allowed: boolean;
  reason: string | null;
  spentCents: number;
  limitCents: number;
  runs: Array<{ actor: string; runId: string; status: string; costUsd: number }>;
  /** Actor calls that could not start or failed; kept on the job result for operators. */
  errors: Array<{ actor: string; error: string }>;
};

/** Apify is used only when the tenant plan enables it and this month's spend leaves room. */
export async function apifySpendTracker({
  admin,
  tenantId,
  plan,
  now,
}: {
  admin: AdminClient;
  tenantId: string;
  plan: ProviderPlan;
  now: Date;
}): Promise<ApifySpendTracker> {
  const limitCents = Math.round(plan.monthly_cost_limit_usd * 100);
  if (!plan.enabled) return { allowed: false, reason: "Apify is turned off for this book.", spentCents: 0, limitCents, runs: [], errors: [] };
  if (!apifyTokenConfigured()) return { allowed: false, reason: "Apify is not configured.", spentCents: 0, limitCents, runs: [], errors: [] };
  const { data, error } = await admin
    .from("usage_events")
    .select("provider_cost_cents")
    .eq("tenant_id", tenantId)
    .eq("provider", "apify")
    .gte("created_at", utcMonthStart(now))
    .limit(5_000);
  if (error) return { allowed: false, reason: "Apify spend could not be checked.", spentCents: 0, limitCents, runs: [], errors: [] };
  const spentCents = (data ?? []).reduce(
    (total, row) => total + (typeof row.provider_cost_cents === "number" ? row.provider_cost_cents : 0),
    0,
  );
  return {
    allowed: spentCents < limitCents,
    reason: spentCents < limitCents ? null : "This month's Apify budget is used up.",
    spentCents,
    limitCents,
    runs: [],
    errors: [],
  };
}

/**
 * Run one research actor inside the monthly budget and record its cost as a
 * provider usage event. Returns no items (never throws) when it cannot run.
 */
export async function runResearchActor({
  admin,
  tenantId,
  plan,
  tracker,
  kind,
  input,
  jobId,
  contactId,
}: {
  admin: AdminClient;
  tenantId: string;
  plan: ProviderPlan;
  tracker: ApifySpendTracker;
  kind: keyof typeof enrichmentApifyActors;
  input: Record<string, unknown>;
  jobId: string;
  contactId: string;
}): Promise<unknown[]> {
  const actor = enrichmentApifyActors[kind];
  const reserveCents = Math.ceil(actor.reserveUsd * 100);
  if (!tracker.allowed || tracker.spentCents + reserveCents > tracker.limitCents) {
    tracker.allowed = false;
    tracker.reason ??= "This month's Apify budget is used up.";
    return [];
  }
  tracker.spentCents += reserveCents;
  try {
    const { run, items } = await runApifyActor({
      actorId: actor.actorId,
      input,
      waitSecs: 45,
      timeoutSecs: 60,
      maxTotalChargeUsd: actor.maxChargeUsd,
      itemLimit: 5,
    });
    const costUsd = typeof run.usageTotalUsd === "number" && run.usageTotalUsd > 0
      ? run.usageTotalUsd
      : actor.reserveUsd;
    tracker.runs.push({ actor: actor.actorId, runId: run.id, status: run.status ?? "unknown", costUsd });
    await recordProviderUsage({
      admin,
      tenantId,
      provider: "apify",
      eventType: "provider.apify.contact_enrichment",
      externalRef: run.id,
      providerCostUsd: costUsd,
      pricingSnapshot: providerPricingSnapshot("apify", plan),
      status: "estimated",
      metadata: { actor: actor.actorId, job_id: jobId, contact_id: contactId, run_status: run.status ?? null },
    }).catch((error: unknown) => {
      console.error("contact_enrichment_usage_record_failed", {
        jobId,
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      });
    });
    return items;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "unknown";
    tracker.spentCents -= reserveCents;
    tracker.errors.push({ actor: actor.actorId, error: message });
    console.error("contact_enrichment_actor_failed", { jobId, actor: actor.actorId, error: message });
    return [];
  }
}
