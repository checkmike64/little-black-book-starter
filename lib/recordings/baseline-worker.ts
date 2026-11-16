import { createAiGenerationLedger } from "@/lib/ai/ledger";
import { AiGenerationError, generateStructuredAi } from "@/lib/ai/router";
import {
  normalizeRecordingBaselineOutput,
  recordingBaselineEvidenceSources,
  recordingBaselinePrompt,
  recordingBaselineResolvedActionItems,
  recordingBaselineSchema,
  type RecordingBaselineModelOutput,
} from "@/lib/recordings/baseline";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export type ClaimedRecordingBaselineJob = {
  job_type: "recording_baseline" | "recording_baseline_operator";
  job_id: string;
  tenant_id: string;
  transcript_id: string;
  interaction_id: string;
  contact_id: string;
  owner_user_id: string;
  actor_user_id: string;
  attempts: number;
  lock_token: string;
  contact_updated_at: string;
  interaction_occurred_at: string;
  interaction_summary: string;
  meeting_title: string | null;
  meeting_action_items: unknown;
  contact_snapshot: Record<string, unknown>;
  transcript_sha256: string | null;
  provider: string | null;
  source_ref: string | null;
  is_first_confirmed_meeting: boolean;
};

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Recording baseline failed.")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 400);
}

function objectRows<T>(value: unknown) {
  return (Array.isArray(value) ? value : []).filter(
    (row): row is T => Boolean(row && typeof row === "object" && !Array.isArray(row)),
  );
}

export async function enqueueRecordingBaseline({
  admin,
  tenantId,
  transcriptId,
  actorUserId,
}: {
  admin: AdminClient;
  tenantId: string;
  transcriptId: string;
  actorUserId: string;
}) {
  const { data, error } = await admin.rpc("lbb_enqueue_recording_baseline", {
    p_tenant_id: tenantId,
    p_transcript_id: transcriptId,
    p_actor_user_id: actorUserId,
  });
  if (error) throw new Error(`Recording baseline could not be queued: ${error.message}`);
  return data;
}

function retryDelaySeconds(error: AiGenerationError | null) {
  if (error?.retryAfterSeconds !== null && error?.retryAfterSeconds !== undefined) {
    return Math.max(30, Math.min(error.retryAfterSeconds, 21_600));
  }
  if (error?.kind === "budget" || error?.kind === "configuration") return 21_600;
  return 300;
}

async function failBaselineJob({
  admin,
  job,
  error,
}: {
  admin: AdminClient;
  job: ClaimedRecordingBaselineJob;
  error: unknown;
}) {
  const classified = error instanceof AiGenerationError ? error : null;
  const failureRpc = job.job_type === "recording_baseline_operator"
    ? "lbb_fail_operator_recording_baseline_job"
    : "lbb_fail_recording_baseline_job";
  const { data, error: finishError } = await admin.rpc(
    failureRpc,
    {
      p_job_id: job.job_id,
      p_lock_token: job.lock_token,
      p_error_kind: classified?.kind ?? "unavailable",
      p_error_code: classified?.code ?? "recording_baseline_failed",
      p_error: safeError(error),
      p_retry_after_seconds: retryDelaySeconds(classified),
    },
  );
  if (finishError) {
    throw new Error(`Recording baseline failure could not be saved: ${finishError.message}`);
  }
  return data;
}

function validClaim(job: ClaimedRecordingBaselineJob) {
  const snapshot = job.contact_snapshot;
  return Boolean(
    job.job_id
    && ["recording_baseline", "recording_baseline_operator"].includes(job.job_type)
    && job.tenant_id
    && job.transcript_id
    && job.interaction_id
    && job.contact_id
    && job.owner_user_id
    && job.actor_user_id
    && job.lock_token
    && job.interaction_summary?.trim()
    && snapshot
    && typeof snapshot === "object"
    && !Array.isArray(snapshot)
    && snapshot.id === job.contact_id
    && typeof snapshot.full_name === "string"
    && snapshot.full_name.trim()
  );
}

async function processBaselineJob(admin: AdminClient, job: ClaimedRecordingBaselineJob) {
  if (!validClaim(job)) {
    throw new AiGenerationError(
      "configuration",
      "recording_baseline_claim_invalid",
      "The recording baseline claim was incomplete or inconsistent.",
    );
  }
  const resolvedActionItems = recordingBaselineResolvedActionItems(job.meeting_action_items);
  const evidenceSources = recordingBaselineEvidenceSources(
    job.interaction_summary,
    resolvedActionItems,
  );
  const prompt = recordingBaselinePrompt({
    contact_display_name: String(job.contact_snapshot.full_name),
    evidence_sources: evidenceSources,
  });
  const generated = await generateStructuredAi<RecordingBaselineModelOutput>({
    task: "recording_baseline",
    system: prompt.system,
    prompt: prompt.prompt,
    schema: recordingBaselineSchema,
    context: {
      tenantId: job.tenant_id,
      userId: job.actor_user_id,
      promptVersion: "recording_baseline_v2",
      tags: ["trigger:recordings-cron"],
      ledger: createAiGenerationLedger(admin),
    },
  });
  const normalized = normalizeRecordingBaselineOutput(
    generated.output,
    evidenceSources.join("\n"),
  );
  const applyRpc = job.job_type === "recording_baseline_operator"
    ? "lbb_apply_operator_recording_baseline"
    : "lbb_apply_recording_baseline";
  const { data, error } = await admin.rpc(applyRpc, {
    p_job_id: job.job_id,
    p_lock_token: job.lock_token,
    p_prompt_version: generated.promptVersion,
    p_gateway_generation_id: generated.gatewayGenerationId,
    p_suggestions: normalized.suggestions,
  });
  if (error) throw new Error(`Recording baseline could not be applied: ${error.message}`);
  return { data, suggestionCount: Object.keys(normalized.suggestions).length };
}

export async function processQueuedRecordingBaselines({
  admin,
}: {
  admin: AdminClient;
}) {
  const { data, error } = await admin.rpc("lbb_claim_next_recording_baseline_job", {
    p_lease_seconds: 300,
  });
  if (error) throw new Error(`Recording baseline queue could not be claimed: ${error.message}`);
  const jobs = objectRows<ClaimedRecordingBaselineJob>(data);
  let succeeded = 0;
  let retried = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (const job of jobs) {
    try {
      await processBaselineJob(admin, job);
      succeeded += 1;
    } catch (caught) {
      try {
        await failBaselineJob({ admin, job, error: caught });
        retried += 1;
      } catch (finishError) {
        failures.push({ id: job.job_id, error: safeError(finishError) });
      }
      console.error("recording_baseline_failed", {
        jobType: job.job_type,
        jobId: job.job_id,
        tenantId: job.tenant_id,
        contactId: job.contact_id,
        attempts: job.attempts,
        error: safeError(caught),
      });
    }
  }

  return { claimed: jobs.length, succeeded, retried, failures };
}
