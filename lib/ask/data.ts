import { buildDataLoadHealth } from "@/lib/data-load-health";
import { sampleContacts } from "@/lib/sample-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  analyzeAskQuery,
  attributableAskParticipantIds,
  askMatchExplanation,
  isAskEvidenceTypeAllowed,
  isGroundedAskObligationMatch,
  matchAskDocument,
  type AskDocumentMatch,
  type AskQueryAnalysis,
} from "@/lib/ask/retrieval";
import {
  buildLoadedEvidenceRetrievalSources,
  hybridRetrieveAsk,
  type HybridAskResult,
} from "@/lib/ask/hybrid";
import { isAskLandingRequest } from "@/lib/ask/load-plan";
import { getTenantContext } from "@/lib/tenant-context";

export type ContactRow = {
  id: string;
  full_name: string;
  company_name: string | null;
  role_title: string[] | null;
  trust_level: string | null;
  relationship_strength: string | null;
  relationship_type: string[] | null;
  one_line_summary: string | null;
  current_asks: string | null;
  wants_help_with: string | null;
  ideal_referral: string | null;
  services_offered: string[] | null;
  could_refer_me_for: string[] | null;
  primary_category: string[] | null;
  podcast_fit: string | null;
  recent_activity: string | null;
  private_notes: string | null;
  keywords: string[] | null;
  top_3_tags: string[] | null;
  last_spoke: string | null;
};

export type SearchResult = ContactRow & {
  score: number;
  matchedFields: string[];
  matchReasons: string[];
  fitTags: string[];
  nextMove: string;
  staleDays: number | null;
};

type InteractionContextRow = {
  id: string;
  occurred_at: string;
  interaction_type: string;
  title: string | null;
  summary: string | null;
  source: string | null;
  metadata: Record<string, unknown>;
  interaction_contacts?: Array<{
    contact_id: string;
    contacts?: {
      id: string;
      full_name: string | null;
      company_name: string | null;
    } | null;
  }>;
};

type PromiseContextRow = {
  id: string;
  promise_text: string;
  direction: string;
  due_on: string | null;
  status: string;
  source: string | null;
  evidence: Record<string, unknown>;
  contacts?: {
    id: string;
    full_name: string | null;
    company_name: string | null;
  } | null;
};

type PendingChangeContextRow = {
  id: string;
  contact_id: string | null;
  change_type: string;
  summary: string;
  payload: Record<string, unknown>;
  risk_level: string | null;
  source: string | null;
  created_at: string;
  contacts?: {
    id: string;
    full_name: string | null;
    company_name: string | null;
  } | null;
};

type TranscriptContextRow = {
  id: string;
  interaction_id: string | null;
  title: string | null;
  source: string | null;
  source_ref: string | null;
  distilled_summary: string | null;
  action_items: Array<{
    text?: string;
    assignee?: string | null;
    assignee_email?: string | null;
    contact_id?: string | null;
    owner_assigned?: boolean;
  }>;
  metadata: Record<string, unknown>;
  created_at: string;
};

type RelationshipActionContextRow = {
  id: string;
  contact_id: string | null;
  title: string;
  action_type: string;
  status: string;
  priority: string;
  due_on: string | null;
  notes: string | null;
  source: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  contacts?: {
    id: string;
    full_name: string | null;
    company_name: string | null;
  } | null;
};

type ProvenanceContextRow = {
  id: string;
  record_id: string;
  field_name: string;
  source_type: string;
  source_ref: string | null;
  summary: string | null;
  confidence: number | null;
  created_at: string;
};

type JobContextRow = {
  id: string;
  job_type: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  run_after: string;
  created_at: string;
};

type ConnectionContact = {
  id: string;
  full_name: string | null;
  company_name: string | null;
  current_asks: string | null;
  wants_help_with: string | null;
  ideal_referral: string | null;
};

type ConnectionContextRow = {
  id: string;
  contact_a: string;
  contact_b: string;
  source: string | null;
  evidence: Record<string, unknown>;
  confidence: number | null;
  created_at: string;
  contact_a_record?: ConnectionContact | null;
  contact_b_record?: ConnectionContact | null;
};

type RelationshipContextAskRow = {
  id: string;
  name: string;
  context_type: string;
  description: string | null;
  relationship_context_memberships?: Array<{
    contact_id: string;
    verification_state: string;
    contacts?: {
      id: string;
      full_name: string | null;
      company_name: string | null;
    } | null;
  }>;
};

export type ContextHit = {
  key: string;
  type:
    | "interaction"
    | "transcript"
    | "promise"
    | "action"
    | "provenance"
    | "change"
    | "job"
    | "command"
    | "connection";
  title: string;
  detail: string;
  excerpt: string | null;
  matchReasons: string[];
  contactId: string | null;
  contactName: string | null;
  href: string;
  score: number;
};

export type SourceSnapshot = {
  contacts: number;
  interactions: number;
  promises: number;
  changes: number;
  jobs: number;
  connections: number;
  transcripts: number;
  actions: number;
  provenance: number;
};

export type SavedAskRun = {
  id: string;
  mode: AskMode;
  query: string;
  title: string;
  answer: Record<string, unknown>;
  shortlist: Array<Record<string, unknown>>;
  context_hits: Array<Record<string, unknown>>;
  snapshot: Record<string, unknown>;
  created_at: string;
};

export type AskRetrievalState = Pick<HybridAskResult, "status" | "reason"> & {
  channels: Array<"exact" | "full_text" | "semantic">;
};

const retrievalNotRequested: AskRetrievalState = {
  status: "abstain",
  reason: "not_requested",
  channels: [],
};

export type AskMode =
  | "search"
  | "referrals"
  | "podcasts"
  | "investors"
  | "ma"
  | "stale"
  | "asks";

export function captureTypeForMode(mode: AskMode) {
  if (mode === "referrals") return "referral";
  if (mode === "podcasts") return "podcast";
  if (mode === "stale") return "reconnect";
  if (mode === "asks") return "promise";
  return "follow_up";
}

export function commandIntentForMode(mode: AskMode) {
  if (mode === "referrals" || mode === "ma") return "verify_referral_lane";
  if (mode === "stale") return "prep_for_call";
  return "draft_outreach";
}

