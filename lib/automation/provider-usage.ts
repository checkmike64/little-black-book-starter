import type { AdminClient } from "@/lib/server-action-context";
import { apifyConfigured, fetchApifyRun } from "@/lib/integrations/apify";
import { recordProviderUsage } from "@/lib/provider-billing";

type ApifyUsageRun = {
  id: string;
  tenant_id: string;
  provider_run_id: string;
  reserved_cost_usd: number;
  pricing_snapshot: unknown;
  status: string;
};

export async function recordApifyUsageEstimate({
  admin,
  run,
  providerCostUsd,
}: {
  admin: AdminClient;
  run: ApifyUsageRun;
  providerCostUsd: number | null | undefined;
}) {
  const usage = await recordProviderUsage({
    admin,
    tenantId: run.tenant_id,
    provider: "apify",
    eventType: "provider.apify.content_scan",
    externalRef: run.provider_run_id,
    providerCostUsd:
      typeof providerCostUsd === "number"
        ? providerCostUsd
        : run.reserved_cost_usd,
    pricingSnapshot: run.pricing_snapshot,
    status: "estimated",
    metadata: {
      content_scan_run_id: run.id,
      run_status: run.status,
    },
  });

  await admin
    .from("content_scan_runs")
    .update({
      usage_event_id: usage.usageEventId,
      billable_cost_usd: usage.billableCents / 100,
    })
    .eq("tenant_id", run.tenant_id)
    .eq("id", run.id);

  return usage;
}

export async function reconcileApifyUsageForTenant({
  admin,
  tenantId,
}: {
  admin: AdminClient;
  tenantId: string;
}) {
  if (!apifyConfigured()) return { reviewed: 0, finalized: 0, failed: 0 };

  const settleBefore = new Date(Date.now() - 15_000).toISOString();
  const { data, error } = await admin
    .from("content_scan_runs")
    .select(
      "id, tenant_id, provider_run_id, reserved_cost_usd, pricing_snapshot, status",
    )
    .eq("tenant_id", tenantId)
    .eq("provider", "apify")
    .in("status", ["succeeded", "failed", "aborted", "timed_out"])
    .not("provider_run_id", "is", null)
    .is("cost_finalized_at", null)
    .lt("finished_at", settleBefore)
    .order("finished_at", { ascending: true })
    .limit(25);
  if (error) throw new Error("Provider usage reconciliation could not be loaded.");

  let finalized = 0;
  let failed = 0;
  for (const run of (data ?? []) as ApifyUsageRun[]) {
    try {
      const providerRun = await fetchApifyRun(run.provider_run_id);
      if (typeof providerRun.usageTotalUsd !== "number") continue;
      const usage = await recordProviderUsage({
        admin,
        tenantId,
        provider: "apify",
        eventType: "provider.apify.content_scan",
        externalRef: run.provider_run_id,
        providerCostUsd: providerRun.usageTotalUsd,
        pricingSnapshot: run.pricing_snapshot,
        status: "final",
        metadata: {
          content_scan_run_id: run.id,
          run_status: run.status,
        },
      });
      const { error: updateError } = await admin
        .from("content_scan_runs")
        .update({
          actual_cost_usd: providerRun.usageTotalUsd,
          billable_cost_usd: usage.billableCents / 100,
          usage_event_id: usage.usageEventId,
          cost_finalized_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", run.id);
      if (updateError) throw new Error("Provider cost could not be finalized.");
      finalized += 1;
    } catch {
      failed += 1;
    }
  }

  return { reviewed: data?.length ?? 0, finalized, failed };
}
