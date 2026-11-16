export const RELATIONSHIP_ACTION_TYPES = [
  "follow_up",
  "reconnect",
  "promise",
  "introduction",
  "referral",
  "podcast",
  "owner_verification",
  "claude_draft",
  "other",
] as const;

export const RELATIONSHIP_ACTION_PRIORITIES = ["low", "normal", "high"] as const;
export const RELATIONSHIP_ACTION_STATUSES = [
  "open",
  "deferred",
  "done",
  "skipped",
] as const;

export type RelationshipActionType = (typeof RELATIONSHIP_ACTION_TYPES)[number];
export type RelationshipActionPriority =
  (typeof RELATIONSHIP_ACTION_PRIORITIES)[number];
export type RelationshipActionStatus =
  (typeof RELATIONSHIP_ACTION_STATUSES)[number];

export type RelationshipActionCompletionState = {
  previousStatus: RelationshipActionStatus | string | null;
  nextStatus: RelationshipActionStatus;
  previousCompletedAt: string | null;
  now: string;
};

type FormLike = Pick<FormData, "get">;

export function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function cleanTextValue(value: unknown, maxLength = 500) {
  const clean = String(value ?? "").trim().slice(0, maxLength);
  return clean || null;
}

export function cleanDateValue(value: unknown) {
  const clean = cleanTextValue(value, 10);
  return clean && /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : null;
}

export function cleanChoice<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
) {
  const clean = String(value ?? "").trim();
  return allowed.includes(clean) ? clean : fallback;
}

export function parseRelationshipActionCreateForm(formData: FormLike) {
  const contactId = String(formData.get("contact_id") ?? "");
  const title = cleanTextValue(formData.get("title"), 500);
  const source = cleanTextValue(formData.get("source"), 120) ?? "contact_profile";

  return {
    contactId,
    contactIdValid: isValidUuid(contactId),
    title,
    titleValid: Boolean(title),
    actionType: cleanChoice(
      formData.get("action_type"),
      RELATIONSHIP_ACTION_TYPES,
      "follow_up",
    ) as RelationshipActionType,
    priority: cleanChoice(
      formData.get("priority"),
      RELATIONSHIP_ACTION_PRIORITIES,
      "normal",
    ) as RelationshipActionPriority,
    dueOn: cleanDateValue(formData.get("due_on")),
    evidenceSummary: cleanTextValue(formData.get("evidence_summary"), 1000),
    notes: cleanTextValue(formData.get("notes"), 1200),
    source,
    sourceRef: cleanTextValue(formData.get("source_ref"), 200),
  };
}

export function parseRelationshipActionStatusForm(formData: FormLike) {
  const actionId = String(formData.get("action_id") ?? "");
  const contactId = String(formData.get("contact_id") ?? "");
  const status = cleanChoice(
    formData.get("status"),
    RELATIONSHIP_ACTION_STATUSES,
    "open",
  ) as RelationshipActionStatus;

  return {
    actionId,
    actionIdValid: isValidUuid(actionId),
    contactId,
    contactIdValid: isValidUuid(contactId),
    status,
    statusNote: cleanTextValue(formData.get("status_note"), 1000),
    completedAtRequired: status === "done" || status === "skipped",
  };
}

export function parseRelationshipActionMovementUpdateForm(formData: FormLike) {
  const actionId = String(formData.get("action_id") ?? "");
  const status = cleanChoice(
    formData.get("status"),
    RELATIONSHIP_ACTION_STATUSES,
    "open",
  ) as RelationshipActionStatus;
  const priority = cleanChoice(
    formData.get("priority"),
    RELATIONSHIP_ACTION_PRIORITIES,
    "normal",
  ) as RelationshipActionPriority;

  return {
    actionId,
    actionIdValid: isValidUuid(actionId),
    status,
    priority,
    dueOn: cleanDateValue(formData.get("due_on")),
    statusNote: cleanTextValue(formData.get("status_note"), 1000),
    completedAtRequired: status === "done" || status === "skipped",
  };
}

export function relationshipActionStatusNeedsNote(status: RelationshipActionStatus) {
  return status === "deferred" || status === "skipped";
}

export function relationshipActionNotesWithStatusNote({
  existingNotes,
  nextStatus,
  now,
  statusNote,
}: {
  existingNotes: string | null;
  nextStatus: RelationshipActionStatus;
  now: string;
  statusNote: string | null;
}) {
  if (!statusNote || !relationshipActionStatusNeedsNote(nextStatus)) {
    return existingNotes;
  }

  const date = now.slice(0, 10);
  const entry = `[${date}] ${nextStatus}: ${statusNote}`;
  return [existingNotes, entry].filter(Boolean).join("\n");
}

export function relationshipActionCompletedAt({
  previousStatus,
  nextStatus,
  previousCompletedAt,
  now,
}: RelationshipActionCompletionState) {
  const wasTerminal = previousStatus === "done" || previousStatus === "skipped";
  const isTerminal = nextStatus === "done" || nextStatus === "skipped";

  if (isTerminal) {
    return wasTerminal ? previousCompletedAt : now;
  }

  return null;
}
