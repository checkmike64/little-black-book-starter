export type AskDecisionRun = {
  id: string;
  mode: string;
  query: string | null;
  title: string | null;
  answer: Record<string, unknown> | null;
  shortlist?: Array<Record<string, unknown>> | null;
  context_hits?: Array<Record<string, unknown>> | null;
  created_at: string;
};

export type AskDecisionQueueItem = {
  id: string;
  title: string;
  detail: string;
  reason: string;
  href: string;
  mode: string;
  query: string;
  suggestedNote: string;
  suggestedActionTitle: string;
  suggestedActionType: AskDecisionActionType;
  suggestedPriority: AskDecisionPriority;
  suggestedDueOn: string | null;
  suggestedDueLabel: string;
  suggestedContactId: string | null;
  suggestedContactName: string | null;
  needsEvidenceVerification: boolean;
  score: number;
  createdAt: string;
};

export type AskDecisionActionType =
  | "follow_up"
  | "reconnect"
  | "promise"
  | "introduction"
  | "referral"
  | "podcast"
  | "owner_verification"
  | "claude_draft"
  | "other";

export type AskDecisionPriority = "low" | "normal" | "high";

export type AskDecisionActionRecommendation = {
  actionType: AskDecisionActionType;
  priority: AskDecisionPriority;
  dueOn: string | null;
  dueLabel: string;
  rationale: string;
};

export function ownerConfirmedAskActionType(mode: string): AskDecisionActionType {
  if (mode === "referrals") return "referral";
  if (mode === "podcasts") return "podcast";
  if (mode === "stale") return "reconnect";
  return "follow_up";
}

function nestedRecord(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : null;
}

function answerRecord(answer: Record<string, unknown> | null) {
  return nestedRecord(answer, "answer") ?? answer;
}

function hasDecision(answer: unknown) {
  const decision = nestedRecord(answer, "decision");
  const status = decision?.status;
  return status === "follow_up_needed" || status === "verified_no_action";
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!item || typeof item !== "object" || Array.isArray(item)) return "";
      const record = item as Record<string, unknown>;
      return [record.label, record.detail, record.title]
        .map(text)
        .filter(Boolean)
        .join(" · ");
    })
    .filter(Boolean);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function firstShortlistContact(run: AskDecisionRun) {
  const first = run.shortlist?.[0];
  if (!first) return { id: null, name: null, score: null };
  const rawId = first.id;

  return {
    id: isUuid(rawId) ? rawId : null,
    name: text(first.full_name) ?? text(first.contact_name),
    score: numberValue(first.score),
  };
}

function createdTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addDaysIso(base: Date, days: number) {
  const next = new Date(base);
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function inferDueDate(textBlock: string, now: Date) {
  const lower = textBlock.toLowerCase();
  const explicit = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (explicit) return { dueOn: explicit[1], dueLabel: "Explicit date" };
  const inDays = lower.match(/\bin\s+(\d{1,2})\s+days?\b/);
  if (inDays) {
    const days = Number(inDays[1]);
    if (Number.isFinite(days) && days >= 0) {
      return { dueOn: addDaysIso(now, days), dueLabel: `In ${days} day${days === 1 ? "" : "s"}` };
    }
  }
  if (/\btoday\b/.test(lower)) return { dueOn: addDaysIso(now, 0), dueLabel: "Today" };
  if (/\btomorrow\b/.test(lower)) return { dueOn: addDaysIso(now, 1), dueLabel: "Tomorrow" };
  if (/\bthis week\b|\bnext few days\b|\bsoon\b/.test(lower)) {
    return { dueOn: addDaysIso(now, 7), dueLabel: "This week" };
  }
  if (/\bnext week\b/.test(lower)) return { dueOn: addDaysIso(now, 14), dueLabel: "Next week" };

  return { dueOn: null, dueLabel: "No date inferred" };
}

function inferActionType(mode: string, textBlock: string): AskDecisionActionType {
  const lower = `${mode} ${textBlock}`.toLowerCase();
  if (/\bverify|review changes|pending change|confirm|source audit|not confident\b/.test(lower)) {
    return "owner_verification";
  }
  if (/\bpodcast|guest|host|show\b/.test(lower)) return "podcast";
  if (/\bintro|introduc|warm path|connection path\b/.test(lower)) return "introduction";
  if (/\breferral|refer\b/.test(lower)) return "referral";
  if (/\breconnect|rewarm|reactivat|stale|touch base\b/.test(lower)) return "reconnect";
  if (/\bpromise|owed|commitment|close loop\b/.test(lower)) return "promise";
  return "follow_up";
}

function inferPriority({
  actionType,
  confidence,
  sourceLabel,
  textBlock,
  shortlistCount,
  contextCount,
}: {
  actionType: AskDecisionActionType;
  confidence: string | null;
  sourceLabel: string | null;
  textBlock: string;
  shortlistCount: number;
  contextCount: number;
}): AskDecisionPriority {
  const lower = [confidence, sourceLabel, textBlock].filter(Boolean).join(" ").toLowerCase();
  if (/\boverdue|urgent|today|owner verification|not confident|pending change|must verify\b/.test(lower)) {
    return "high";
  }
  if (actionType === "owner_verification" || actionType === "promise") return "high";
  if (actionType === "introduction" || actionType === "referral" || actionType === "podcast") {
    return shortlistCount > 0 || contextCount > 1 ? "high" : "normal";
  }
  if (/\bthin|low confidence|needs review\b/.test(lower)) return "high";
  if (shortlistCount === 0 && contextCount === 0) return "low";
  return "normal";
}

export function recommendAskDecisionAction(run: AskDecisionRun, now = new Date()): AskDecisionActionRecommendation {
  const answer = answerRecord(run.answer);
  const sourceAudit = nestedRecord(answer, "source_audit");
  const nextActions = stringList(answer?.nextActions);
  const recommendation = text(answer?.recommendation);
  const confidence = text(answer?.confidence_label);
  const sourceLabel = text(sourceAudit?.label);
  const shortlistCount = run.shortlist?.length ?? 0;
  const contextCount = run.context_hits?.length ?? 0;
  const textBlock = [
    run.mode,
    run.query,
    run.title,
    text(answer?.headline),
    recommendation,
    ...nextActions,
    ...(Array.isArray(answer?.verify) ? stringList(answer?.verify) : []),
  ]
    .filter(Boolean)
    .join(" ");
  const actionType = inferActionType(run.mode, textBlock);
  const priority = inferPriority({
    actionType,
    confidence,
    sourceLabel,
    textBlock,
    shortlistCount,
    contextCount,
  });
  const { dueOn, dueLabel } = inferDueDate(textBlock, now);

  return {
    actionType,
    priority,
    dueOn,
    dueLabel,
    rationale: [
      actionType.replaceAll("_", " "),
      `${priority} priority`,
      dueLabel,
    ].join(" · "),
  };
}

export function askRunHref(run: Pick<AskDecisionRun, "id" | "mode" | "query">) {
  const query = run.query ? `&q=${encodeURIComponent(run.query)}` : "";
  return `/ask?run=${encodeURIComponent(run.id)}&mode=${encodeURIComponent(run.mode)}${query}`;
}

export function buildAskDecisionQueue(runs: AskDecisionRun[]) {
  return runs
    .filter((run) => !hasDecision(run.answer))
    .map((run): AskDecisionQueueItem => {
      const answer = answerRecord(run.answer);
      const sourceAudit = nestedRecord(answer, "source_audit");
      const contact = firstShortlistContact(run);
      const headline = text(answer?.headline) ?? run.title ?? "Saved Ask run";
      const recommendation = text(answer?.recommendation);
      const confidence = text(answer?.confidence_label);
      const sourceLabel = text(sourceAudit?.label);
      const query = run.query?.trim() ?? "";
      const contextCount = run.context_hits?.length ?? 0;
      const shortlistCount = run.shortlist?.length ?? 0;
      const actionRecommendation = recommendAskDecisionAction(run);

      return {
        id: run.id,
        title: headline,
        detail:
          recommendation ??
          (query ? `Decide whether "${query}" deserves follow-up.` : "Decide whether this saved answer should become action."),
        reason: [
          confidence ? `Confidence: ${confidence}` : null,
          sourceLabel ? `Source audit: ${sourceLabel}` : null,
          `${shortlistCount} shortlist match${shortlistCount === 1 ? "" : "es"}`,
          `${contextCount} context hit${contextCount === 1 ? "" : "s"}`,
        ]
          .filter(Boolean)
          .join(" · "),
        href: askRunHref(run),
        mode: run.mode,
        query,
        suggestedNote:
          recommendation ??
          (contact.name
            ? `Follow up on the Ask result involving ${contact.name}.`
            : "Follow up on this saved Ask result."),
        suggestedActionTitle: `Follow up from Ask: ${headline}`.slice(0, 500),
        suggestedActionType: actionRecommendation.actionType,
        suggestedPriority: actionRecommendation.priority,
        suggestedDueOn: actionRecommendation.dueOn,
        suggestedDueLabel: actionRecommendation.dueLabel,
        suggestedContactId: contact.id,
        suggestedContactName: contact.name,
        needsEvidenceVerification: contextCount === 0,
        score:
          50 +
          Math.min(shortlistCount, 8) * 3 +
          Math.min(contextCount, 8) +
          (contact.score ?? 0) / 10 +
          (actionRecommendation.priority === "high" ? 12 : actionRecommendation.priority === "low" ? -6 : 0),
        createdAt: run.created_at,
      };
    })
    .sort((a, b) => b.score - a.score || createdTime(b.createdAt) - createdTime(a.createdAt));
}
