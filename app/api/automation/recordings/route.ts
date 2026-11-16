import { privateJson } from "@/app/api/claude/_shared";
import {
  processQueuedRecordingReceipts,
  reconcileRecordingProviderReceipts,
} from "@/lib/integrations/recordings/ingest";
import { processPendingRecordingRevocations } from "@/lib/integrations/recordings/revocation";
import { processQueuedRecordingBaselines } from "@/lib/recordings/baseline-worker";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 240;
export const baselineClaimCutoffMs = 90_000;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`,
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return privateJson({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return privateJson(
      { error: "The private data connection is unavailable." },
      { status: 500 },
    );
  }

  const startedAt = Date.now();
  const { data: oldestDue, error: healthError } = await admin
    .from("recording_ingest_receipts")
    .select("id,next_attempt_at,tenant_id")
    .in("status", ["received", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (healthError) {
    return privateJson({ error: "Recording queue health is unavailable." }, { status: 500 });
  }

  try {
    let reconciliation: Awaited<ReturnType<typeof reconcileRecordingProviderReceipts>> | null = null;
    try {
      reconciliation = await reconcileRecordingProviderReceipts({ admin, providers: ["notion"] });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Notion reconciliation failed.";
      console.error("[automation.recordings] notion reconciliation failed", {
        error: message.slice(0, 500),
      });
    }
    const [result, revocations] = await Promise.all([
      processQueuedRecordingReceipts({ admin, limit: 8 }),
      processPendingRecordingRevocations({ admin, limit: 4 }),
    ]);
    const elapsedBeforeBaselineMs = Date.now() - startedAt;
    const baselines = elapsedBeforeBaselineMs <= baselineClaimCutoffMs
      ? await processQueuedRecordingBaselines({ admin })
      : {
          claimed: 0,
          succeeded: 0,
          retried: 0,
          failures: [],
          skipped: "insufficient_cron_headroom",
        };
    const oldestAgeSeconds = oldestDue?.next_attempt_at
      ? Math.max(0, Math.floor((startedAt - Date.parse(oldestDue.next_attempt_at)) / 1_000))
      : 0;
    if (oldestAgeSeconds > 900 && oldestDue?.tenant_id) {
      const { error: auditError } = await admin.from("audit_log").insert({
        tenant_id: oldestDue.tenant_id,
        actor_type: "system",
        action: "recording.queue_stale",
        table_name: "recording_ingest_receipts",
        record_id: oldestDue.id,
        metadata: { oldest_due_age_seconds: oldestAgeSeconds },
      });
      if (auditError) throw new Error("Recording queue alert could not be recorded.");
    }
    return privateJson({
      ...result,
      reconciliation,
      revocations,
      baselines,
      oldest_due_age_seconds: oldestAgeSeconds,
      duration_ms: Date.now() - startedAt,
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Recording queue failed.";
    console.error("[automation.recordings] failed", { error: message.slice(0, 500) });
    return privateJson({ error: "Recording queue processing failed." }, { status: 500 });
  }
}