export function capturePriorityForResult(score = 0, staleDays: number | null = null) {
  return score >= 80 || (staleDays ?? 0) > 120 ? "high" : "normal";
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function text(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) return value.join(" ");
  return value ?? "";
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

const searchableFields = [
  { label: "Name", key: "full_name", weight: 24 },
  { label: "Company", key: "company_name", weight: 16 },
  { label: "Summary", key: "one_line_summary", weight: 12 },
  { label: "Asks", key: "current_asks", weight: 18 },
  { label: "Helps with", key: "wants_help_with", weight: 18 },
  { label: "Referral", key: "ideal_referral", weight: 18 },
  { label: "Offers", key: "services_offered", weight: 18 },
  { label: "Can refer me for", key: "could_refer_me_for", weight: 18 },
  { label: "Category", key: "primary_category", weight: 12 },
  { label: "Podcast", key: "podcast_fit", weight: 18 },
  { label: "Recent", key: "recent_activity", weight: 10 },
  { label: "Private", key: "private_notes", weight: 8 },
] as const;

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function countTermMatches(value: string, terms: string[]) {
  const lower = value.toLowerCase();
  return terms.filter((term) => lower.includes(term)).length;
}

function jsonSearchText(value: Record<string, unknown> | null | undefined) {
  if (!value) return "";
  const parts: string[] = [];
  const visit = (item: unknown, depth: number) => {
    if (depth > 3 || parts.join(" ").length > 12000) return;
    if (typeof item === "string") {
      parts.push(item);
      return;
    }
    if (Array.isArray(item)) {
      item.slice(0, 30).forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (item && typeof item === "object") {
      Object.entries(item as Record<string, unknown>)
        .slice(0, 40)
        .forEach(([key, entry]) => {
          parts.push(key.replaceAll("_", " "));
          visit(entry, depth + 1);
        });
    }
  };
  visit(value, 0);
  return parts.join(" ");
}

function compactExcerpt(value: string | null | undefined, maxLength = 320) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, maxLength + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > maxLength * 0.7 ? lastSpace : maxLength).trim()}…`;
}

function matchedReasonList(match: AskDocumentMatch) {
  const explanation = askMatchExplanation(match);
  return explanation ? [explanation] : [];
}

function meaningfulMatch(match: AskDocumentMatch, analysis?: AskQueryAnalysis) {
  if (match.score < 20) return false;
  const specificConcepts = (analysis?.concepts ?? []).filter(
    (concept) =>
      concept.label !== "an obligation or follow-up" &&
      concept.label !== "a requested deliverable",
  );
  return (
    specificConcepts.length === 0 ||
    specificConcepts.filter((concept) => match.matchedConcepts.includes(concept.label)).length >=
      Math.min(specificConcepts.length, 2)
  );
}

function evidenceText(evidence: Record<string, unknown>) {
  const values = [
    evidence.summary,
    evidence.why,
    evidence.reason,
    evidence.context,
    evidence.source,
  ];
  const first = values.find((value) => typeof value === "string" && value.trim());
  if (typeof first === "string") return first;

  const snippets = Object.entries(evidence)
    .filter(([, value]) => typeof value === "string" && value.trim())
    .slice(0, 2)
    .map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`);

  return snippets.length ? snippets.join(" · ") : "Stored connection evidence.";
}

function hasMeaningfulLane(...values: Array<string | null | undefined>) {
  return values.some((value) => {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return false;
    if (["open context", "stored context", "unknown"].includes(normalized)) return false;
    if (/test duplicate|source project duplicate/.test(normalized)) return false;
    return normalized.length >= 12;
  });
}

export function daysSince(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 1000 / 60 / 60 / 24));
}

function interactionParticipants(interaction: InteractionContextRow) {
  return (
    interaction.interaction_contacts
      ?.map((item) => item.contacts)
      .filter(
        (contact): contact is {
          id: string;
          full_name: string | null;
          company_name: string | null;
        } => Boolean(contact),
      )
      .filter((contact) => contact.full_name) ?? []
  );
}

function scoreInteractionContext(
  interaction: InteractionContextRow,
  analysis: AskQueryAnalysis,
): ContextHit[] {
  if (!analysis.normalized) return [];

  const participants = interactionParticipants(interaction);
  const participantText = participants
    .map((contact) => [contact.full_name, contact.company_name].filter(Boolean).join(" "))
    .join(" ");
  const body = [
    interaction.title,
    interaction.summary,
    interaction.interaction_type,
    interaction.source,
    jsonSearchText(interaction.metadata),
    participantText,
  ]
    .filter(Boolean)
    .join(" ");
  const match = matchAskDocument(body, analysis, {
    requestedByContact: /\b(asked|requested|wanted|interested|send me|share)\b/i.test(body),
  });
  if (
    !meaningfulMatch(match, analysis) ||
    !isGroundedAskObligationMatch(match, analysis)
  ) return [];

  const title =
    interaction.title ??
    interaction.summary?.slice(0, 90) ??
    `${interaction.interaction_type} interaction`;

  // A meeting-level summary does not prove which person spoke. Name a person
  // only when exactly one linked participant could own the request.
  const attributableIds = new Set(
    attributableAskParticipantIds(participants.map((contact) => contact.id)),
  );
  const attributedParticipants = participants.filter((contact) => attributableIds.has(contact.id));
  const targets = attributedParticipants.length === 1 ? attributedParticipants : [null];
  return targets.map((contact) => ({
    key: `interaction:${interaction.id}:${contact?.id ?? "unlinked"}`,
    type: "interaction" as const,
    title,
    detail: `${formatDate(interaction.occurred_at)} · ${interaction.interaction_type}${
      contact?.full_name ? ` · ${contact.full_name}` : " · no person linked"
    }`,
    excerpt: compactExcerpt(interaction.summary ?? jsonSearchText(interaction.metadata)),
    matchReasons: matchedReasonList(match),
    contactId: contact?.id ?? null,
    contactName: contact?.full_name ?? null,
    href: contact?.id ? `/contacts/${contact.id}?view=activity` : "/dashboard",
    score: match.score + (interaction.summary ? 8 : 0),
  }));
}

function scorePromiseContext(
  promise: PromiseContextRow,
  analysis: AskQueryAnalysis,
  mode: AskMode,
): ContextHit | null {
  const contactText = [promise.contacts?.full_name, promise.contacts?.company_name]
    .filter(Boolean)
    .join(" ");
  const body = [
    promise.promise_text,
    promise.direction,
    promise.status,
    promise.source,
    jsonSearchText(promise.evidence),
    contactText,
  ]
    .filter(Boolean)
    .join(" ");
  const ownerOwes = promise.direction === "owner_owes_contact";
  const match = matchAskDocument(body, analysis, { ownerOwes });
  if (
    (!meaningfulMatch(match, analysis) && mode !== "asks") ||
    !isGroundedAskObligationMatch(match, analysis)
  ) return null;

  return {
    key: `promise:${promise.id}`,
    type: "promise",
    title: promise.promise_text,
    detail: `${promise.contacts?.full_name ?? "No contact linked"} · ${
      ownerOwes ? "You owe" : "They owe"
    } · Due ${formatDate(promise.due_on)}`,
    excerpt: compactExcerpt(promise.promise_text),
    matchReasons: matchedReasonList(match),
    contactId: promise.contacts?.id ?? null,
    contactName: promise.contacts?.full_name ?? null,
    href: promise.contacts?.id ? `/contacts/${promise.contacts.id}` : "/dashboard",
    score: Math.max(match.score, mode === "asks" ? 24 : 0) + (ownerOwes ? 8 : 0),
  };
}

