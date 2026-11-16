import Link from "next/link";
import { cookies } from "next/headers";
import {
  deleteAskRun,
  markAskRunDecision,
  saveAskRun,
} from "@/app/(portal)/ask/actions";
import { DataLoadNotice } from "@/app/(portal)/data-load-notice";
import { NextMoveCaptureForm } from "@/app/(portal)/movement/next-move-capture-form";
import { RelationshipCommandShortcutForm } from "@/app/(portal)/movement/relationship-command-shortcut-form";
import {
  buildAskConfidence,
  type AskConfidence,
} from "@/lib/ask-confidence";
import {
  askRunDecisionState,
  readAskRunDecision,
} from "@/lib/ask-run-decision";
import { buildAskDecisionQueue } from "@/lib/ask-decision-queue";
import { buildAskSourceAudit } from "@/lib/ask-source-audit";
import { analyzeAskQuery } from "@/lib/ask/retrieval";
import { buildAskSuggestions } from "@/lib/ask-suggestions";
import {
  capturePriorityForResult,
  captureTypeForMode,
  commandIntentForMode,
  daysSince,
  fitTags,
  getAskData,
  nextMove,
  usefulLine,
  type AskMode,
  type ContactRow,
  type ContextHit,
  type SavedAskRun,
  type SearchResult,
  type SourceSnapshot,
} from "@/lib/ask/data";
import { adminToolsCookieName, shouldUseAdminTools } from "@/lib/admin-mode";
import { requireEnabledModule } from "@/lib/module-gate";
import type { ModuleKey } from "@/lib/modules";
import { buildOwnerFirstUseState } from "@/lib/owner-first-use";
import { ownerVisibleEvidence } from "@/lib/owner-visible-evidence";
import { getProspectingBucketMap } from "@/lib/prospecting-buckets";
import { getTenantContext } from "@/lib/tenant-context";
import { normalizeTenantSettings } from "@/lib/tenant-settings";

type AskSearchParams = Promise<Record<string, string | string[] | undefined>>;

type SavedRunView = "all" | "needs_decision" | "decided";

const askModes: Array<{ value: AskMode; label: string; hint: string }> = [
  { value: "search", label: "Search", hint: "Match across stored relationship fields." },
  { value: "referrals", label: "Referral Fits", hint: "People with referral lanes." },
  { value: "podcasts", label: "Podcasts", hint: "Hosts, guests, and outreach fits." },
  { value: "investors", label: "Investors", hint: "Investor and capital-related context." },
  { value: "ma", label: "M&A", hint: "Deal, acquisition, diligence, and operator context." },
  { value: "stale", label: "Stale", hint: "Useful relationships without recent touch." },
  { value: "asks", label: "Open Asks", hint: "People with current asks or help lanes." },
];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}

