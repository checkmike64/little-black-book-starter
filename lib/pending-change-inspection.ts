import {
  contactFieldLabel,
  isContactField,
  type ContactUpdates,
} from "./contact-fields.ts";
import {
  pendingChangeNeedsDetailedReview,
  reservedPendingChangePayloadKeys,
  sensitivePendingChangeFields,
} from "./pending-change-risk.ts";
import { isNewPersonChangeType } from "./pending-change-types.ts";

export type PendingChangeInspectionInput = {
  change_type: string;
  payload: Record<string, unknown>;
  risk_level?: string | null;
};

export type ProposedField = {
  key: string;
  label: string;
  value: unknown;
  before: unknown;
  sensitive: boolean;
  supported: boolean;
  willOverwrite: boolean;
};

const wantToKnowCandidateLabels: Record<string, string> = {
  full_name: "Full name",
  name: "Full name",
  bucket: "Prospecting bucket",
  lane: "Lane",
  stage: "Stage",
  company: "Company",
  source: "Source",
  why: "Why",
  linkedin: "LinkedIn",
  dossier: "Dossier",
  engagement_count: "Engagement count",
  last_touch: "Last touch",
};

export function formatInspectionValue(value: unknown): string {
  if (Array.isArray(value)) {
    const clean = value.map((item) => String(item).trim()).filter(Boolean);
    return clean.length > 0 ? clean.join(", ") : "Empty list";
  }

  if (value === null || value === undefined || value === "") return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function pendingChangePayloadBody({
  change_type,
  payload,
}: PendingChangeInspectionInput) {
  if (change_type === "want_to_know_candidate") {
    const candidate = payload.candidate ?? payload.fields;
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }

  if (change_type === "contact_candidate") {
    const candidate = payload.candidate;
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const legacy = candidate as Record<string, unknown>;
      const roleTitle =
        typeof legacy.role_title === "string" && legacy.role_title.trim()
          ? [legacy.role_title.trim()]
          : legacy.role_title;
      return Object.fromEntries(
        [
          ["full_name", legacy.full_name ?? legacy.name],
          ["company_name", legacy.company_name ?? legacy.company],
          ["email", legacy.email],
          ["phone", legacy.phone],
          ["linkedin", legacy.linkedin],
          ["website", legacy.website],
          ["role_title", roleTitle],
        ].filter((entry) => entry[1] !== null && entry[1] !== undefined && entry[1] !== ""),
      );
    }
  }

  const nested =
    isNewPersonChangeType(change_type)
      ? payload.contact ?? payload.fields
      : payload.fields ?? payload.contact;

  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }

  const legacyField = typeof payload.field === "string" ? payload.field.trim() : "";
  const legacyValue = payload.proposed_value ?? payload.proposed_addition;
  if (
    ["field_update", "contact_enrichment"].includes(change_type)
    && legacyField
    && legacyValue !== undefined
  ) {
    return { [legacyField]: legacyValue };
  }

  return payload;
}

export function pendingChangeSupportedFieldNames(change: PendingChangeInspectionInput) {
  if (change.change_type === "want_to_know_candidate") {
    return Object.keys(pendingChangePayloadBody(change)).filter(
      (field) => field in wantToKnowCandidateLabels,
    );
  }

  return Object.keys(pendingChangePayloadBody(change)).filter(
    (field) => !reservedPendingChangePayloadKeys.has(field) && isContactField(field),
  );
}

export function pendingChangeUnsupportedKeys(change: PendingChangeInspectionInput) {
  if (change.change_type === "want_to_know_candidate") {
    return Object.keys(pendingChangePayloadBody(change)).filter(
      (field) =>
        !reservedPendingChangePayloadKeys.has(field) &&
        !(field in wantToKnowCandidateLabels),
    );
  }

  return Object.keys(pendingChangePayloadBody(change)).filter(
    (field) => !reservedPendingChangePayloadKeys.has(field) && !isContactField(field),
  );
}

export function proposedFieldRows({
  before = {},
  change,
}: {
  before?: Record<string, unknown> | null;
  change: PendingChangeInspectionInput;
}): ProposedField[] {
  const sensitive = new Set(sensitivePendingChangeFields(change.payload));
  const body = pendingChangePayloadBody(change);
  const legacyAdditionField = change.payload.proposed_addition !== undefined
    && typeof change.payload.field === "string"
    ? change.payload.field.trim()
    : null;

  return Object.entries(body)
    .filter(([key, value]) => !reservedPendingChangePayloadKeys.has(key) && value !== undefined)
    .map(([key, value]) => {
      const beforeValue = before?.[key] ?? null;
      const proposedValue = key === legacyAdditionField && Array.isArray(beforeValue)
        ? [...new Set([...beforeValue, ...(Array.isArray(value) ? value : [value])])]
        : value;
      return {
        key,
        label:
          change.change_type === "want_to_know_candidate"
            ? (wantToKnowCandidateLabels[key] ?? key.replaceAll("_", " "))
            : contactFieldLabel(key),
        value: proposedValue,
        before: beforeValue,
        sensitive:
          change.change_type === "want_to_know_candidate" ? true : sensitive.has(key),
        supported:
          change.change_type === "want_to_know_candidate"
            ? key in wantToKnowCandidateLabels
            : isContactField(key),
        willOverwrite:
          beforeValue !== null &&
          beforeValue !== undefined &&
          formatInspectionValue(beforeValue) !== formatInspectionValue(proposedValue),
      };
    });
}