function scorePendingChangeContext(
  change: PendingChangeContextRow,
  analysis: AskQueryAnalysis,
): ContextHit | null {
  const contactText = [change.contacts?.full_name, change.contacts?.company_name]
    .filter(Boolean)
    .join(" ");
  const body = [
    change.summary,
    change.change_type,
    change.risk_level,
    change.source,
    jsonSearchText(change.payload),
    contactText,
  ]
    .filter(Boolean)
    .join(" ");
  const match = matchAskDocument(body, analysis);
  if (
    !meaningfulMatch(match, analysis) ||
    !isGroundedAskObligationMatch(match, analysis)
  ) return null;

  return {
    key: `change:${change.id}`,
    type: "change",
    title: change.summary,
    detail: `${change.change_type.replaceAll("_", " ")} · ${
      change.risk_level ?? "low"
    } risk · ${formatDate(change.created_at)}`,
    excerpt: compactExcerpt(change.summary),
    matchReasons: matchedReasonList(match),
    contactId: change.contact_id,
    contactName: change.contacts?.full_name ?? null,
    href: `/changes/${change.id}`,
    score: match.score + (change.risk_level === "high" ? 12 : 0),
  };
}

function scoreTranscriptContext(
  transcript: TranscriptContextRow,
  interaction: InteractionContextRow | undefined,
  analysis: AskQueryAnalysis,
): ContextHit[] {
  if (!analysis.normalized) return [];
  const participants = interaction ? interactionParticipants(interaction) : [];
  const body = [
    transcript.title,
    transcript.source,
    transcript.distilled_summary,
    jsonSearchText({ action_items: transcript.action_items }),
    jsonSearchText(transcript.metadata),
    interaction?.title,
    interaction?.summary,
    participants.map((contact) => `${contact.full_name ?? ""} ${contact.company_name ?? ""}`).join(" "),
  ]
    .filter(Boolean)
    .join(" ");
  const match = matchAskDocument(body, analysis, {
    requestedByContact: /\b(asked|requested|wanted|interested|send me|share)\b/i.test(body),
    ownerOwes: (transcript.action_items ?? []).some((item) => item.owner_assigned === true),
  });
  if (
    !meaningfulMatch(match, analysis) ||
    !isGroundedAskObligationMatch(match, analysis)
  ) return [];

  const attributableIds = new Set(
    attributableAskParticipantIds(participants.map((contact) => contact.id)),
  );
  const attributedParticipants = participants.filter((contact) => attributableIds.has(contact.id));
  const targets = attributedParticipants.length === 1 ? attributedParticipants : [null];
  return targets.map((contact) => ({
    key: `transcript:${transcript.id}:${contact?.id ?? "unlinked"}`,
    type: "transcript" as const,
    title: transcript.title ?? interaction?.title ?? "Distilled conversation",
    detail: `${formatDate(interaction?.occurred_at ?? transcript.created_at)} · ${
      transcript.source ?? "transcript"
    }${contact?.full_name ? ` · ${contact.full_name}` : " · no person linked"}`,
    excerpt: compactExcerpt(
      [transcript.distilled_summary, jsonSearchText({ action_items: transcript.action_items })]
        .filter(Boolean)
        .join(" · ") || jsonSearchText(transcript.metadata),
      420,
    ),
    matchReasons: matchedReasonList(match),
    contactId: contact?.id ?? null,
    contactName: contact?.full_name ?? null,
    href: contact?.id ? `/contacts/${contact.id}?view=activity` : "/dashboard",
    score: match.score + 14,
  }));
}

function scoreRelationshipActionContext(
  action: RelationshipActionContextRow,
  analysis: AskQueryAnalysis,
): ContextHit | null {
  if (!analysis.normalized || action.status === "completed") return null;
  const body = [
    action.title,
    action.action_type,
    action.status,
    action.priority,
    action.notes,
    action.source,
    jsonSearchText(action.metadata),
    action.contacts?.full_name,
    action.contacts?.company_name,
  ]
    .filter(Boolean)
    .join(" ");
  const ownerOwes = ["promise", "follow_up", "claude_draft"].includes(action.action_type);
  const match = matchAskDocument(body, analysis, { ownerOwes });
  if (
    !meaningfulMatch(match, analysis) ||
    !isGroundedAskObligationMatch(match, analysis)
  ) return null;

  return {
    key: `action:${action.id}`,
    type: "action",
    title: action.title,
    detail: `${action.contacts?.full_name ?? "No contact linked"} · ${action.status.replaceAll(
      "_",
      " ",
    )} · ${action.due_on ? `Due ${formatDate(action.due_on)}` : "No due date"}`,
    excerpt: compactExcerpt(action.notes ?? action.title),
    matchReasons: matchedReasonList(match),
    contactId: action.contact_id,
    contactName: action.contacts?.full_name ?? null,
    href: action.contact_id ? `/contacts/${action.contact_id}?view=activity` : "/movement",
    score: match.score + (action.priority === "high" ? 12 : 0),
  };
}

function scoreProvenanceContext(
  provenance: ProvenanceContextRow,
  contact: ContactRow | undefined,
  analysis: AskQueryAnalysis,
): ContextHit | null {
  if (!analysis.normalized || !provenance.summary) return null;
  const body = [
    provenance.field_name,
    provenance.source_type,
    provenance.summary,
    contact?.full_name,
    contact?.company_name,
  ]
    .filter(Boolean)
    .join(" ");
  const match = matchAskDocument(body, analysis, {
    requestedByContact: /\b(asked|requested|wanted|interested|send me|share)\b/i.test(body),
  });
  if (
    !meaningfulMatch(match, analysis) ||
    !isGroundedAskObligationMatch(match, analysis)
  ) return null;

  return {
    key: `provenance:${provenance.id}`,
    type: "provenance",
    title: `${provenance.field_name.replaceAll("_", " ")} source`,
    detail: `${contact?.full_name ?? "No contact linked"} · ${provenance.source_type.replaceAll(
      "_",
      " ",
    )} · ${formatDate(provenance.created_at)}${
      typeof provenance.confidence === "number"
        ? ` · ${Math.round(provenance.confidence * 100)}% extraction confidence`
        : ""
    }`,
    excerpt: compactExcerpt(provenance.summary, 420),
    matchReasons: matchedReasonList(match),
    contactId: contact?.id ?? null,
    contactName: contact?.full_name ?? null,
    href: contact?.id ? `/contacts/${contact.id}?view=activity` : "/contacts",
    score: match.score + (provenance.source_type === "correspondence" ? 12 : 6),
  };
}

