import type { AdminClient } from "@/lib/server-action-context";
import {
  normalizeProviderPricingSnapshot,
  providerBillableCents,
  providerCostCents,
  type ManagedProvider,
  type ProviderPricingSnapshot,
} from "@/lib/provider-plans";

export type ProviderBillingStatus = "estimated" | "final" | "credited";

export async function recordProviderUsage({
  admin,
  tenantId,
  provider,
  eventType,
  externalRef,
  providerCostUsd,
  pricingSnapshot,
  status,
  quantity = 1,
  unit = "run",
  metadata = {},
}: {
  admin: AdminClient;
  tenantId: string;
  provider: ManagedProvider;
  eventType: string;
  externalRef: string;
  providerCostUsd: number;
  pricingSnapshot: unknown;
  status: ProviderBillingStatus;
  quantity?: number;
  unit?: string;
  metadata?: Record<string, unknown>;
}) {
  const snapshot = normalizeProviderPricingSnapshot(pricingSnapshot, provider);
  const costCents = providerCostCents(providerCostUsd);
  const billableCents = providerBillableCents(costCents, snapshot);
  const { data, error } = await admin.rpc("lbb_record_provider_usage", {
    p_tenant_id: tenantId,
    p_provider: provider,
    p_event_type: eventType,
    p_external_ref: externalRef,
    p_quantity: quantity,
    p_unit: unit,
    p_provider_cost_cents: costCents,
    p_billable_cents: billableCents,
    p_billing_status: status,
    p_pricing_snapshot: snapshot,
    p_metadata: metadata,
  });
  if (error || !data) throw new Error("Provider usage could not be recorded.");

  return {
    usageEventId: data as string,
    providerCostCents: costCents,
    billableCents,
    pricingSnapshot: snapshot as ProviderPricingSnapshot,
  };
}

export function monthlyClientChargeCents({
  billableCents,
  includedUsageUsd,
}: {
  billableCents: number;
  includedUsageUsd: number;
}) {
  return Math.max(0, billableCents - providerCostCents(includedUsageUsd));
}
