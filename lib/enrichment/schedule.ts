// Pacing rules for the contact-enrichment worker. Pure for testing.

export const enrichmentMaxAttempts = 3;
export const enrichmentStaleLeaseMinutes = 20;
/** Due jobs older than this mean the queue is not keeping up. */
export const enrichmentQueueStaleHours = 24;

export function utcDayStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function utcMonthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Jobs that need a person in the loop (owner-context revisions and relationship
 * commands) stay in the queue for a Claude project; test jobs are never touched.
 */
export function workerCanProcessJob(payload: Record<string, unknown>) {
  if (payload.test_mode === true) return false;
  if (payload.trigger === "approved_contact_enrichment") return false;
  if (payload.trigger === "owner_context_revision") return false;
  if (payload.original_pending_change && typeof payload.original_pending_change === "object") return false;
  if (payload.command_focus && typeof payload.command_focus === "object") return false;
  return typeof payload.contact_id === "string" && payload.contact_id.length > 0;
}

/** Seconds before a failed job is retried. AI budget or configuration problems wait six hours. */
export function enrichmentRetryDelaySeconds(attempts: number, errorKind: string | null) {
  if (errorKind === "budget" || errorKind === "configuration") return 21_600;
  return Math.min(1_800 * Math.max(attempts, 1), 7_200);
}