function jobContactId(job: JobContextRow) {
  const contactId = job.payload.contact_id;
  return typeof contactId === "string" ? contactId : null;
}

function commandFocus(job: JobContextRow) {
  const focus = job.payload.command_focus;
  if (!focus || typeof focus !== "object" || Array.isArray(focus)) {
    return null;
  }

  return focus as Record<string, unknown>;
}

function commandLabel(job: JobContextRow) {
  const focus = commandFocus(job);
  return typeof focus?.label === "string" ? focus.label : "Relationship command";
}

function commandIntent(job: JobContextRow) {
  const focus = commandFocus(job);
  return typeof focus?.intent === "string"
    ? focus.intent.replaceAll("_", " ")
    : "command";
}

function commandOutput(job: JobContextRow) {
  if (typeof job.result.command_output === "string" && job.result.command_output.trim()) {
    return job.result.command_output.trim();
  }

  if (typeof job.result.summary === "string" && job.result.summary.trim()) {
    return job.result.summary.trim();
  }

  if (typeof job.result.last_error === "string" && job.result.last_error.trim()) {
    return job.result.last_error.trim();
  }

  if (job.status === "queued") return "Queued for Claude.";
  if (job.status === "running") return "Claude has claimed this command.";
  return "No command output has been recorded yet.";
}

function scoreJobContext(
  job: JobContextRow,
  terms: string[],
  contactsById: Map<string, ContactRow>,
): ContextHit | null {
  const contactId = jobContactId(job);
  const contact = contactId ? contactsById.get(contactId) : null;
  const command = commandFocus(job);
  const isCommand = Boolean(command);
  const output = isCommand ? commandOutput(job) : "";
  const body = [
    job.job_type,
    job.status,
    isCommand ? commandLabel(job) : null,
    isCommand ? commandIntent(job) : null,
    isCommand ? command?.objective : null,
    isCommand ? command?.primary_move : null,
    isCommand ? command?.command_prompt : null,
    isCommand ? output : null,
    JSON.stringify(job.payload),
    JSON.stringify(job.result),
    contact?.full_name,
    contact?.company_name,
  ]
    .filter(Boolean)
    .join(" ");
  const matches = countTermMatches(body, terms);
  if (matches === 0) return null;

  return {
    key: `job:${job.id}`,
    type: isCommand ? "command" : "job",
    title: isCommand
      ? commandLabel(job)
      : `${job.job_type.replaceAll("_", " ")} · ${job.id.slice(0, 8)}`,
    detail: isCommand
      ? `${job.status} · ${commandIntent(job)} · ${
          contact?.full_name ?? "No contact pinned"
        } · ${output}`
      : `${job.status} · ${contact?.full_name ?? "No contact pinned"} · run ${formatDate(
          job.run_after,
        )}`,
    excerpt: compactExcerpt(isCommand ? output : jsonSearchText(job.result)),
    matchReasons: matches > 0 ? [`Matched ${matches} query term${matches === 1 ? "" : "s"}.`] : [],
    contactId,
    contactName: contact?.full_name ?? null,
    href: `/ops/jobs/${job.id}`,
    score:
      matches * (isCommand ? 24 : 20) +
      (job.status === "failed" ? 12 : job.status === "running" ? 8 : 0) +
      (isCommand && job.status === "succeeded" ? 8 : 0),
  };
}

function scoreConnectionContext(
  connection: ConnectionContextRow,
  terms: string[],
  mode: AskMode,
): ContextHit | null {
  const a = connection.contact_a_record;
  const b = connection.contact_b_record;
  const evidence = evidenceText(connection.evidence);
  const fromTestDuplicate =
    connection.source === "source_project_duplicate" ||
    /test duplicate|source project duplicate/i.test(evidence);
  const hasUsefulLane = hasMeaningfulLane(
    a?.current_asks,
    a?.wants_help_with,
    a?.ideal_referral,
    b?.current_asks,
    b?.wants_help_with,
    b?.ideal_referral,
  );
  const confidenceFit =
    !fromTestDuplicate && typeof connection.confidence === "number" && connection.confidence >= 0.5;
  const body = [
    a?.full_name,
    a?.company_name,
    a?.current_asks,
    a?.wants_help_with,
    a?.ideal_referral,
    b?.full_name,
    b?.company_name,
    b?.current_asks,
    b?.wants_help_with,
    b?.ideal_referral,
    connection.source,
    evidence,
  ]
    .filter(Boolean)
    .join(" ");
  const matches = terms.length > 0 ? countTermMatches(body, terms) : 0;
  const modeFit =
    !fromTestDuplicate &&
    (mode === "referrals" || mode === "asks") &&
    (hasUsefulLane || confidenceFit);
  if (fromTestDuplicate && matches < 2) return null;
  if (matches === 0 && !modeFit) return null;

  return {
    key: `connection:${connection.id}`,
    type: "connection",
    title: `${a?.full_name ?? "Person A"} → ${b?.full_name ?? "Person B"}`,
    detail: `${connection.source ?? "Stored path"} · ${
      typeof connection.confidence === "number"
        ? `${Math.round(connection.confidence * 100)}% confidence`
        : "Unscored"
    } · ${evidence}`,
    excerpt: compactExcerpt(evidence),
    matchReasons:
      matches > 0 ? [`Matched ${matches} query term${matches === 1 ? "" : "s"}.`] : ["Matched the selected relationship lane."],
    contactId: connection.contact_a,
    contactName: a?.full_name ?? null,
    href: "/networking",
    score: (matches || 1) * 18 + (modeFit ? 10 : 0),
  };
}

