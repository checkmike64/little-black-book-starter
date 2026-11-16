import {
  authenticateClaudeRequest,
  cleanText,
  isValidUuid,
  jsonError,
  privateJson,
  readClaudeJson,
  tenantIdFrom,
} from "@/app/api/claude/_shared";

type FailJobRequest = {
  tenant_id?: string;
  error?: string;
  retry_after_seconds?: number;
  terminal?: boolean;
  result?: Record<string, unknown>;
};

type JobRow = {
  id: string;
  tenant_id: string;
  job_type: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  attempts: number;
};

const maxAttempts = 3;

function retryDelaySeconds(value: unknown, attempts: number) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 60) {
    return Math.min(Math.round(value), 24 * 60 * 60);
  }

  return Math.min(15 * 60 * attempts, 4 * 60 * 60);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { admin, error } = authenticateClaudeRequest(request, "jobs");
  if (error) return error;

  const { id } = await params;
  if (!isValidUuid(id)) {
    return jsonError("Valid job id is required.");
  }

  const parsed = await readClaudeJson<FailJobRequest>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  const tenantId = tenantIdFrom(body.tenant_id);
  if (!tenantId) {
    return jsonError("Valid tenant_id is required.");
  }

  const errorText = cleanText(body.error, 1200);
  if (!errorText) {
    return jsonError("A failure error message is required.");
  }

  const { data: existing, error: fetchError } = await admin
    .from("jobs")
    .select("id, tenant_id, job_type, status, payload, result, attempts")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return jsonError(fetchError.message, 500);
  }

  if (!existing) {
    return jsonError("Job not found.", 404);
  }

  const job = existing as JobRow;
  if (job.status !== "running") {
    return jsonError("Only running jobs can be failed or retried.", 409);
  }

  const failedAt = new Date().toISOString();
  const terminal = body.terminal === true || job.attempts >= maxAttempts;
  const nextStatus = terminal ? "failed" : "queued";
  const delaySeconds = retryDelaySeconds(body.retry_after_seconds, job.attempts);
  const runAfter = terminal
    ? null
    : new Date(Date.now() + delaySeconds * 1000).toISOString();

  const result = {
    ...(job.result ?? {}),
    ...(body.result ?? {}),
    last_error: errorText,
    failed_at: failedAt,
    terminal,
    retry_after_seconds: terminal ? null : delaySeconds,
  };

  const updatePayload = terminal
    ? {
        status: nextStatus,
        result,
        locked_at: null,
      }
    : {
        status: nextStatus,
        result,
        locked_at: null,
        run_after: runAfter,
      };

  const { data: updated, error: updateError } = await admin
    .from("jobs")
    .update(updatePayload)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .eq("status", "running")
    .select("id, status, run_after, result")
    .single();

  if (updateError || !updated) {
    return jsonError(updateError?.message ?? "Job failure could not be saved.", 500);
  }

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: tenantId,
      actor_type: "claude",
      action: terminal ? "job.failed" : "job.retry_scheduled",
      table_name: "jobs",
      record_id: id,
      before: {
        status: "running",
      },
      after: {
        status: nextStatus,
        run_after: runAfter,
        result,
      },
      metadata: {
        job_type: job.job_type,
        contact_id:
          typeof job.payload.contact_id === "string" ? job.payload.contact_id : null,
        attempts: job.attempts,
      },
    }),
    admin.from("usage_events").insert({
      tenant_id: tenantId,
      actor_type: "claude",
      event_type: terminal ? "job_failed" : "job_retry_scheduled",
      quantity: 1,
      unit: "job",
      metadata: {
        job_id: id,
        job_type: job.job_type,
        attempts: job.attempts,
        retry_after_seconds: terminal ? null : delaySeconds,
      },
    }),
  ]);

  return privateJson({
    id,
    status: nextStatus,
    terminal,
    run_after: runAfter,
  });
}
