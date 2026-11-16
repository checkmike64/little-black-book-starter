export const INTRODUCTION_DRAFT_STALE_AFTER_MS = 2 * 60 * 1000;

export type IntroductionDraftStatus =
  | "idle"
  | "queued"
  | "running"
  | "ready"
  | "failed"
  | "stale";

export type IntroductionDraftState = {
  status: IntroductionDraftStatus;
  requestId: string | null;
  requestedAt: string | null;
  hasDraft: boolean;
};

function evidenceObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanEvidenceString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function introductionDraftState(input: {
  evidence: unknown;
  hasDraft: boolean;
  now?: number;
}): IntroductionDraftState {
  const evidence = evidenceObject(input.evidence);
  const storedStatus = cleanEvidenceString(evidence.draft_status);
  const requestId = cleanEvidenceString(evidence.draft_request_id);
  const requestedAt = cleanEvidenceString(evidence.draft_requested_at);
  const startedAt = cleanEvidenceString(evidence.draft_started_at);
  const activeAt = Date.parse(startedAt ?? requestedAt ?? "");
  const now = input.now ?? Date.now();

  if (
    (storedStatus === "queued" || storedStatus === "running") &&
    (!Number.isFinite(activeAt) || now - activeAt > INTRODUCTION_DRAFT_STALE_AFTER_MS)
  ) {
    return { status: "stale", requestId, requestedAt, hasDraft: input.hasDraft };
  }

  if (storedStatus === "queued" || storedStatus === "running") {
    return { status: storedStatus, requestId, requestedAt, hasDraft: input.hasDraft };
  }
  if (storedStatus === "failed") {
    return { status: "failed", requestId, requestedAt, hasDraft: input.hasDraft };
  }
  if (storedStatus === "ready" || input.hasDraft) {
    return { status: "ready", requestId, requestedAt, hasDraft: input.hasDraft };
  }
  return { status: "idle", requestId, requestedAt, hasDraft: input.hasDraft };
}

export function introductionDraftIsActive(status: IntroductionDraftStatus) {
  return status === "queued" || status === "running";
}