export function objectEntries(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];

  return Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== null && entry !== undefined && String(entry).length > 0)
    .slice(0, 8);
}

export function duplicateCandidates(payload: Record<string, unknown>) {
  const candidates = payload.duplicate_candidates;
  if (!Array.isArray(candidates)) return [];

  return candidates
    .map((candidate) =>
      candidate && typeof candidate === "object"
        ? (candidate as Record<string, unknown>)
        : null,
    )
    .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate))
    .slice(0, 5);
}

export function proposalConfidence(payload: Record<string, unknown>) {
  const raw = payload.confidence;
  if (typeof raw === "number") return `${Math.round(raw * 100)}%`;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return "Not provided";
}

function qualityCleanupMetadata(payload: Record<string, unknown>) {
  const cleanup = payload.quality_cleanup;
  if (!cleanup || typeof cleanup !== "object" || Array.isArray(cleanup)) return [];

  const details = cleanup as Record<string, unknown>;
  const jobId = typeof details.job_id === "string" ? details.job_id : null;
  const proposedFields = Array.isArray(details.proposed_fields)
    ? details.proposed_fields.map(String).filter(Boolean)
    : [];
  const blockedFields = Array.isArray(details.blocked_fields)
    ? details.blocked_fields.map(String).filter(Boolean)
    : [];

  return [
    jobId ? `Quality job: ${jobId.slice(0, 8)}` : null,
    proposedFields.length > 0
      ? `Quality proposed fields: ${proposedFields.join(", ")}`
      : null,
    blockedFields.length > 0
      ? `Still needs source/owner context: ${blockedFields.join(", ")}`
      : null,
  ].filter((item): item is string => Boolean(item));
}

function ownerContextMetadata(payload: Record<string, unknown>) {
  const context = payload.owner_context;
  if (!context || typeof context !== "object" || Array.isArray(context)) return [];

  const details = context as Record<string, unknown>;
  const status = typeof details.status === "string" ? details.status : null;
  const requestedAt =
    typeof details.requested_at === "string" ? details.requested_at : null;
  const answeredAt = typeof details.answered_at === "string" ? details.answered_at : null;
  const answer = typeof details.answer === "string" ? details.answer.trim() : "";

  return [
    status ? `Owner context: ${status.replaceAll("_", " ")}` : null,
    requestedAt ? `Context requested: ${requestedAt}` : null,
    answeredAt ? `Context answered: ${answeredAt}` : null,
    answer ? "Owner answer attached" : null,
  ].filter((item): item is string => Boolean(item));
}

function replacementMetadata(payload: Record<string, unknown>) {
  const replacement = payload.replacement;
  if (!replacement || typeof replacement !== "object" || Array.isArray(replacement)) {
    return [];
  }

  const details = replacement as Record<string, unknown>;
  const status = typeof details.status === "string" ? details.status : null;
  const replacementId =
    typeof details.replacement_pending_change_id === "string"
      ? details.replacement_pending_change_id
      : null;
  const originalId =
    typeof details.replaces_pending_change_id === "string"
      ? details.replaces_pending_change_id
      : null;

  return [
    status ? `Replacement status: ${status.replaceAll("_", " ")}` : null,
    replacementId ? `Replacement proposal: ${replacementId.slice(0, 8)}` : null,
    originalId ? `Replaces proposal: ${originalId.slice(0, 8)}` : null,
  ].filter((item): item is string => Boolean(item));
}

export function payloadMetadataSummary(payload: Record<string, unknown>) {
  return [
    payload.source_ref ? `Source ref: ${formatInspectionValue(payload.source_ref)}` : null,
    payload.confidence !== undefined ? `Confidence: ${proposalConfidence(payload)}` : null,
    ...qualityCleanupMetadata(payload),
    ...ownerContextMetadata(payload),
    ...replacementMetadata(payload),
  ].filter((item): item is string => Boolean(item));
}

export function reviewChecklist(change: PendingChangeInspectionInput) {
  if (isNewPersonChangeType(change.change_type)) {
    return [
      "Compare possible duplicates before adding a new person.",
      "Merge if this is an existing relationship with new context.",
      "Approval will queue post-approval enrichment and owner verification.",
    ];
  }

  if (change.change_type === "want_to_know_candidate") {
    return [
      "Confirm the person belongs in the outer-ring queue, not the Book yet.",
      "Confirm the bucket matches the client's current prospecting goal.",
      "Approval adds the candidate to Want to Know for research, warming, or graduation later.",
    ];
  }

  if (pendingChangeNeedsDetailedReview(change)) {
    return [
      "Read the evidence and verification notes before approving.",
      "Judgment fields should match what the owner would actually rely on.",
      "Approval writes provenance so the field can be traced later.",
    ];
  }

  return [
    "Confirm the proposed fields are factual and useful.",
    "Low-risk updates can be approved directly from the queue.",
    "Approval writes the field update plus audit and provenance rows.",
  ];
}

export function normalizePreviewUpdates(fields: ProposedField[]): ContactUpdates {
  return Object.fromEntries(
    fields
      .filter((field) => field.supported && field.value !== undefined && field.value !== null)
      .map((field) => [field.key, field.value]),
  ) as ContactUpdates;
}
