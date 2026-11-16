import { isNewPersonChangeType } from "./pending-change-types.ts";

export const reservedPendingChangePayloadKeys = new Set([
  "candidate",
  "source",
  "confidence",
  "evidence",
  "verification",
  "duplicate_candidates",
  "source_ref",
  "contact_id",
  "field",
  "proposed_value",
  "proposed_addition",
  "why",
  "reason",
  "rationale",
]);

const highJudgmentFields = new Set([
  "trust_level",
  "relationship_strength",
  "relationship_strength_override",
  "relationship_strength_reason",
  "relationship_type",
  "why_stay_in_touch",
  "ideal_referral",
  "do_not_refer_for",
  "could_refer_me_for",
  "referral_intro_blurb",
  "podcast_fit",
  "private_notes",
  "personal_notes",
]);

function payloadContact(payload: Record<string, unknown>) {
  const nested = payload.contact ?? payload.fields;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }

  const legacyField = typeof payload.field === "string" ? payload.field.trim() : "";
  const legacyValue = payload.proposed_value ?? payload.proposed_addition;
  if (legacyField && legacyValue !== undefined) {
    return { [legacyField]: legacyValue };
  }

  return payload;
}

export function pendingChangeFieldNames(payload: Record<string, unknown>) {
  return Object.keys(payloadContact(payload)).filter(
    (field) => !reservedPendingChangePayloadKeys.has(field),
  );
}

export function sensitivePendingChangeFields(payload: Record<string, unknown>) {
  return pendingChangeFieldNames(payload).filter((field) =>
    highJudgmentFields.has(field),
  );
}

export function pendingChangeNeedsDetailedReview(
  change: {
    change_type: string;
    payload: Record<string, unknown>;
    risk_level?: string | null;
  },
) {
  if (isNewPersonChangeType(change.change_type)) return true;
  if (change.change_type === "want_to_know_candidate") return true;
  if (change.risk_level === "high") return true;
  return sensitivePendingChangeFields(change.payload).length > 0;
}

export function pendingChangeRiskReason(
  change: {
    change_type: string;
    payload: Record<string, unknown>;
    risk_level?: string | null;
  },
) {
  const fields = sensitivePendingChangeFields(change.payload);

  if (isNewPersonChangeType(change.change_type)) {
    return "New people need duplicate review before they enter the Book.";
  }

  if (change.change_type === "want_to_know_candidate") {
    return "New Want to Know candidates need review before they enter the outer-ring prospecting queue.";
  }

  if (fields.length > 0) {
    return `Judgment fields require detailed review: ${fields
      .map((field) => field.replaceAll("_", " "))
      .join(", ")}.`;
  }

  if (change.risk_level === "high") {
    return "Claude marked this proposal high risk.";
  }

  return "Low-risk content update.";
}
