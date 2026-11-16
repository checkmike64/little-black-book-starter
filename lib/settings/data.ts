import { getPublicSupabaseEnv, getServiceRoleKey } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant-context";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { llmAutomationConfigured } from "@/lib/automation/llm";
import { apifyConfigured } from "@/lib/integrations/apify";
import { outscraperConfigured } from "@/lib/integrations/outscraper";
import { monthlyClientChargeCents } from "@/lib/provider-billing";
import {
  managedProviders,
  type ManagedProvider,
} from "@/lib/provider-plans";

export type SetupStatus = {
  label: string;
  value: string;
  tone: "ok" | "warn" | "neutral";
};

export async function getSettingsData() {
  const { hasEnv } = getPublicSupabaseEnv();
  const serviceRoleKey = getServiceRoleKey();
  const claudeTokensConfigured = [
    process.env.CLAUDE_READ_TOKEN,
    process.env.CLAUDE_JOB_TOKEN,
    process.env.CLAUDE_WRITE_TOKEN,
  ].every(Boolean);
  const supabase = await createSupabaseServerClient();
  const context = await getTenantContext();
  const settings = normalizeTenantSettings(context?.settings);

  let canReadContacts = false;
  let scanSourceCount = 0;
  let latestScan: {
    status: string;
    started_at: string;
    finished_at: string | null;
    accepted_items: number;
    inserted_items: number;
    error_message: string | null;
  } | null = null;
  const providerUsage = Object.fromEntries(
    managedProviders.map((provider) => [
      provider,
      {
        providerCostCents: 0,
        billableCents: 0,
        clientChargeCents: 0,
        finalized: 0,
        estimated: 0,
      },
    ]),
  ) as Record<
    ManagedProvider,
    {
      providerCostCents: number;
      billableCents: number;
      clientChargeCents: number;
      finalized: number;
      estimated: number;
    }
  >;

  if (supabase) {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [contactsResult, sourcesResult, latestScanResult, usageResult] =
      await Promise.all([
      supabase.from("contacts").select("id", { count: "exact", head: true }),
      supabase
        .from("content_scan_sources")
        .select("id", { count: "exact", head: true })
        .eq("enabled", true),
      supabase
        .from("content_scan_runs")
        .select(
          "status, started_at, finished_at, accepted_items, inserted_items, error_message",
        )
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("usage_events")
        .select(
          "provider, provider_cost_cents, billable_cents, billing_status",
        )
        .in("provider", [...managedProviders])
        .gte("created_at", monthStart.toISOString()),
    ]);

    canReadContacts = !contactsResult.error;
    scanSourceCount = sourcesResult.error ? 0 : (sourcesResult.count ?? 0);
    latestScan = latestScanResult.error ? null : latestScanResult.data;
    if (!usageResult.error) {
      for (const row of usageResult.data ?? []) {
        if (!managedProviders.includes(row.provider as ManagedProvider)) continue;
        const summary = providerUsage[row.provider as ManagedProvider];
        summary.providerCostCents += row.provider_cost_cents ?? 0;
        summary.billableCents += row.billable_cents ?? 0;
        if (row.billing_status === "final") summary.finalized += 1;
        if (row.billing_status === "estimated") summary.estimated += 1;
      }
    }
  }
  for (const provider of managedProviders) {
    providerUsage[provider].clientChargeCents = monthlyClientChargeCents({
      billableCents: providerUsage[provider].billableCents,
      includedUsageUsd: settings.providers[provider].included_usage_usd,
    });
  }

  const statuses: SetupStatus[] = [
    {
      label: "Supabase browser key and URL",
      value: hasEnv ? "Configured" : "Needed",
      tone: hasEnv ? "ok" : "warn",
    },
    {
      label: "RLS-protected data read path",
      value: canReadContacts ? "Verified" : "Needs check",
      tone: canReadContacts ? "ok" : "warn",
    },
    {
      label: "Tenant and member access",
      value: context ? "Verified" : "Needs check",
      tone: context ? "ok" : "warn",
    },
    {
      label: "Server-only Supabase secret",
      value: serviceRoleKey ? "Local only" : "Needed",
      tone: serviceRoleKey ? "ok" : "warn",
    },
    {
      label: "Claude capability tokens",
      value: claudeTokensConfigured ? "Configured" : "Needed",
      tone: claudeTokensConfigured ? "ok" : "warn",
    },
    {
      label: "In-app LLM automation",
      value: llmAutomationConfigured() ? "Configured" : "Optional",
      tone: llmAutomationConfigured() ? "ok" : "neutral",
    },
    {
      label: "Automatic content monitoring",
      value: apifyConfigured() ? "Connected" : "Optional",
      tone: apifyConfigured() ? "ok" : "neutral",
    },
    {
      label: "Managed Outscraper enrichment",
      value: outscraperConfigured() ? "Connected" : "Optional",
      tone: outscraperConfigured() ? "ok" : "neutral",
    },
    {
      label: "Daily automation secret",
      value: process.env.CRON_SECRET ? "Configured" : "Needed for schedule",
      tone: process.env.CRON_SECRET ? "ok" : "warn",
    },
    {
      label: "Vercel production environment",
      value: process.env.VERCEL ? "Configured" : "Pending deploy",
      tone: process.env.VERCEL ? "ok" : "neutral",
    },
  ];

  return {
    statuses,
    settings,
    tenantName: context?.tenantName ?? "Current install",
    role: context?.role ?? null,
    settingsVersion: context?.settingsVersion ?? 1,
    scanHealth: {
      configured: apifyConfigured(),
      sourceCount: scanSourceCount,
      latestScan,
    },
    providerHealth: {
      apifyConfigured: apifyConfigured(),
      outscraperConfigured: outscraperConfigured(),
      usage: providerUsage,
    },
  };
}
