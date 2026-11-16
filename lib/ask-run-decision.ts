export const askRunDecisionStatuses = [
  "follow_up_needed",
  "verified_no_action",
] as const;

export type AskRunDecisionStatus = (typeof askRunDecisionStatuses)[number];

export type AskRunDecision = {
  status: AskRunDecisionStatus;
  label: string;
  note: string;
  decided_at: string;
  decided_by?: string;
};

export function isAskRunDecisionStatus(value: unknown): value is AskRunDecisionStatus {
  return (
    typeof value === "string" &&
    (askRunDecisionStatuses as readonly string[]).includes(value)
  );
}

export function askRunDecisionLabel(status: AskRunDecisionStatus) {
  return status === "verified_no_action" ? "verified, no action" : "follow-up needed";
}

export function buildAskRunDecision({
  status,
  note = "",
  decidedAt = new Date().toISOString(),
  decidedBy,
}: {
  status: AskRunDecisionStatus;
  note?: string;
  decidedAt?: string;
  decidedBy?: string;
}): AskRunDecision {
  return {
    status,
    label: askRunDecisionLabel(status),
    note,
    decided_at: decidedAt,
    ...(decidedBy ? { decided_by: decidedBy } : {}),
  };
}

export function readAskRunDecision(answer: unknown): AskRunDecision | null {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;

  const decision = (answer as Record<string, unknown>).decision;
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    return null;
  }

  const record = decision as Record<string, unknown>;
  if (!isAskRunDecisionStatus(record.status)) return null;

  const label = typeof record.label === "string" && record.label.trim()
    ? record.label.trim()
    : askRunDecisionLabel(record.status);
  const note = typeof record.note === "string" ? record.note.trim() : "";
  const decidedAt = typeof record.decided_at === "string" && record.decided_at.trim()
    ? record.decided_at.trim()
    : "";
  const decidedBy = typeof record.decided_by === "string" && record.decided_by.trim()
    ? record.decided_by.trim()
    : undefined;

  return {
    status: record.status,
    label,
    note,
    decided_at: decidedAt,
    ...(decidedBy ? { decided_by: decidedBy } : {}),
  };
}

export function hasAskRunDecision(answer: unknown) {
  return Boolean(readAskRunDecision(answer));
}

export function askRunDecisionState(answer: unknown) {
  return hasAskRunDecision(answer) ? "decided" : "needs_decision";
}