function cleanSavedRunView(value: string | string[] | undefined): SavedRunView {
  const raw = firstParam(value);
  return raw === "needs_decision" || raw === "decided" ? raw : "all";
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function savedText(value: unknown, fallback = "Not saved") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function savedStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function savedObjectList(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function safeInternalHref(value: unknown, fallback = "/ask") {
  const href = savedText(value, fallback);
  return href.startsWith("/") && !href.startsWith("//") ? href : fallback;
}

function savedDecision(answer: Record<string, unknown> | null | undefined) {
  return readAskRunDecision(answer);
}

function decisionPillClass(status: string) {
  return status === "verified_no_action" ? "pill cool" : "pill gold";
}

function savedRunViewHref(view: SavedRunView) {
  return view === "all" ? "/ask" : `/ask?saved=${view}`;
}

function decisionReturnHref(view: SavedRunView) {
  return view === "needs_decision" ? "/ask?saved=needs_decision" : savedRunViewHref(view);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function contextLine(contact: ContactRow) {
  return [
    contact.role_title?.join(", "),
    contact.company_name,
    contact.relationship_type?.join(" · "),
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatStaleness(contact: SearchResult | ContactRow) {
  const staleDays = "staleDays" in contact ? contact.staleDays : daysSince(contact.last_spoke);
  if (staleDays === null) return "No last-touch date";
  if (staleDays === 0) return "Touched today";
  return `${staleDays} day${staleDays === 1 ? "" : "s"} since touch`;
}

function formatDate(value: string | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatDateTime(value: string | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value));
}

function claudePrompt({
  modeLabel,
  query,
  results,
  contextHits,
  snapshot,
}: {
  modeLabel: string;
  query: string;
  results: SearchResult[];
  contextHits: ContextHit[];
  snapshot: SourceSnapshot;
}) {
  const shortlist = results.slice(0, 5);
  const evidence = contextHits.slice(0, 5);
  if (shortlist.length === 0 && evidence.length === 0) {
    return "No shortlist yet. Run a query or choose a mode, then review the visible relationship context and save any useful follow-up.";
  }

  const lines = shortlist.map((contact, index) => {
    return `${index + 1}. ${contact.full_name}${contact.company_name ? `, ${contact.company_name}` : ""} — ${usefulLine(contact)} Match: ${contact.matchedFields.join(", ")}. Suggested next move: ${contact.nextMove}`;
  });
  const evidenceLines = evidence.map((hit, index) => {
    return `${index + 1}. ${hit.type}: ${hit.title} — ${hit.detail}`;
  });

  return [
    "Review this Little Black Book shortlist and recommend the best next relationship moves.",
    `Mode: ${modeLabel}`,
    `Query: ${query || "No text query; mode-driven shortlist."}`,
    `Source snapshot: ${snapshot.contacts} contacts, ${snapshot.interactions} interactions, ${snapshot.transcripts} distilled transcripts, ${snapshot.promises} open promises, ${snapshot.actions} tracked actions, ${snapshot.provenance} source evidence records, ${snapshot.changes} pending changes, ${snapshot.jobs} visible Claude jobs, ${snapshot.connections} warm paths.`,
    "",
    "People:",
    ...(lines.length ? lines : ["No matched people in this view."]),
    "",
    "Evidence:",
    ...(evidenceLines.length ? evidenceLines : ["No matching interactions or promises in this view."]),
    "",
    "For each recommended action, explain why, what should be verified with the owner, and whether the database should receive a mechanical update or a pending judgment-field proposal.",
  ].join("\n");
}

function verificationList(result: SearchResult | undefined, mode: AskMode) {
  if (!result) {
    return [
      "Clarify the target category, company, outcome, or relationship lane.",
      "Review the visible Book context before saving any changes.",
    ];
  }

  const items = [
    "Confirm the stored context is still current before outreach.",
    "Verify any judgment fields before updating trust, referral safety, or strength.",
  ];

  if (mode === "referrals" && !result.ideal_referral) {
    items.push("Decide what kind of referral would actually be appropriate.");
  }

  if (mode === "podcasts" && !result.podcast_fit) {
    items.push("Confirm the podcast angle before drafting a pitch.");
  }

  if (mode === "stale") {
    items.push("Use a light reactivation note rather than assuming urgency.");
  }

  return items;
}

function buildExecutiveAnswer({
  mode,
  modeLabel,
  query,
  results,
  contextHits,
}: {
  mode: AskMode;
  modeLabel: string;
  query: string;
  results: SearchResult[];
  contextHits: ContextHit[];
}) {
  const top = results[0];
  const evidence = contextHits[0];
  const hasPendingChange = contextHits.some((hit) => hit.type === "change");
  const hasActiveJob = contextHits.some((hit) => hit.type === "job");
  const hasCommand = contextHits.some((hit) => hit.type === "command");
  const hasConnection = contextHits.some((hit) => hit.type === "connection");
  const obligationQuery = analyzeAskQuery(query).intent.ownerObligation;

  if (!top && !evidence) {
    return {
      headline: query
        ? "No confident match yet"
        : `${modeLabel} is ready when there is a target.`,
      recommendation:
        obligationQuery
          ? "No stored promise, action, transcript, interaction, or correspondence excerpt currently proves who requested this. The Book will not guess."
          : "Try a narrower company, category, outcome, relationship type, or choose a mode-driven query.",
      why: [
        obligationQuery
          ? "The available source records did not contain an evidence-backed obligation matching this request."
          : "The visible Book data did not produce a strong shortlist.",
      ],
      verify: verificationList(undefined, mode),
      nextActions: [
        {
          label: obligationQuery ? "Review recent conversations" : "Refine query",
          href: obligationQuery ? "/dashboard" : "/ask",
          detail: obligationQuery
            ? "Use Today to review recent meetings and capture any missed commitment."
            : "Try a narrower company, category, outcome, or relationship lane.",
        },
        {
          label: "Open changes",
          href: "/changes",
          detail: "Check whether Claude has pending context that has not been approved.",
        },
      ],
    };
  }

  if (!top && evidence) {
    const commandEvidence = evidence.type === "command";
    return {
      headline: commandEvidence ? "Start from the Claude output" : "Start from the evidence",
      recommendation:
        commandEvidence
          ? "The best signal is a saved Claude relationship command. Inspect the output before deciding whether to send, revise, or convert it into a tracked action."
          : "The best signal is in an interaction or promise rather than a clean contact match.",
      why: [evidence.title, evidence.detail],
      verify: verificationList(undefined, mode),
      nextActions: [
        {
          label: "Open context",
          href: evidence.href,
          detail: "Start from the strongest matching source record.",
        },
        {
          label: "Ask Claude",
          href: `/ask?mode=search&q=${encodeURIComponent(evidence.title)}`,
          detail: "Use the evidence title as a narrower search path.",
        },
      ],
    };
  }

  const why = top.matchReasons.length
    ? top.matchReasons
    : ["Matched stored relationship context."];
  const topSource = contextHits.find((hit) => hit.contactId === top.id);

  return {
    headline: `Start with ${top.full_name}`,
    recommendation: top.nextMove,
    why: [
      topSource?.excerpt ?? usefulLine(top),
      ...why,
      top.staleDays !== null ? formatStaleness(top) : "No last-touch date stored.",
    ],
    verify: verificationList(top, mode),
    nextActions: [
      {
        label: "Open profile",
        href: `/contacts/${top.id}`,
        detail: "Inspect source context, owner notes, promises, and provenance.",
      },
      hasConnection
        ? {
            label: "Open paths",
            href: "/networking",
            detail: "Use warm-path evidence before asking for a new introduction.",
          }
        : hasCommand
          ? {
              label: "Open command output",
              href: contextHits.find((hit) => hit.type === "command")?.href ?? "/ops",
              detail: "Inspect the saved Claude output before acting on it.",
            }
        : {
            label: "Ask context",
            href: `/ask?mode=search&q=${encodeURIComponent(top.full_name)}`,
            detail: "Narrow the Book around this relationship.",
          },
      hasActiveJob
        ? {
            label: "Open ops",
            href: "/ops",
            detail: "Finish active Claude work before relying on this context.",
          }
        : hasPendingChange
          ? {
              label: "Review changes",
              href: "/changes",
              detail: "Approve or reject pending updates before outreach.",
            }
          : {
              label: "Review changes",
              href: "/changes",
              detail: "Keep judgment-field updates in the approval queue.",
            },
    ],
  };
}

function contextTone(type: ContextHit["type"]) {
  if (type === "promise" || type === "action" || type === "change") return "gold";
  if (type === "transcript" || type === "provenance") return "cool";
  if (type === "command") return "hot";
  if (type === "job") return "warn";
  if (type === "connection") return "hot";
  return "cool";
}

function confidencePillClass(tone: AskConfidence["tone"]) {
  if (tone === "ok") return "pill cool";
  if (tone === "warn") return "pill warn";
  return "pill gold";
}

function auditPillClass(tone: "ok" | "warn" | "neutral") {
  if (tone === "ok") return "pill cool";
  if (tone === "warn") return "pill warn";
  return "pill gold";
}

function contextTypeLabel(type: ContextHit["type"]) {
  return type === "change"
    ? "pending change"
    : type === "job"
      ? "Claude job"
      : type === "command"
        ? "Claude command"
        : type === "connection"
          ? "warm path"
          : type === "transcript"
            ? "conversation summary"
            : type === "provenance"
              ? "source evidence"
              : type === "action"
                ? "tracked action"
          : type;
}

function sourceHealth(
  snapshot: SourceSnapshot,
  query: string,
  matchingEvidenceCount: number,
) {
  if (
    analyzeAskQuery(query).intent.ownerObligation &&
    matchingEvidenceCount === 0
  ) {
    return "No matching evidence";
  }
  const grounded =
    snapshot.interactions +
    snapshot.transcripts +
    snapshot.promises +
    snapshot.actions +
    snapshot.provenance +
    snapshot.changes +
    snapshot.jobs +
    snapshot.connections;

  if (grounded >= 25) return "Deep context";
  if (grounded >= 8) return "Usable context";
  return "Thin context";
}

function evidenceForContact(contact: SearchResult, hits: ContextHit[]) {
  return hits
    .filter((hit) => hit.contactId === contact.id)
    .slice(0, 3);
}

function compactAskRunPayload({
  results,
  contextHits,
  answer,
  confidence,
  sourceAudit,
  snapshot,
}: {
  results: SearchResult[];
  contextHits: ContextHit[];
  answer: ReturnType<typeof buildExecutiveAnswer>;
  confidence: AskConfidence;
  sourceAudit: ReturnType<typeof buildAskSourceAudit>;
  snapshot: SourceSnapshot;
}) {
  return {
    answer: {
      headline: answer.headline,
      recommendation: answer.recommendation,
      confidence_label: confidence.label,
      confidence_recommendation: confidence.recommendation,
      confidence_reasons: confidence.reasons,
      source_audit: {
        label: sourceAudit.label,
        tone: sourceAudit.tone,
        grounded_count: sourceAudit.groundedCount,
        evidence_type_counts: sourceAudit.evidenceTypeCounts,
        strengths: sourceAudit.strengths,
        gaps: sourceAudit.gaps,
        recommendation: sourceAudit.recommendation,
      },
      why: answer.why.slice(0, 6),
      verify: answer.verify.slice(0, 6),
      nextActions: answer.nextActions.slice(0, 4),
    },
    shortlist: results.slice(0, 8).map((contact) => ({
      id: contact.id,
      full_name: contact.full_name,
      company_name: contact.company_name,
      score: Math.round(contact.score),
      matched_fields: contact.matchedFields,
      fit_tags: contact.fitTags,
      next_move: contact.nextMove,
    })),
    contextHits: contextHits.slice(0, 8).map((hit) => ({
      key: hit.key,
      type: hit.type,
      title: hit.title,
      detail: hit.detail,
      href: hit.href,
      contact_id: hit.contactId,
      contact_name: hit.contactName,
      score: hit.score,
    })),
    snapshot,
  };
}

function savedRunHref(run: SavedAskRun) {
  return `/ask?run=${encodeURIComponent(run.id)}&mode=${encodeURIComponent(run.mode)}${
    run.query ? `&q=${encodeURIComponent(run.query)}` : ""
  }`;
}

export default async function AskPage({
  searchParams,
}: {
  searchParams?: AskSearchParams;
}) {
  await requireEnabledModule("ask");

  const params = searchParams ? await searchParams : {};
  const query = normalizeQuery(firstParam(params.q) ?? "");
  const selectedRunId = firstParam(params.run) ?? null;
  const savedRunView = cleanSavedRunView(params.saved);
  const requestedMode = firstParam(params.mode);
  const mode: AskMode = askModes.some((item) => item.value === requestedMode)
    ? (requestedMode as AskMode)
    : "search";
  const message = firstParam(params.message);
  const {
    results,
    contextHits,
    featured,
    snapshot,
    savedRuns,
    selectedRun,
    setupMode,
    loadHealth,
    error,
    retrieval,
  } = await getAskData(query, mode, selectedRunId);
  const tenantContext = await getTenantContext();
  const settings = normalizeTenantSettings(tenantContext?.settings);
  const enabledModules = Object.entries(settings.modules)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key as ModuleKey);
  const askSuggestions = buildAskSuggestions({
    enabledModules,
    prospectingBuckets: Object.values(getProspectingBucketMap(settings)),
  });
  const cookieStore = await cookies();
  const adminMode = shouldUseAdminTools({
    cookieValue: cookieStore.get(adminToolsCookieName)?.value,
    role: tenantContext?.role,
    setupMode,
  });
  const visibleContextHits = ownerVisibleEvidence(contextHits, adminMode);
  const visibleSnapshot = adminMode ? snapshot : { ...snapshot, jobs: 0 };
  const activeMode = askModes.find((item) => item.value === mode) ?? askModes[0];
  const topResult = results[0];
  const topEvidence = visibleContextHits[0];
  const prompt = claudePrompt({
    modeLabel: activeMode.label,
    query,
    results,
    contextHits: visibleContextHits,
    snapshot: visibleSnapshot,
  });
  const answer = buildExecutiveAnswer({
    mode,
    modeLabel: activeMode.label,
    query,
    results,
    contextHits: visibleContextHits,
  });
  const confidence = buildAskConfidence({
    activeJobCount: visibleContextHits.filter(
      (hit) => hit.type === "job" || hit.type === "command",
    ).length,
    evidenceCount: visibleContextHits.length,
    mode,
    pendingChangeCount: visibleContextHits.filter((hit) => hit.type === "change").length,
    resultCount: results.length,
    sourceCounts: visibleSnapshot,
    topScore: topResult?.score ?? 0,
  });
  const sourceAudit = buildAskSourceAudit({
    evidence: visibleContextHits.map((hit) => hit.type),
    sourceCounts: visibleSnapshot,
  });
  const obligationWithoutEvidence =
    analyzeAskQuery(query).intent.ownerObligation &&
    results.length === 0 &&
    visibleContextHits.length === 0;
  const presentedSourceAudit = obligationWithoutEvidence
    ? {
        ...sourceAudit,
        label: "No source-backed match",
        tone: "warn" as const,
        recommendation:
          "Wait for a source-backed interaction, transcript, promise, action, or correspondence excerpt before naming anyone.",
      }
    : sourceAudit;
  const askRunPayload = compactAskRunPayload({
    results,
    contextHits: visibleContextHits,
    answer,
    confidence,
    sourceAudit: presentedSourceAudit,
    snapshot: visibleSnapshot,
  });
  const hasSaveableRun = results.length > 0 || visibleContextHits.length > 0;
  const returnTo = `/ask?mode=${encodeURIComponent(mode)}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const selectedRunDecision = selectedRun ? savedDecision(selectedRun.answer) : null;
  const savedRunCounts = {
    all: savedRuns.length,
    needs_decision: savedRuns.filter(
      (run) => askRunDecisionState(run.answer) === "needs_decision",
    ).length,
    decided: savedRuns.filter((run) => askRunDecisionState(run.answer) === "decided").length,
  };
  const askDecisionQueue = buildAskDecisionQueue(savedRuns);
  const selectedRunDecisionItem = selectedRun
    ? (askDecisionQueue.find((item) => item.id === selectedRun.id) ?? null)
    : null;
  const visibleSavedRuns = savedRuns.filter((run) => {
    if (savedRunView === "all") return true;
    return askRunDecisionState(run.answer) === savedRunView;
  });
  const firstUse = buildOwnerFirstUseState("ask", {
    askRunCount: savedRuns.length,
    contactCount: visibleSnapshot.contacts,
    filtered: Boolean(query) || mode !== "search",
  });

  return (
    <div className="minimal-page ask-minimal">
      <header className="minimal-page-header">
        <div className="minimal-title-line"><h1>Ask the Book</h1></div>
        <a className="button quiet" href="#ask-history">History</a>
      </header>

      {setupMode ? (
        <div className="notice" role="status">
          Your private Book is still being prepared. A small preview is shown
          until verified relationship context is ready.
        </div>
      ) : null}

      <DataLoadNotice health={loadHealth} />

      {error ? <div className="notice" role="alert">{error}</div> : null}

      {message ? <div className="notice" role="status">{message}</div> : null}

      {query && retrieval.status === "abstain" ? (
        <div className="notice" role="status">
          The Book could not verify this request from stored conversations,
          commitments, or source evidence. It will not guess who you owe; any
          profile-only matches below are starting points, not an answer.
        </div>
      ) : null}

      <form className="minimal-ask-form" action="/ask">
        <input name="mode" type="hidden" value={mode} />
        <label className="field minimal-ask-input">
          <span className="sr-only">Question</span>
          <input
            autoComplete="off"
            defaultValue={query}
            name="q"
            placeholder="Ask about a person, promise, or introduction…"
            type="search"
          />
        </label>
        <button className="button hot" type="submit">
          Ask
        </button>
      </form>
      <div className="quick-questions" aria-label="Common relationship queries">
        {askSuggestions.slice(0, 3).map((item) => (
          <Link
            className="text-link"
            href={item.href}
            key={item.href}
            title={item.reason}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <details className="minimal-disclosure ask-options">
        <summary>Options</summary>
        <form action="/ask" className="compact-filter">
          {query ? <input name="q" type="hidden" value={query} /> : null}
          <label className="field"><span>Mode</span><select defaultValue={mode} name="mode">{askModes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <button className="button ghost small" type="submit">Apply</button>
        </form>
        <p className="source-note">{activeMode.hint}</p>
      </details>

      <details className="minimal-disclosure ask-history" id="ask-history" open={Boolean(firstParam(params.saved))}>
        <summary>History{savedRuns.length > 0 ? ` (${savedRuns.length})` : ""}</summary>
      {!query && !selectedRunId && mode === "search" && askDecisionQueue.length > 0 ? (
        <section className="priority-board" aria-label="Saved Ask decision queue">
          <div className="priority-lead">
            <span className="pill gold">Decision Queue</span>
            <h2>Close saved Ask decisions</h2>
            <p className="muted">
              Turn useful saved answers into movement items, or mark them
              verified no-action so they stop creating review pressure.
            </p>
            <div className="intent-stack">
              <div>
                <span>First decision</span>
                <b>{askDecisionQueue[0].title}</b>
              </div>
              <div>
                <span>Suggested path</span>
                <p>{askDecisionQueue[0].reason}</p>
              </div>
            </div>
            <div className="actions">
              <Link className="button hot" href={askDecisionQueue[0].href}>
                Open first saved run
              </Link>
              <Link className="button ghost" href="/ask?saved=needs_decision">
                View all undecided
              </Link>
              <Link className="button ghost" href="/movement?view=from_ask">
                View Ask moves
              </Link>
            </div>
          </div>
          <div className="priority-list">
            {askDecisionQueue.slice(0, 5).map((item) => (
              <div className="priority-item" key={item.id}>
                <span className={item.suggestedPriority === "high" ? "pill warn" : "pill gold"}>
                  {item.suggestedActionType.replaceAll("_", " ")}
                </span>
                <b>{item.title}</b>
                <span>{item.detail}</span>
                <span>
                  Suggested: {item.suggestedPriority} · {item.suggestedDueLabel}
                  {item.suggestedContactName ? ` · ${item.suggestedContactName}` : ""}
                </span>
                {item.needsEvidenceVerification ? (
                  <span className="source-note">
                    No correspondence evidence was retrieved. Verify before creating movement.
                  </span>
                ) : null}
                <div className="review-actions">
                  <Link
                    aria-label={`Review decision for ${item.title}`}
                    className="button small hot"
                    href={item.href}
                  >
                    Review decision
                  </Link>
                </div>
              </div>
            ))}
          </div>
          <div className="priority-metrics" aria-label="Saved Ask decision counts">
            <div>
              <span>Undecided</span>
              <b>{savedRunCounts.needs_decision}</b>
            </div>
            <div>
              <span>High priority</span>
              <b>
                {
                  askDecisionQueue.filter((item) => item.suggestedPriority === "high")
                    .length
                }
              </b>
            </div>
            <div>
              <span>Saved</span>
              <b>{savedRunCounts.all}</b>
            </div>
          </div>
        </section>
      ) : null}

      {!query && !selectedRunId && mode === "search" && savedRuns.length > 0 ? (
        <>
          <div className="section-header">
            <div>
              <div className="section-label">Saved Ask runs</div>
              <p>
                {savedRunCounts.needs_decision} need decision · {savedRunCounts.decided} decided ·{" "}
                {savedRunCounts.all} saved
              </p>
            </div>
            <div className="actions">
              {([
                ["all", `All ${savedRunCounts.all}`],
                ["needs_decision", `Needs decision ${savedRunCounts.needs_decision}`],
                ["decided", `Decided ${savedRunCounts.decided}`],
              ] as Array<[SavedRunView, string]>).map(([view, label]) => (
                <Link
                  aria-current={savedRunView === view ? "page" : undefined}
                  className={`button small ${savedRunView === view ? "hot" : "ghost"}`}
                  href={savedRunViewHref(view)}
                  key={view}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
          <div className="card">
            {visibleSavedRuns.length > 0 ? (
              <div className="mini-list">
                {visibleSavedRuns.map((run) => {
                  const shortlistCount = Array.isArray(run.shortlist)
                    ? run.shortlist.length
                    : 0;
                  const evidenceCount = Array.isArray(run.context_hits)
                    ? run.context_hits.length
                    : 0;
                  const decision = savedDecision(run.answer);
                  return (
                    <div className="mini-item dense" key={run.id}>
                      <div className="mini-item-head">
                        <b>{run.title}</b>
                        <span className="pill cool">{formatDateTime(run.created_at)}</span>
                      </div>
                      <span>
                        {run.mode.replaceAll("_", " ")}
                        {run.query ? ` · ${run.query}` : ""} · {shortlistCount} people ·{" "}
                        {evidenceCount} evidence items
                      </span>
                      {decision ? (
                        <span className={decisionPillClass(decision.status)}>
                          {decision.label}
                        </span>
                      ) : null}
                      <div className="actions">
                        <Link
                          className="button small hot"
                          href={savedRunHref(run)}
                        >
                          Open saved run
                        </Link>
                        <Link
                          className="button small ghost"
                          href={`/ask?mode=${encodeURIComponent(run.mode)}${
                            run.query ? `&q=${encodeURIComponent(run.query)}` : ""
                          }`}
                        >
                          Re-run
                        </Link>
                        <form action={deleteAskRun}>
                          <input name="ask_run_id" type="hidden" value={run.id} />
                          <input
                            name="return_to"
                            type="hidden"
                            value={savedRunViewHref(savedRunView)}
                          />
                          <button className="button small quiet" type="submit">
                            Remove
                          </button>
                        </form>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">
                {savedRunView === "needs_decision"
                  ? "No saved Ask runs need decisions."
                  : "No saved Ask runs match this filter."}
              </div>
            )}
          </div>
        </>
      ) : null}
      {savedRuns.length === 0 ? <p className="minimal-empty">No saved questions yet.</p> : null}
      </details>

      {selectedRun ? (
        <>
          <div className="section-label">Saved run detail</div>
          <section className="answer-panel" aria-label="Saved Ask run detail">
            <div className="answer-lead">
              <span>
                {selectedRun.mode.replaceAll("_", " ")} · {formatDateTime(selectedRun.created_at)}
              </span>
              <h2>{savedText(selectedRun.answer?.headline, selectedRun.title)}</h2>
              <span className="pill gold">
                {savedText(selectedRun.answer?.confidence_label, "Saved posture")}
              </span>
              {selectedRun.answer?.source_audit &&
              typeof selectedRun.answer.source_audit === "object" &&
              !Array.isArray(selectedRun.answer.source_audit) ? (
                <span
                  className={auditPillClass(
                    savedText(
                      (selectedRun.answer.source_audit as Record<string, unknown>).tone,
                      "neutral",
                    ) as "ok" | "warn" | "neutral",
                  )}
                >
                  {savedText(
                    (selectedRun.answer.source_audit as Record<string, unknown>).label,
                    "Source audit",
                  )}
                </span>
              ) : null}
              {selectedRunDecision ? (
                <span className={decisionPillClass(selectedRunDecision.status)}>
                  {selectedRunDecision.label}
                </span>
              ) : null}
              <p>
                {savedText(
                  selectedRun.answer?.recommendation,
                  "No recommendation was saved with this run.",
                )}
              </p>
              {selectedRunDecision?.note ? (
                <p className="source-note">{selectedRunDecision.note}</p>
              ) : null}
              {savedText(selectedRun.answer?.confidence_recommendation, "") ? (
                <p className="source-note">
                  {savedText(selectedRun.answer?.confidence_recommendation)}
                </p>
              ) : null}
              {selectedRun.answer?.source_audit &&
              typeof selectedRun.answer.source_audit === "object" &&
              !Array.isArray(selectedRun.answer.source_audit) ? (
                <p className="source-note">
                  {savedText(
                    (selectedRun.answer.source_audit as Record<string, unknown>)
                      .recommendation,
                  )}
                </p>
              ) : null}
              <div className="section-label">Decision after review</div>
              {selectedRunDecisionItem?.needsEvidenceVerification ? (
                <div className="notice compact-notice">
                  No correspondence evidence was retrieved for this answer. The
                  safest launch decision is no action; create a verification move
                  only when you want to investigate the recommendation.
                </div>
              ) : null}
              <div className="ask-decision-controls" aria-label="Saved Ask decision">
                <form
                  action={markAskRunDecision}
                  className={
                    selectedRunDecisionItem?.needsEvidenceVerification
                      ? "ask-decision-create-anyway"
                      : undefined
                  }
                >
                  <input name="ask_run_id" type="hidden" value={selectedRun.id} />
                  <input
                    name="decision_status"
                    type="hidden"
                    value="follow_up_needed"
                  />
                  {selectedRunDecisionItem ? (
                    <>
                      <input name="create_relationship_action" type="hidden" value="true" />
                      <input
                        name="relationship_action_title"
                        type="hidden"
                        value={selectedRunDecisionItem.suggestedActionTitle}
                      />
                      <input
                        name="relationship_action_notes"
                        type="hidden"
                        value={selectedRunDecisionItem.suggestedNote}
                      />
                      <input
                        name="relationship_action_type"
                        type="hidden"
                        value={selectedRunDecisionItem.suggestedActionType}
                      />
                      <input
                        name="relationship_action_priority"
                        type="hidden"
                        value={selectedRunDecisionItem.suggestedPriority}
                      />
                      <input
                        name="needs_evidence_verification"
                        type="hidden"
                        value={
                          selectedRunDecisionItem.needsEvidenceVerification
                            ? "true"
                            : "false"
                        }
                      />
                      {selectedRunDecisionItem.needsEvidenceVerification ? (
                        <input
                          name="owner_confirmed_intent"
                          type="hidden"
                          value="true"
                        />
                      ) : null}
                      <input
                        name="relationship_action_due_on"
                        type="hidden"
                        value={selectedRunDecisionItem.suggestedDueOn ?? ""}
                      />
                      <input
                        name="contact_id"
                        type="hidden"
                        value={selectedRunDecisionItem.suggestedContactId ?? ""}
                      />
                    </>
                  ) : null}
                  <input
                    name="return_to"
                    type="hidden"
                    value={
                      selectedRunDecisionItem
                        ? "/movement?view=from_ask"
                        : savedRunHref(selectedRun)
                    }
                  />
                  <label className="field compact">
                    <span>Decision note</span>
                    <input
                      defaultValue={selectedRunDecisionItem?.suggestedNote}
                      name="decision_note"
                      placeholder="What should happen next?"
                    />
                  </label>
                  <button className="button small ghost" type="submit">
                    {selectedRunDecisionItem?.suggestedActionType === "owner_verification"
                      ? selectedRunDecisionItem.needsEvidenceVerification
                        ? "Create next move"
                        : "Save verification move"
                      : selectedRunDecisionItem
                        ? "Save follow-up move"
                        : "Mark follow-up"}
                  </button>
                </form>
                <form
                  action={markAskRunDecision}
                  className={
                    selectedRunDecisionItem?.needsEvidenceVerification
                      ? "ask-decision-recommended"
                      : undefined
                  }
                >
                  <input name="ask_run_id" type="hidden" value={selectedRun.id} />
                  <input
                    name="decision_status"
                    type="hidden"
                    value="verified_no_action"
                  />
                  <input
                    name="return_to"
                    type="hidden"
                    value={savedRunHref(selectedRun)}
                  />
                  <button
                    className={`button small ${
                      selectedRunDecisionItem?.needsEvidenceVerification ? "hot" : "quiet"
                    }`}
                    type="submit"
                  >
                    {selectedRunDecisionItem?.needsEvidenceVerification
                      ? "Close as no action"
                      : "Verified, no action"}
                  </button>
                </form>
              </div>
              <div className="actions ask-run-housekeeping">
                <Link
                  className="button ghost"
                  href={`/ask?mode=${encodeURIComponent(selectedRun.mode)}${
                    selectedRun.query ? `&q=${encodeURIComponent(selectedRun.query)}` : ""
                  }`}
                >
                  Re-run this Ask
                </Link>
                <Link className="button ghost" href="/ask">
                  Back to Ask
                </Link>
                <form action={deleteAskRun}>
                  <input name="ask_run_id" type="hidden" value={selectedRun.id} />
                  <input name="return_to" type="hidden" value="/ask" />
                  <button className="button quiet" type="submit">
                    Remove saved run
                  </button>
                </form>
              </div>
            </div>
            <div className="answer-grid">
              <div>
                <h3>Evidence</h3>
                <ul>
                  {(savedStringList(selectedRun.answer?.confidence_reasons).length
                    ? savedStringList(selectedRun.answer?.confidence_reasons)
                    : savedStringList(selectedRun.answer?.why).length
                      ? savedStringList(selectedRun.answer?.why)
                    : ["No evidence note was saved."])
                    .slice(0, 5)
                    .map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                </ul>
              </div>
              <div>
                <h3>Verify</h3>
                <ul>
                  {(savedStringList(selectedRun.answer?.verify).length
                    ? savedStringList(selectedRun.answer?.verify)
                    : ["Verify source context before outreach."])
                    .slice(0, 5)
                    .map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                </ul>
              </div>
              <div>
                <h3>Next</h3>
                <ul>
                  {savedObjectList(selectedRun.answer?.nextActions).length > 0 ? (
                    savedObjectList(selectedRun.answer?.nextActions)
                      .slice(0, 4)
                      .map((item) => {
                        const label = savedText(item.label, "Next action");
                        return (
                          <li key={label}>
                            <Link href={safeInternalHref(item.href)}>{label}</Link>
                            <span>{savedText(item.detail, "Inspect before acting.")}</span>
                          </li>
                        );
                      })
                  ) : (
                    <li>No next action was saved.</li>
                  )}
                </ul>
              </div>
            </div>
          </section>

          <div className="grid two">
            <section className="card">
              <h2>Saved shortlist</h2>
              {savedObjectList(selectedRun.shortlist).length > 0 ? (
                <div className="mini-list">
                  {savedObjectList(selectedRun.shortlist)
                    .slice(0, 8)
                    .map((contact) => {
                      const contactId = savedText(contact.id, "");
                      const name = savedText(contact.full_name, "Unnamed person");
                      return (
                        <div className="mini-item dense" key={`${contactId}-${name}`}>
                          <b>{name}</b>
                          <span>{savedText(contact.next_move, "Inspect before acting.")}</span>
                          {isValidUuid(contactId) ? (
                            <Link className="button small ghost" href={`/contacts/${contactId}`}>
                              Open profile
                            </Link>
                          ) : null}
                        </div>
                      );
                    })}
                </div>
              ) : (
                <p className="muted">No people were saved with this run.</p>
              )}
            </section>

            <section className="card">
              <h2>Saved evidence</h2>
              {savedObjectList(selectedRun.context_hits).length > 0 ? (
                <div className="mini-list">
                  {savedObjectList(selectedRun.context_hits)
                    .slice(0, 8)
                    .map((hit) => {
                      const title = savedText(hit.title, "Evidence");
                      return (
                        <div className="mini-item dense" key={`${title}-${savedText(hit.key, "")}`}>
                          <div className="mini-item-head">
                            <b>{title}</b>
                            <span className="pill cool">{savedText(hit.type, "source")}</span>
                          </div>
                          <span>{savedText(hit.detail, "No detail saved.")}</span>
                          <Link className="button small ghost" href={safeInternalHref(hit.href)}>
                            Open source
                          </Link>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <p className="muted">No evidence rows were saved with this run.</p>
              )}
            </section>
          </div>
        </>
      ) : selectedRunId ? (
        <div className="notice">
          That saved Ask run is no longer available in this book.
        </div>
      ) : null}

      {!selectedRunId && (query || mode !== "search") ? (
        <>
          <section className="answer-panel" aria-label="Answer summary">
            <div className="answer-lead">
              <span>Answer</span>
              <h2>{answer.headline}</h2>
              <span className={confidencePillClass(confidence.tone)}>
                {confidence.label}
              </span>
              <span className={auditPillClass(presentedSourceAudit.tone)}>
                {presentedSourceAudit.label}
              </span>
              <p>{answer.recommendation}</p>
              <p className="source-note">{confidence.recommendation}</p>
              <p className="source-note">{presentedSourceAudit.recommendation}</p>
              {topResult ? (
                <div className="actions">
                  <Link className="button hot" href={`/contacts/${topResult.id}`}>
                    Open {topResult.full_name}
                  </Link>
                  <Link className="button ghost" href="/changes">
                    Review changes
                  </Link>
                </div>
              ) : topEvidence ? (
                <div className="actions">
                  <Link className="button hot" href={topEvidence.href}>
                    Open context
                  </Link>
                </div>
              ) : null}
              {hasSaveableRun ? (
                <div className="ask-run-save-actions">
                  <form action={saveAskRun}>
                    <input name="mode" type="hidden" value={mode} />
                    <input name="mode_label" type="hidden" value={activeMode.label} />
                    <input name="query" type="hidden" value={query} />
                    <input name="headline" type="hidden" value={answer.headline} />
                    <input name="return_to" type="hidden" value={returnTo} />
                    <input
                      name="answer"
                      type="hidden"
                      value={JSON.stringify(askRunPayload.answer)}
                    />
                    <input
                      name="shortlist"
                      type="hidden"
                      value={JSON.stringify(askRunPayload.shortlist)}
                    />
                    <input
                      name="context_hits"
                      type="hidden"
                      value={JSON.stringify(askRunPayload.contextHits)}
                    />
                    <input
                      name="snapshot"
                      type="hidden"
                      value={JSON.stringify(askRunPayload.snapshot)}
                    />
                    <button className="button ghost" type="submit">
                      Save run
                    </button>
                  </form>
                  <form action={saveAskRun}>
                    <input name="mode" type="hidden" value={mode} />
                    <input name="mode_label" type="hidden" value={activeMode.label} />
                    <input name="query" type="hidden" value={query} />
                    <input name="headline" type="hidden" value={answer.headline} />
                    <input name="return_to" type="hidden" value={returnTo} />
                    <input
                      name="decision_status"
                      type="hidden"
                      value="verified_no_action"
                    />
                    <input
                      name="answer"
                      type="hidden"
                      value={JSON.stringify(askRunPayload.answer)}
                    />
                    <input
                      name="shortlist"
                      type="hidden"
                      value={JSON.stringify(askRunPayload.shortlist)}
                    />
                    <input
                      name="context_hits"
                      type="hidden"
                      value={JSON.stringify(askRunPayload.contextHits)}
                    />
                    <input
                      name="snapshot"
                      type="hidden"
                      value={JSON.stringify(askRunPayload.snapshot)}
                    />
                    <button className="button quiet" type="submit">
                      Save and close as no action
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
            <div className="answer-grid">
              <div>
                <h3>Evidence</h3>
                <ul>
                  {answer.why.slice(0, 4).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Verify</h3>
                <ul>
                  {answer.verify.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Next</h3>
                <ul>
                  {answer.nextActions.map((item) => (
                    <li key={item.label}>
                      <Link href={item.href}>{item.label}</Link>
                      <span>{item.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section className="ask-brief" aria-label="Ask summary">
            <div className="insight-strip">
              <div className="insight">
                <span>Matches</span>
                <b>{results.length}</b>
              </div>
              <div className="insight">
                <span>Evidence</span>
                <b>{visibleContextHits.length}</b>
              </div>
              <div className="insight">
                <span>Source health</span>
                <b>{sourceHealth(snapshot, query, visibleContextHits.length)}</b>
              </div>
              <div className="insight">
                <span>Audit</span>
                <b>{presentedSourceAudit.label}</b>
              </div>
              <div className="insight">
                <span>Best next move</span>
                <b>
                  {topResult?.nextMove ??
                    topEvidence?.title ??
                    (obligationWithoutEvidence
                      ? "Review recent conversations and wait for source-backed delivery."
                      : "Refine the query or choose a mode.")}
                </b>
              </div>
            </div>
            {adminMode ? (
              <>
                <label className="field">
                  <span>Claude handoff prompt</span>
                  <textarea readOnly value={prompt} />
                </label>
                <p className="source-note">
                  Use this as a handoff brief. Claude should still verify judgment
                  fields with the owner before writing changes.
                </p>
              </>
            ) : null}
          </section>

          {visibleContextHits.length > 0 ? (
            <>
              <div className="section-label">
                Source-grounded evidence · {visibleContextHits.length}
              </div>
              <div className="card">
                <div className="mini-list">
                  {visibleContextHits.map((hit) => (
                    <div className="mini-item dense" key={hit.key}>
                      <div className="mini-item-head">
                        <b>{hit.title}</b>
                        <span className={`pill ${contextTone(hit.type)}`}>
                          {contextTypeLabel(hit.type)}
                        </span>
                      </div>
                      <span>{hit.detail}</span>
                      {hit.excerpt ? <p>{hit.excerpt}</p> : null}
                      {hit.matchReasons.length > 0 ? (
                        <span className="source-note">{hit.matchReasons.join(" ")}</span>
                      ) : null}
                      {hit.contactName ? <span>Person: {hit.contactName}</span> : null}
                      <div className="actions">
                        <Link className="button small ghost" href={hit.href}>
                          Open context
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          <div className="section-label">Book coverage</div>
          <div className="source-grid">
            <div>
              <span>Contacts</span>
              <b>{visibleSnapshot.contacts}</b>
            </div>
            <div>
              <span>Interactions</span>
              <b>{visibleSnapshot.interactions}</b>
            </div>
            <div>
              <span>Transcripts</span>
              <b>{visibleSnapshot.transcripts}</b>
            </div>
            <div>
              <span>Promises</span>
              <b>{visibleSnapshot.promises}</b>
            </div>
            <div>
              <span>Tracked actions</span>
              <b>{visibleSnapshot.actions}</b>
            </div>
            <div>
              <span>Source evidence</span>
              <b>{visibleSnapshot.provenance}</b>
            </div>
            <div>
              <span>Pending</span>
              <b>{visibleSnapshot.changes}</b>
            </div>
            {adminMode ? (
              <div>
                <span>Claude jobs</span>
                <b>{visibleSnapshot.jobs}</b>
              </div>
            ) : null}
            <div>
              <span>Warm paths</span>
              <b>{visibleSnapshot.connections}</b>
            </div>
          </div>

          <div className="section-label">
            Results · {results.length} match{results.length === 1 ? "" : "es"}
          </div>
          {results.length > 0 ? (
            <div className="grid two">
              {results.map((contact) => (
                <article className="card result-card" key={contact.id}>
                  <h2>{contact.full_name}</h2>
                  <p className="muted">{contextLine(contact) || "No context stored."}</p>
                  {contact.fitTags.length > 0 ? (
                    <div className="fit-tags" aria-label="Fit tags">
                      {contact.fitTags.map((tag) => (
                        <span className="pill gold" key={tag}>{tag}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="kv">
                    <span className="k">Match</span>
                    <span>{contact.matchedFields.join(" · ")}</span>
                  </div>
                  <div className="kv">
                    <span className="k">Match basis</span>
                    <span>
                      {contact.matchReasons.length > 0
                        ? contact.matchReasons.join(" · ")
                        : "Matched stored relationship context."}
                    </span>
                  </div>
                  <div className="kv">
                    <span className="k">Strength</span>
                    <span>
                      <span className="pill gold">{contact.trust_level ?? "Unset"}</span>
                      <span className="pill cool">
                        {contact.relationship_strength ?? "Unscored"}
                      </span>
                    </span>
                  </div>
                  <div className="kv">
                    <span className="k">Useful now</span>
                    <span>{usefulLine(contact)}</span>
                  </div>
                  <div className="kv">
                    <span className="k">Touch</span>
                    <span>{formatStaleness(contact)}</span>
                  </div>
                  <div className="kv">
                    <span className="k">Next</span>
                    <span>{contact.nextMove}</span>
                  </div>
                  {evidenceForContact(contact, visibleContextHits).length > 0 ? (
                    <div className="mini-list compact">
                      {evidenceForContact(contact, visibleContextHits).map((hit) => (
                        <div className="mini-item dense" key={hit.key}>
                          <div className="mini-item-head">
                            <b>{hit.title}</b>
                            <span className={`pill ${contextTone(hit.type)}`}>
                              {contextTypeLabel(hit.type)}
                            </span>
                          </div>
                          <span>{hit.detail}</span>
                          {hit.excerpt ? <p>{hit.excerpt}</p> : null}
                          {hit.matchReasons.length > 0 ? (
                            <span className="source-note">{hit.matchReasons.join(" ")}</span>
                          ) : null}
                          <div className="actions">
                            <Link className="button small ghost" href={hit.href}>
                              Source
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="actions">
                    <Link className="button ghost" href={`/contacts/${contact.id}`}>
                      Open in book
                    </Link>
                    <Link className="button ghost" href="/changes">
                      Review changes
                    </Link>
                  </div>
                  <NextMoveCaptureForm
                    contactId={contact.id}
                    defaultPriority={capturePriorityForResult(contact.score, contact.staleDays)}
                    defaultTitle={contact.nextMove}
                    defaultType={captureTypeForMode(mode)}
                    evidenceSummary={`${activeMode.label}: matched ${contact.matchedFields.join(
                      ", ",
                    )}. ${contact.matchReasons.join("; ")}`}
                    notes={`Captured from Ask ${activeMode.label}${query ? `: ${query}` : ""}. Match: ${contact.matchedFields.join(", ")}.`}
                    returnTo={returnTo}
                    source="ask_result"
                  sourceLabel={`Ask: ${activeMode.label}`}
                  sourceRef={`ask_result:${mode}:${query || "no_query"}:${contact.id}`}
                  title={`Save a move for ${contact.full_name}`}
                  collapsed
                  />
                  {adminMode ? (
                    <RelationshipCommandShortcutForm
                      contactId={contact.id}
                      defaultIntent={commandIntentForMode(mode)}
                      primaryMove={contact.nextMove}
                      commandPrompt={`Ask mode: ${activeMode.label}. Query: ${query || "none"}. Focus on this result: ${contact.full_name}. Suggested next move: ${contact.nextMove}.`}
                      returnTo={returnTo}
                      source="ask_result"
                      title="Prepare relationship help"
                    />
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span className="section-label">{firstUse.eyebrow}</span>
              <b>{firstUse.title}</b>
              <p>{firstUse.detail}</p>
              <ul className="security-list">
                {firstUse.proof.map((item) => (
                  <li key={item}>
                    <span>{item}</span>
                    <span className="status-ok">Grounded</span>
                  </li>
                ))}
              </ul>
              <div className="actions">
                <Link className="button hot" href={firstUse.primaryHref}>
                  {firstUse.primaryLabel}
                </Link>
                {firstUse.secondaryHref && firstUse.secondaryLabel ? (
                  <Link className="button ghost" href={firstUse.secondaryHref}>
                    {firstUse.secondaryLabel}
                  </Link>
                ) : null}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="section-label">Useful starting points</div>
          {featured.length > 0 ? (
            <div className="grid two">
              {featured.map((contact) => (
              <article className="card" key={contact.id}>
                <h2>{contact.full_name}</h2>
                <p className="muted">{contextLine(contact) || "No context stored."}</p>
                <div className="fit-tags" aria-label="Fit tags">
                  {fitTags(contact).map((tag) => (
                    <span className="pill gold" key={tag}>{tag}</span>
                  ))}
                </div>
                <div className="kv">
                  <span className="k">Ask</span>
                  <span>
                    {contact.current_asks ??
                      contact.wants_help_with ??
                      contact.ideal_referral ??
                      "No ask stored yet."}
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Last spoke</span>
                  <span>{formatStaleness(contact)}</span>
                </div>
                <div className="actions">
                  <Link className="button ghost" href={`/contacts/${contact.id}`}>
                    Open in book
                  </Link>
                </div>
                <NextMoveCaptureForm
                  contactId={contact.id}
                  defaultPriority={capturePriorityForResult()}
                  defaultTitle={nextMove(contact, mode)}
                  defaultType={captureTypeForMode(mode)}
                  evidenceSummary={`${activeMode.label}: ${
                    contact.current_asks ??
                    contact.wants_help_with ??
                    contact.ideal_referral ??
                    "Stored relationship context"
                  }`}
                  notes={`Captured from Ask starting point: ${activeMode.label}.`}
                  returnTo={returnTo}
                  source="ask_starting_point"
                  sourceLabel={`Ask: ${activeMode.label}`}
                  sourceRef={`ask_starting_point:${mode}:${contact.id}`}
                  title={`Save a move for ${contact.full_name}`}
                  collapsed
                />
                {adminMode ? (
                  <RelationshipCommandShortcutForm
                    contactId={contact.id}
                    defaultIntent={commandIntentForMode(mode)}
                    primaryMove={nextMove(contact, mode)}
                    commandPrompt={`Ask starting point: ${activeMode.label}. Focus on ${contact.full_name}.`}
                    returnTo={returnTo}
                    source="ask_starting_point"
                    title="Prepare relationship help"
                  />
                ) : null}
              </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              No useful starting points are available yet. Search for a person,
              company, goal, or relationship need.
            </div>
          )}
        </>
      )}
    </div>
  );
}