function scoreRelationshipContext(
  relationshipContext: RelationshipContextAskRow,
  terms: string[],
): ContextHit | null {
  if (terms.length === 0) return null;
  const members = (relationshipContext.relationship_context_memberships ?? [])
    .filter((membership) => membership.verification_state === "confirmed")
    .map((membership) => membership.contacts)
    .filter(
      (contact): contact is NonNullable<typeof contact> => Boolean(contact?.full_name),
    );
  const body = [
    relationshipContext.name,
    relationshipContext.context_type,
    relationshipContext.description,
    ...members.flatMap((contact) => [contact.full_name, contact.company_name]),
  ]
    .filter(Boolean)
    .join(" ");
  const matches = countTermMatches(body, terms);
  if (matches === 0) return null;

  return {
    key: `relationship-context:${relationshipContext.id}`,
    type: "connection",
    title: relationshipContext.name,
    detail: `${relationshipContext.context_type} · ${members.length} confirmed member${members.length === 1 ? "" : "s"}${
      members.length > 0
        ? ` · ${members.slice(0, 6).map((contact) => contact.full_name).join(", ")}`
        : ""
    }`,
    excerpt: compactExcerpt(relationshipContext.description),
    matchReasons: [`Matched ${matches} query term${matches === 1 ? "" : "s"}.`],
    contactId: members[0]?.id ?? null,
    contactName: members[0]?.full_name ?? null,
    href: "/networking",
    score: matches * 24 + Math.min(members.length, 10),
  };
}

function qualityBoost(contact: ContactRow) {
  let score = 0;
  const reasons: string[] = [];

  if (/tier 1|high|trusted|strong/i.test(contact.trust_level ?? "")) {
    score += 10;
    reasons.push("trusted relationship");
  }

  if (/hot|warm|strong/i.test(contact.relationship_strength ?? "")) {
    score += 8;
    reasons.push("relationship is active enough to use");
  }

  if (contact.current_asks || contact.wants_help_with || contact.ideal_referral) {
    score += 8;
    reasons.push("has a current ask, help lane, or referral lane");
  }

  const staleDays = daysSince(contact.last_spoke);
  if (staleDays !== null && staleDays <= 45) {
    score += 6;
    reasons.push("recently active");
  }

  return { score, reasons };
}

