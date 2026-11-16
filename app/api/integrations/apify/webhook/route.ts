import { privateJson } from "@/app/api/claude/_shared";
import { refillEngagementRecommendations } from "@/lib/automation/engagement-refill";
import {
  persistReplaySafeApifyContent,
  type ApifyContentInsertRow,
} from "@/lib/automation/apify-content-items";
import { recordApifyUsageEstimate } from "@/lib/automation/provider-usage";
import {
  apifyTerminalStatus,
  apifyRunTerminalStatus,
  apifyWebhookAuthorized,
  fetchApifyDatasetItems,
  fetchApifyRun,
  normalizeApifyDatasetItemResult,
  registeredSourceMatchesAuthor,
  type ApifyWebhookEvent,
} from "@/lib/integrations/apify";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MAX_WEBHOOK_BYTES = 256_000;

function error(message: string, status: number) {
  return privateJson({ error: message }, { status });
}

export async function POST(request: Request) {
  if (!apifyWebhookAuthorized(request)) return error("Unauthorized", 401);
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return error("JSON is required.", 415);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_WEBHOOK_BYTES) return error("Payload is too large.", 413);

  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_WEBHOOK_BYTES) {
    return error("Payload is too large.", 413);
  }
  let event: ApifyWebhookEvent;
  try {
    event = JSON.parse(raw) as ApifyWebhookEvent;
  } catch {
    return error("Invalid JSON.", 400);
  }

  const status = apifyTerminalStatus(event.eventType);
  const providerRunId = event.eventData?.actorRunId ?? event.resource?.id;
  if (!status || !providerRunId) return error("Unsupported event.", 400);

  const admin = createSupabaseAdminClient();
  if (!admin) return error("The private data connection is unavailable.", 500);
  const { data: run, error: runError } = await admin
    .from("content_scan_runs")
    .select(
      "id, tenant_id, source_id, provider_task_id, provider_user_id, provider_dataset_id, webhook_dispatch_id, status, reserved_cost_usd, pricing_snapshot, metadata, content_scan_sources!content_scan_runs_tenant_source_fkey(contact_id, want_to_know_id, platform, source_url)",
    )
    .eq("provider", "apify")
    .eq("provider_run_id", providerRunId)
    .maybeSingle();
  if (runError || !run) return error("Unknown scan run.", 404);

  const dispatchId = request.headers.get("x-apify-webhook-dispatch-id");
  if (
    run.webhook_dispatch_id ||
    ["succeeded", "failed", "aborted", "timed_out"].includes(run.status)
  ) {
    return privateJson({ ok: true, replay: true });
  }
  if (!dispatchId) return error("Webhook dispatch ID is required.", 400);

  let providerRun;
  try {
    providerRun = await fetchApifyRun(providerRunId);
  } catch {
    return error("Scan run could not be verified.", 502);
  }
  const verifiedStatus = apifyRunTerminalStatus(providerRun.status);
  if (!verifiedStatus || verifiedStatus !== status) {
    return error("Scan status mismatch.", 409);
  }
  if (
    (event.eventData?.actorTaskId &&
      event.eventData.actorTaskId !== run.provider_task_id) ||
    (providerRun.actorTaskId &&
      providerRun.actorTaskId !== run.provider_task_id)
  ) {
    return error("Scan task mismatch.", 409);
  }
  if (
    providerRun.userId &&
    run.provider_user_id &&
    providerRun.userId !== run.provider_user_id
  ) {
    return error("Scan account mismatch.", 409);
  }

  const claimedDataset =
    providerRun.defaultDatasetId ?? run.provider_dataset_id;
  if (
    run.provider_dataset_id &&
    claimedDataset &&
    run.provider_dataset_id !== claimedDataset
  ) {
    return error("Scan dataset mismatch.", 409);
  }
  const source = Array.isArray(run.content_scan_sources)
    ? run.content_scan_sources[0]
    : run.content_scan_sources;
  if (status === "succeeded" && (!claimedDataset || !source)) {
    return error("Scan output is unavailable.", 409);
  }

  const claimed = await admin
    .from("content_scan_runs")
    .update({
      webhook_dispatch_id: dispatchId,
      heartbeat_at: new Date().toISOString(),
    })
    .eq("tenant_id", run.tenant_id)
    .eq("id", run.id)
    .is("webhook_dispatch_id", null)
    .select("id")
    .maybeSingle();
  if (claimed.error || !claimed.data) {
    return privateJson({ ok: true, replay: true });
  }

  const finishedAt = new Date().toISOString();
  const usageRun = {
    id: run.id,
    tenant_id: run.tenant_id,
    provider_run_id: providerRunId,
    reserved_cost_usd: run.reserved_cost_usd,
    pricing_snapshot: run.pricing_snapshot,
    status,
  };
  if (status !== "succeeded") {
    await admin
      .from("content_scan_runs")
      .update({
        status,
        actual_cost_usd: providerRun.usageTotalUsd ?? null,
        error_message: `Apify run ${status.replace("_", " ")}.`,
        finished_at: finishedAt,
      })
      .eq("tenant_id", run.tenant_id)
      .eq("id", run.id);
    await admin
      .from("content_scan_sources")
      .update({
        last_error: `Apify run ${status.replace("_", " ")}.`,
      })
      .eq("tenant_id", run.tenant_id)
      .eq("id", run.source_id);
    await recordApifyUsageEstimate({
      admin,
      run: usageRun,
      providerCostUsd: providerRun.usageTotalUsd,
    }).catch(() => null);
    return privateJson({ ok: true, status });
  }
  try {
    const maxItems =
      typeof run.metadata?.max_items_per_run === "number"
        ? run.metadata.max_items_per_run
        : 20;
    const dataset = await fetchApifyDatasetItems(claimedDataset, maxItems);
    const rejectionReasons: Record<string, number> = {};
    const reject = (reason: string) => {
      rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
    };
    const normalized = dataset.flatMap((rawItem) => {
      const result = normalizeApifyDatasetItemResult(rawItem, source.platform);
      if (!result.item) {
        reject(result.rejection_reason ?? "unknown_normalization_failure");
        return [];
      }
      if (
        result.item.author_profile_url &&
        !registeredSourceMatchesAuthor(
          source.source_url,
          result.item.author_profile_url,
        )
      ) {
        reject("author_profile_does_not_match_registered_source");
        return [];
      }
      return [result.item];
    });
    const rows: ApifyContentInsertRow[] = normalized.map((item) => ({
      tenant_id: run.tenant_id,
      contact_id: source.contact_id,
      want_to_know_id: source.want_to_know_id,
      target_name: null,
      platform: item.platform,
      content_type: item.content_type,
      source_url: item.source_url,
      title: item.title,
      content: item.content,
      classification: null,
      relevance: null,
      published_at: item.published_at,
      observed_at: finishedAt,
      metrics: item.metrics,
      content_scan_source_id: run.source_id,
      provider: "apify",
      provider_item_id:
        typeof item.source_payload.provider_item_id === "string"
          ? item.source_payload.provider_item_id
          : null,
      provider_run_id: providerRunId,
      match_status: "matched",
      match_method: "registered_source",
      source_payload: {
        ...item.source_payload,
        provider_run_id: providerRunId,
        provider_dataset_id: claimedDataset,
      },
    }));

    const persisted = await persistReplaySafeApifyContent({
      admin,
      rows,
      ownership: {
        tenantId: run.tenant_id,
        sourceId: run.source_id,
        providerRunId,
        platform: source.platform,
        contactId: source.contact_id,
        wantToKnowId: source.want_to_know_id,
      },
    });

    await admin
      .from("content_scan_runs")
      .update({
        provider_dataset_id: claimedDataset,
        status: "succeeded",
        accepted_items: rows.length,
        inserted_items: persisted.insertedIds.length,
        rejected_items: Math.max(0, dataset.length - rows.length),
        metadata: {
          ...(run.metadata ?? {}),
          provider_replays: persisted.providerDuplicates,
          rejection_reasons: rejectionReasons,
        },
        actual_cost_usd: providerRun.usageTotalUsd ?? null,
        finished_at: finishedAt,
      })
      .eq("tenant_id", run.tenant_id)
      .eq("id", run.id);
    await admin
      .from("content_scan_sources")
      .update({
        last_completed_at: finishedAt,
        last_error: null,
      })
      .eq("tenant_id", run.tenant_id)
      .eq("id", run.source_id);
    await recordApifyUsageEstimate({
      admin,
      run: usageRun,
      providerCostUsd: providerRun.usageTotalUsd,
    }).catch(() => null);

    const { data: tenant } = await admin
      .from("tenants")
      .select("settings")
      .eq("id", run.tenant_id)
      .maybeSingle();
    if (tenant) {
      await refillEngagementRecommendations({
        admin,
        tenantId: run.tenant_id,
        settings: tenant.settings,
      });
    }
    await admin.from("audit_log").insert({
      tenant_id: run.tenant_id,
      actor_type: "system",
      action: "automation.content_scan_completed",
      table_name: "content_scan_runs",
      record_id: run.id,
      metadata: {
        provider_run_id: providerRunId,
        accepted_items: rows.length,
        inserted_items: persisted.insertedIds.length,
        rejected_items: Math.max(0, dataset.length - rows.length),
        provider_replays: persisted.providerDuplicates,
        rejection_reasons: rejectionReasons,
      },
    });

    return privateJson({
      ok: true,
      accepted: rows.length,
      inserted: persisted.insertedIds.length,
    });
  } catch {
    await admin
      .from("content_scan_runs")
      .update({
        status: "running",
        webhook_dispatch_id: null,
        error_message: "Scan output could not be processed.",
        finished_at: null,
      })
      .eq("tenant_id", run.tenant_id)
      .eq("id", run.id);
    await admin
      .from("content_scan_sources")
      .update({ last_error: "Scan output could not be processed." })
      .eq("tenant_id", run.tenant_id)
      .eq("id", run.source_id);
    return error("Scan output could not be processed.", 500);
  }
}