export function fitTags(contact: ContactRow) {
  const haystack = [
    contact.relationship_type?.join(" "),
    contact.one_line_summary,
    contact.current_asks,
    contact.wants_help_with,
    contact.ideal_referral,
    contact.services_offered?.join(" "),
    contact.could_refer_me_for?.join(" "),
    contact.primary_category?.join(" "),
    contact.podcast_fit,
    contact.private_notes,
    contact.keywords?.join(" "),
    contact.top_3_tags?.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const tags = [
    contact.trust_level ? contact.trust_level : "",
    contact.relationship_strength ? contact.relationship_strength : "",
  ];

  if (contact.ideal_referral || /referral|intro|introduc/.test(haystack)) tags.push("Referral fit");
  if (/podcast|guest|host|show|interview/.test(haystack)) tags.push("Podcast path");
  if (/investor|capital|fund|private equity|vc|venture|angel/.test(haystack)) tags.push("Capital");
  if (/m&a|merger|acquisition|deal|diligence|operator|rollup|exit/.test(haystack)) tags.push("Deal context");
  if (contact.current_asks) tags.push("Open ask");
  if (contact.wants_help_with) tags.push("Can help");
  if ((daysSince(contact.last_spoke) ?? 0) > 120) tags.push("Needs touch");

  return unique(tags).slice(0, 5);
}

export function usefulLine(contact: ContactRow) {
  return (
    contact.current_asks ??
    contact.ideal_referral ??
    contact.podcast_fit ??
    contact.wants_help_with ??
    contact.one_line_summary ??
    "No immediate use case stored."
  );
}

export function nextMove(contact: ContactRow, mode: AskMode) {
  if (mode === "podcasts" && contact.podcast_fit) {
    return "Have Claude draft a podcast-specific angle and verify whether the fit is current.";
  }
  if (mode === "referrals" && (contact.ideal_referral || contact.wants_help_with)) {
    return "Have Claude prepare a referral map and ask the owner to confirm the warmest path.";
  }
  if (mode === "stale") {
    return "Have Claude draft a light reactivation note based on the last known context.";
  }
  if (contact.current_asks) {
    return "Review the ask, decide whether it is worth actioning, then route follow-up through Claude.";
  }
  if (contact.ideal_referral) {
    return "Use this as a potential intro candidate after owner verification.";
  }
  return "Open the profile, inspect source context, then ask Claude for the next relationship move.";
}

function withComputedFit(
  contact: ContactRow,
  score: number,
  matchedFields: string[],
  matchReasons: string[],
  mode: AskMode,
): SearchResult {
  return {
    ...contact,
    score,
    matchedFields: unique(matchedFields),
    matchReasons: unique(matchReasons).slice(0, 4),
    fitTags: fitTags(contact),
    nextMove: nextMove(contact, mode),
    staleDays: daysSince(contact.last_spoke),
  };
}

function scoreContact(contact: ContactRow, query: string): SearchResult | null {
  const analysis = analyzeAskQuery(query);
  const terms = analysis.coreTerms;
  if (terms.length === 0) return null;

  let score = 0;
  const matchedFields = new Set<string>();
  const reasons: string[] = [];

  for (const { label, key, weight } of searchableFields) {
    const value = text(contact[key]).toLowerCase();
    if (!value) continue;

    const fieldMatches = terms.filter((term) => value.includes(term)).length;
    if (fieldMatches === 0) continue;

    matchedFields.add(label);
    score += fieldMatches * weight;
    reasons.push(`${label.toLowerCase()} matched ${fieldMatches} term${fieldMatches === 1 ? "" : "s"}`);
  }

  const tagText =
    text(contact.keywords) +
    " " +
    text(contact.top_3_tags) +
    " " +
    text(contact.primary_category);
  const tagMatches = terms.filter((term) => tagText.toLowerCase().includes(term)).length;
  if (tagMatches > 0) {
    matchedFields.add("Tags");
    score += tagMatches * 12;
    reasons.push("stored tags matched the query");
  }

  if (contact.full_name.toLowerCase().includes(query.toLowerCase())) {
    score += 40;
    reasons.push("name is a direct match");
  }
  if (contact.company_name?.toLowerCase().includes(query.toLowerCase())) {
    score += 20;
    reasons.push("company is a direct match");
  }

  const semanticBody = searchableFields
    .map(({ key }) => text(contact[key]))
    .concat([text(contact.keywords), text(contact.top_3_tags)])
    .join(" ");
  const semanticMatch = matchAskDocument(semanticBody, analysis);
  if (meaningfulMatch(semanticMatch, analysis)) {
    score += Math.min(semanticMatch.score, 100);
    matchedFields.add("Interpreted context");
    const explanation = askMatchExplanation(semanticMatch);
    if (explanation) reasons.push(explanation);
  }

  const boost = qualityBoost(contact);
  score += boost.score;

  return score > 0
    ? withComputedFit(contact, score, Array.from(matchedFields), [...reasons, ...boost.reasons], "search")
    : null;
}

function structuredResult(contact: ContactRow, mode: AskMode): SearchResult | null {
  const haystack = [
    contact.full_name,
    contact.company_name,
    contact.role_title?.join(" "),
    contact.relationship_type?.join(" "),
    contact.one_line_summary,
    contact.current_asks,
    contact.wants_help_with,
    contact.ideal_referral,
    contact.services_offered?.join(" "),
    contact.could_refer_me_for?.join(" "),
    contact.primary_category?.join(" "),
    contact.podcast_fit,
    contact.recent_activity,
    contact.private_notes,
    contact.keywords?.join(" "),
    contact.top_3_tags?.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (mode === "referrals" && (contact.ideal_referral || contact.wants_help_with)) {
    const boost = qualityBoost(contact);
    return withComputedFit(
      contact,
      66 + boost.score,
      ["Referral", "Helps with"],
      ["has referral/help context", ...boost.reasons],
      mode,
    );
  }

  if (mode === "podcasts" && /podcast|guest|host|show|interview/.test(haystack)) {
    const boost = qualityBoost(contact);
    return withComputedFit(
      contact,
      66 + boost.score,
      ["Podcast", "Outreach"],
      ["contains podcast or interview context", ...boost.reasons],
      mode,
    );
  }

  if (mode === "investors" && /investor|capital|fund|private equity|vc|venture|angel/.test(haystack)) {
    const boost = qualityBoost(contact);
    return withComputedFit(
      contact,
      66 + boost.score,
      ["Investor", "Capital"],
      ["contains capital or investor context", ...boost.reasons],
      mode,
    );
  }

  if (mode === "ma" && /m&a|merger|acquisition|deal|diligence|operator|rollup|exit/.test(haystack)) {
    const boost = qualityBoost(contact);
    return withComputedFit(
      contact,
      66 + boost.score,
      ["M&A", "Deal context"],
      ["contains deal or operator context", ...boost.reasons],
      mode,
    );
  }

  if (mode === "asks" && (contact.current_asks || contact.wants_help_with)) {
    const boost = qualityBoost(contact);
    return withComputedFit(
      contact,
      66 + boost.score,
      ["Current asks", "Helps with"],
      ["has an ask or help lane", ...boost.reasons],
      mode,
    );
  }

  if (mode === "stale") {
    const staleDays = daysSince(contact.last_spoke) ?? 9999;
    if (staleDays > 120 && (contact.trust_level || contact.relationship_strength)) {
      const boost = qualityBoost(contact);
      return withComputedFit(
        contact,
        72 + boost.score + Math.max(0, 365 - Math.min(staleDays, 365)) / 15,
        ["Stale", "Known relationship"],
        [`last touch was ${staleDays} days ago`, ...boost.reasons],
        mode,
      );
    }
  }

  return null;
}

export async function getAskData(query: string, mode: AskMode, selectedRunId: string | null) {
  const [supabase, context] = await Promise.all([
    createSupabaseServerClient(),
    getTenantContext(),
  ]);
  if (!supabase || !context) {
    const contacts = sampleContacts as unknown as ContactRow[];
    return {
      results: contacts
        .map((contact) =>
          mode === "search" ? scoreContact(contact, query) : structuredResult(contact, mode),
        )
        .filter((result): result is SearchResult => Boolean(result))
        .sort((a, b) => b.score - a.score)
        .slice(0, 12),
      contextHits: [] as ContextHit[],
      featured: contacts.slice(0, 6),
      snapshot: {
        contacts: contacts.length,
        interactions: 0,
        promises: 0,
        changes: 0,
        jobs: 0,
        connections: 0,
        transcripts: 0,
        actions: 0,
        provenance: 0,
      } as SourceSnapshot,
      savedRuns: [] as SavedAskRun[],
      selectedRun: null as SavedAskRun | null,
      setupMode: true,
      loadHealth: buildDataLoadHealth("Ask the Book", []),
      error: null,
      retrieval: retrievalNotRequested,
    };
  }

  if (isAskLandingRequest(query, mode, selectedRunId)) {
    const [featuredContactsResult, activeContactCountResult, askRunsResult] = await Promise.all([
      supabase
        .from("contacts")
        .select(
          "id, full_name, company_name, role_title, trust_level, relationship_strength, relationship_type, one_line_summary, current_asks, wants_help_with, ideal_referral, services_offered, could_refer_me_for, primary_category, podcast_fit, recent_activity, private_notes, keywords, top_3_tags, last_spoke",
        )
        .eq("tenant_id", context.tenantId)
        .is("archived_at", null)
        .or("relationship_strength.not.is.null,trust_level.not.is.null")
        .order("full_name")
        .limit(8),
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId)
        .is("archived_at", null),
      supabase
        .from("ask_runs")
        .select("id, mode, query, title, answer, shortlist, context_hits, snapshot, created_at")
        .eq("tenant_id", context.tenantId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    const loadHealth = buildDataLoadHealth("Ask the Book", [
      {
        key: "contacts",
        label: "starting contacts",
        error:
          featuredContactsResult.error ||
          activeContactCountResult.error ||
          (!featuredContactsResult.data ? "missing contacts" : null),
        blocksSurface: true,
      },
      { key: "ask_runs", label: "saved Ask runs", error: askRunsResult.error },
    ]);
    const featured = ((featuredContactsResult.data ?? []) as ContactRow[]).filter(
      (contact) => contact.relationship_strength || contact.trust_level,
    );

    return {
      results: [] as SearchResult[],
      contextHits: [] as ContextHit[],
      featured,
      snapshot: {
        contacts: activeContactCountResult.count ?? 0,
        interactions: 0,
        promises: 0,
        changes: 0,
        jobs: 0,
        connections: 0,
        transcripts: 0,
        actions: 0,
        provenance: 0,
      } as SourceSnapshot,
      savedRuns: ((askRunsResult.data ?? []) as unknown) as SavedAskRun[],
      selectedRun: null as SavedAskRun | null,
      setupMode: false,
      loadHealth,
      error:
        featuredContactsResult.error ||
        activeContactCountResult.error ||
        !featuredContactsResult.data
          ? "The private database is connected, but Ask the Book could not load starting contacts for this signed-in user."
          : null,
      retrieval: retrievalNotRequested,
    };
  }

  const [
    contactsResult,
    interactionsResult,
    promisesResult,
    changesResult,
    jobsResult,
    connectionsResult,
    relationshipContextsResult,
    transcriptsResult,
    relationshipActionsResult,
    provenanceResult,
    askRunsResult,
    selectedRunResult,
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, full_name, company_name, role_title, trust_level, relationship_strength, relationship_type, one_line_summary, current_asks, wants_help_with, ideal_referral, services_offered, could_refer_me_for, primary_category, podcast_fit, recent_activity, private_notes, keywords, top_3_tags, last_spoke",
      )
      .eq("tenant_id", context.tenantId)
      .is("archived_at", null)
      .order("full_name")
      .limit(500),
    supabase
      .from("interactions")
      .select(
        "id, occurred_at, interaction_type, title, summary, source, metadata, interaction_contacts!interaction_contacts_tenant_interaction_fkey(contact_id, contacts:contacts!interaction_contacts_tenant_contact_fkey(id, full_name, company_name))",
      )
      .eq("tenant_id", context.tenantId)
      .order("occurred_at", { ascending: false })
      .limit(250),
    supabase
      .from("promises")
      .select("id, promise_text, direction, due_on, status, source, evidence, contacts(id, full_name, company_name)")
      .eq("tenant_id", context.tenantId)
      .eq("status", "open")
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(150),
    supabase
      .from("pending_changes")
      .select("id, contact_id, change_type, summary, payload, risk_level, source, created_at, contacts(id, full_name, company_name)")
      .eq("tenant_id", context.tenantId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(150),
    supabase
      .from("jobs")
      .select("id, job_type, status, payload, result, run_after, created_at")
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false })
      .limit(150),
    supabase
      .from("connections")
      .select(
        "id, contact_a, contact_b, source, evidence, confidence, created_at, contact_a_record:contacts!connections_contact_a_fkey(id, full_name, company_name, current_asks, wants_help_with, ideal_referral), contact_b_record:contacts!connections_contact_b_fkey(id, full_name, company_name, current_asks, wants_help_with, ideal_referral)",
      )
      .eq("tenant_id", context.tenantId)
      .eq("status", "already_connected")
      .order("created_at", { ascending: false })
      .limit(150),
    supabase
      .from("relationship_contexts")
      .select(
        "id, name, context_type, description, relationship_context_memberships(contact_id, verification_state, contacts(id, full_name, company_name))",
      )
      .eq("tenant_id", context.tenantId)
      .is("archived_at", null)
      .limit(150),
    supabase
      .from("transcripts")
      .select(
        "id, interaction_id, title, source, source_ref, distilled_summary, action_items, metadata, created_at",
      )
      .eq("tenant_id", context.tenantId)
      .eq("processing_status", "ready")
      .order("created_at", { ascending: false })
      .limit(250),
    supabase
      .from("relationship_actions")
      .select(
        "id, contact_id, title, action_type, status, priority, due_on, notes, source, metadata, created_at, contacts(id, full_name, company_name)",
      )
      .eq("tenant_id", context.tenantId)
      .in("status", ["open", "deferred"])
      .order("created_at", { ascending: false })
      .limit(250),
    supabase
      .from("field_provenance")
      .select(
        "id, record_id, field_name, source_type, source_ref, summary, confidence, created_at",
      )
      .eq("tenant_id", context.tenantId)
      .eq("table_name", "contacts")
      .not("summary", "is", null)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("ask_runs")
      .select("id, mode, query, title, answer, shortlist, context_hits, snapshot, created_at")
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false })
      .limit(50),
    selectedRunId && isValidUuid(selectedRunId)
      ? supabase
          .from("ask_runs")
          .select("id, mode, query, title, answer, shortlist, context_hits, snapshot, created_at")
          .eq("tenant_id", context.tenantId)
          .eq("id", selectedRunId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const coreLoadHealth = buildDataLoadHealth("Ask the Book", [
    {
      key: "contacts",
      label: "contacts",
      error: contactsResult.error || (!contactsResult.data ? "missing contacts" : null),
      blocksSurface: true,
    },
  ]);

  if (contactsResult.error || !contactsResult.data) {
    return {
      results: [] as SearchResult[],
      contextHits: [] as ContextHit[],
      featured: [] as ContactRow[],
      snapshot: {
        contacts: 0,
        interactions: 0,
        promises: 0,
        changes: 0,
        jobs: 0,
        connections: 0,
        transcripts: 0,
        actions: 0,
        provenance: 0,
      } as SourceSnapshot,
      savedRuns: [] as SavedAskRun[],
      selectedRun: null as SavedAskRun | null,
      setupMode: false,
      loadHealth: coreLoadHealth,
      error: "The private database is connected, but Ask the Book could not load contacts for this signed-in user.",
      retrieval: retrievalNotRequested,
    };
  }

  const loadHealth = buildDataLoadHealth("Ask the Book", [
    { key: "contacts", label: "contacts", error: contactsResult.error, blocksSurface: true },
    { key: "interactions", label: "interactions", error: interactionsResult.error },
    { key: "promises", label: "promises", error: promisesResult.error },
    { key: "changes", label: "pending changes", error: changesResult.error },
    { key: "jobs", label: "Claude jobs", error: jobsResult.error },
    { key: "connections", label: "warm paths", error: connectionsResult.error },
    { key: "relationship_contexts", label: "shared groups and events", error: relationshipContextsResult.error },
    { key: "transcripts", label: "distilled transcripts", error: transcriptsResult.error },
    { key: "relationship_actions", label: "tracked actions", error: relationshipActionsResult.error },
    { key: "field_provenance", label: "correspondence and field evidence", error: provenanceResult.error },
    { key: "ask_runs", label: "saved Ask runs", error: askRunsResult.error },
    { key: "selected_run", label: "selected saved run", error: selectedRunResult.error },
  ]);

  const contacts = contactsResult.data as ContactRow[];
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const analysis = analyzeAskQuery(query);
  const terms = analysis.coreTerms;
  const interactionRows = (((interactionsResult.data ?? []) as unknown) as InteractionContextRow[]);
  const interactionsById = new Map(interactionRows.map((interaction) => [interaction.id, interaction]));
  const scoredContextHits = [
    ...interactionRows.flatMap((interaction) => scoreInteractionContext(interaction, analysis)),
    ...((((transcriptsResult.data ?? []) as unknown) as TranscriptContextRow[]).flatMap(
      (transcript) =>
        scoreTranscriptContext(
          transcript,
          transcript.interaction_id ? interactionsById.get(transcript.interaction_id) : undefined,
          analysis,
        ),
    )),
    ...((((promisesResult.data ?? []) as unknown) as PromiseContextRow[])
      .map((promise) => scorePromiseContext(promise, analysis, mode))
      .filter((hit): hit is ContextHit => Boolean(hit))),
    ...((((relationshipActionsResult.data ?? []) as unknown) as RelationshipActionContextRow[])
      .map((action) => scoreRelationshipActionContext(action, analysis))
      .filter((hit): hit is ContextHit => Boolean(hit))),
    ...((((provenanceResult.data ?? []) as unknown) as ProvenanceContextRow[])
      .map((provenance) =>
        scoreProvenanceContext(provenance, contactsById.get(provenance.record_id), analysis),
      )
      .filter((hit): hit is ContextHit => Boolean(hit))),
    ...((((changesResult.data ?? []) as unknown) as PendingChangeContextRow[])
      .map((change) => scorePendingChangeContext(change, analysis))
      .filter((hit): hit is ContextHit => Boolean(hit))),
    ...((((jobsResult.data ?? []) as unknown) as JobContextRow[])
      .map((job) => scoreJobContext(job, terms, contactsById))
      .filter((hit): hit is ContextHit => Boolean(hit))),
    ...((((connectionsResult.data ?? []) as unknown) as ConnectionContextRow[])
      .map((connection) => scoreConnectionContext(connection, terms, mode))
      .filter((hit): hit is ContextHit => Boolean(hit))),
    ...((((relationshipContextsResult.data ?? []) as unknown) as RelationshipContextAskRow[])
      .map((relationshipContext) => scoreRelationshipContext(relationshipContext, terms))
      .filter((hit): hit is ContextHit => Boolean(hit))),
  ]
    .filter((hit) => isAskEvidenceTypeAllowed(hit.type, analysis))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const hybridResult = query
    ? await hybridRetrieveAsk(
        query,
        buildLoadedEvidenceRetrievalSources(
          scoredContextHits.map((hit) => ({
            id: hit.key,
            type: hit.type,
            contactId: hit.contactId,
            title: hit.title,
            text: [hit.detail, hit.excerpt].filter(Boolean).join(" "),
            sourceUrl: hit.href,
          })),
        ),
        { limit: 30 },
      )
    : null;
  const hitByKey = new Map(scoredContextHits.map((hit) => [hit.key, hit]));
  const contextHits = hybridResult
    ? hybridResult.status === "answerable"
      ? hybridResult.hits.flatMap((hybridHit) => {
          const hit = hitByKey.get(hybridHit.id);
          if (!hit) return [];
          return [{
            ...hit,
            score: hit.score + hybridHit.score * 20,
            matchReasons: unique([
              ...hybridHit.explanations,
              ...hit.matchReasons,
            ]),
          }];
        })
      : []
    : scoredContextHits.slice(0, 30);
  const retrieval: AskRetrievalState = hybridResult
    ? {
        status: hybridResult.status,
        reason: hybridResult.reason,
        channels: unique(
          hybridResult.hits.flatMap((hit) => hit.channels),
        ) as AskRetrievalState["channels"],
      }
    : retrievalNotRequested;

  const allowProfileOnlyMatches =
    mode !== "search" || !analysis.intent.ownerObligation;
  const baseResults = allowProfileOnlyMatches && (query || mode !== "search")
    ? contacts
        .map((contact) =>
          mode === "search" ? scoreContact(contact, query) : structuredResult(contact, mode),
        )
        .filter((result): result is SearchResult => Boolean(result))
    : [];
  const resultsById = new Map(baseResults.map((result) => [result.id, result]));

  if (mode === "search" && query) {
    const hitsByContact = new Map<string, ContextHit[]>();
    for (const hit of contextHits) {
      if (!hit.contactId || !contactsById.has(hit.contactId)) continue;
      const current = hitsByContact.get(hit.contactId) ?? [];
      current.push(hit);
      hitsByContact.set(hit.contactId, current);
    }

    for (const [contactId, hits] of hitsByContact) {
      const contact = contactsById.get(contactId);
      if (!contact) continue;
      const orderedHits = [...hits].sort((left, right) => right.score - left.score);
      const evidenceScore =
        orderedHits[0].score +
        orderedHits.slice(1, 3).reduce((sum, hit) => sum + hit.score * 0.2, 0);
      const labels = orderedHits.map((hit) => {
        if (hit.type === "interaction") return "Conversation";
        if (hit.type === "transcript") return "Transcript";
        if (hit.type === "action") return "Tracked action";
        if (hit.type === "provenance") return "Correspondence evidence";
        if (hit.type === "promise") return "Promise";
        return hit.type.replaceAll("_", " ");
      });
      const reasons = orderedHits.flatMap((hit) => hit.matchReasons).slice(0, 5);
      const existing = resultsById.get(contactId);
      const merged = withComputedFit(
        contact,
        Math.max(existing?.score ?? 0, evidenceScore),
        [...(existing?.matchedFields ?? []), ...labels],
        [...reasons, ...(existing?.matchReasons ?? [])],
        mode,
      );
      if (analysis.intent.ownerObligation) {
        merged.nextMove =
          "Review the source evidence, confirm exactly what you owe, and close the loop.";
      }
      resultsById.set(contactId, merged);
    }
  }

  const results = Array.from(resultsById.values())
    .sort((a, b) => b.score - a.score || a.full_name.localeCompare(b.full_name))
    .slice(0, 20);

  const savedRuns = ((askRunsResult.data ?? []) as unknown) as SavedAskRun[];
  const selectedRun =
    ((selectedRunResult.data as SavedAskRun | null) ?? null) ??
    savedRuns.find((run) => run.id === selectedRunId) ??
    null;

  return {
    results,
    contextHits,
    featured: contacts
      .filter((contact) => contact.relationship_strength || contact.trust_level)
      .slice(0, 8),
    snapshot: {
      contacts: contacts.length,
      interactions: (interactionsResult.data ?? []).length,
      promises: (promisesResult.data ?? []).length,
      changes: (changesResult.data ?? []).length,
      jobs: (jobsResult.data ?? []).length,
      connections: (connectionsResult.data ?? []).length,
      transcripts: (transcriptsResult.data ?? []).length,
      actions: (relationshipActionsResult.data ?? []).length,
      provenance: (provenanceResult.data ?? []).length,
    } as SourceSnapshot,
    savedRuns,
    selectedRun,
    setupMode: false,
    loadHealth,
    error: null,
    retrieval,
  };
}
