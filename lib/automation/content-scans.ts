import type { AdminClient } from "@/lib/server-action-context";
import {
  configuredContentScanConnector,
  contentScanPlatforms,
  type ContentScanPlatform,
} from "@/lib/automation/content-scan-settings";
import { apifyConfigured, launchApifyTask } from "@/lib/integrations/apify";
import { normalizeExternalContentUrl } from "@/lib/engagement-source";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { providerPricingSnapshot } from "@/lib/provider-plans";
import { fetchWebsite } from "@/lib/enrichment/research";

type ScanSource = {
  id: string;
  tenant_id: string;
  contact_id: string | null;
  want_to_know_id: string | null;
  platform: ContentScanPlatform;
  source_url: string;
};

export async function syncContactContentScanSources({
  admin,
  tenantId,
  contactId,
}: {
  admin: AdminClient;
  tenantId: string;
  contactId: string;
}) {
  const { data: contact, error } = await admin
    .from("contacts")
    .select("id, linkedin, instagram, facebook, x_twitter, youtube, website")
    .eq("tenant_id", tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();
  if (error || !contact) return { registered: 0, error: true };

  const rows = contentScanPlatforms.flatMap((platform) => {
    const sourceUrl = normalizeExternalContentUrl(contact[platform] ?? "");
    return sourceUrl ? [{
      tenant_id: tenantId,
      contact_id: contactId,
      want_to_know_id: null,
      platform,
      source_url: sourceUrl,
      enabled: true,
    }] : [];
  });
  if (rows.length === 0) return { registered: 0, error: false };

  const { error: upsertError } = await admin.from("content_scan_sources").upsert(rows, {
    onConflict: "tenant_id,platform,source_url",
    ignoreDuplicates: true,
  });
  return { registered: upsertError ? 0 : rows.length, error: Boolean(upsertError) };
}

function nextScanAt(cadenceDays: number) {
  return new Date(Date.now() + cadenceDays * 86_400_000).toISOString();
}

function retryAt() {
  return new Date(Date.now() + 86_400_000).toISOString();
}

async function scanWebsiteSource({
  admin,
  tenantId,
  source,
  cadenceDays,
}: {
  admin: AdminClient;
  tenantId: string;
  source: ScanSource;
  cadenceDays: number;
}) {
  const observedAt = new Date().toISOString();
  const result = await fetchWebsite(source.source_url);
  if (!result.ok) {
    await admin
      .from("content_scan_sources")
      .update({ last_error: result.problem, next_scan_at: retryAt(), last_started_at: observedAt })
      .eq("tenant_id", tenantId)
      .eq("id", source.id);
    return { completed: false, error: result.problem };
  }

  const content = result.page.text.slice(0, 12_000);
  const { error } = await admin.from("content_items").upsert({
    tenant_id: tenantId,
    contact_id: source.contact_id,
    want_to_know_id: source.want_to_know_id,
    platform: "website",
    content_type: "website_snapshot",
    source_url: source.source_url,
    title: result.page.title,
    content,
    relevance: result.page.description,
    published_at: observedAt,
    observed_at: observedAt,
    metrics: {},
    source_payload: {
      final_url: result.finalUrl,
      description: result.page.description,
      outbound_links: result.page.links.slice(0, 40),
    },
    status: "available",
    content_scan_source_id: source.id,
    provider: "direct_web",
    provider_item_id: source.id,
    match_status: "matched",
    match_method: "saved_contact_website",
  }, { onConflict: "tenant_id,source_url" });
  if (error) {
    await admin
      .from("content_scan_sources")
      .update({ last_error: "Website evidence could not be saved.", next_scan_at: retryAt() })
      .eq("tenant_id", tenantId)
      .eq("id", source.id);
    return { completed: false, error: "save_failed" };
  }

  await admin
    .from("content_scan_sources")
    .update({
      last_started_at: observedAt,
      last_completed_at: observedAt,
      last_error: null,
      next_scan_at: nextScanAt(cadenceDays),
    })
    .eq("tenant_id", tenantId)
    .eq("id", source.id);
  return { completed: true, error: null };
}

export async function syncContentScanSources({
  admin,
  tenantId,
}: {
  admin: AdminClient;
  tenantId: string;
}) {
  const [contacts, prospects] = await Promise.all([
    admin
      .from("contacts")
      .select("id, linkedin, instagram, facebook, x_twitter, youtube, website")
      .eq("tenant_id", tenantId)
      .is("archived_at", null),
    admin
      .from("want_to_know")
      .select("id, linkedin")
      .eq("tenant_id", tenantId)
      .not("owner_selected_at", "is", null)
      .neq("stage", "graduated"),
  ]);
  if (contacts.error || prospects.error) {
    throw new Error("Content scan sources could not be loaded.");
  }

  const rows: Array<{
    tenant_id: string;
    contact_id: string | null;
    want_to_know_id: string | null;
    platform: ContentScanPlatform;
    source_url: string;
    enabled: boolean;
  }> = [];
  const seen = new Set<string>();
  for (const contact of contacts.data ?? []) {
    for (const platform of contentScanPlatforms) {
      const url = normalizeExternalContentUrl(contact[platform] ?? "");
      if (!url) continue;
      const key = `${platform}:${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        tenant_id: tenantId,
        contact_id: contact.id,
        want_to_know_id: null,
        platform,
        source_url: url,
        enabled: true,
      });
    }
  }
  for (const prospect of prospects.data ?? []) {
    const url = normalizeExternalContentUrl(prospect.linkedin ?? "");
    if (!url) continue;
    const key = `linkedin:${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      tenant_id: tenantId,
      contact_id: null,
      want_to_know_id: prospect.id,
      platform: "linkedin",
      source_url: url,
      enabled: true,
    });
  }

  if (rows.length > 0) {
    const { error } = await admin.from("content_scan_sources").upsert(rows, {
      onConflict: "tenant_id,platform,source_url",
    });
    if (error) throw new Error("Content scan sources could not be saved.");
  }

  const { data: existing, error: existingError } = await admin
    .from("content_scan_sources")
    .select("id, platform, source_url")
    .eq("tenant_id", tenantId)
    .eq("enabled", true);
  if (existingError) throw new Error("Content scan sources could not be reviewed.");
  const staleIds = (existing ?? [])
    .filter((source) => !seen.has(`${source.platform}:${source.source_url}`))
    .map((source) => source.id);
  if (staleIds.length > 0) {
    await admin
      .from("content_scan_sources")
      .update({ enabled: false })
      .eq("tenant_id", tenantId)
      .in("id", staleIds);
  }

  return { active: rows.length, disabled: staleIds.length };
}

export async function runContentScansForTenant({
  admin,
  tenantId,
  rawSettings,
  force = false,
  priorityWantToKnowIds = [],
  priorityContactIds = [],
  priorityPlatforms = [],
}: {
  admin: AdminClient;
  tenantId: string;
  rawSettings: unknown;
  force?: boolean;
  priorityWantToKnowIds?: string[];
  priorityContactIds?: string[];
  priorityPlatforms?: ContentScanPlatform[];
}) {
  const tenantSettings = normalizeTenantSettings(rawSettings);
  const settings = tenantSettings.automation.content_scans;
  const providerPlan = tenantSettings.providers.apify;
  const priorityIds = [...new Set(
    priorityWantToKnowIds
      .map((value) => value.trim())
      .filter((value) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value,
        ),
      ),
  )].slice(0, 10);
  const priorityBookContactIds = [...new Set(
    priorityContactIds
      .map((value) => value.trim())
      .filter((value) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value,
        ),
      ),
  )].slice(0, 10);
  const requestedPlatforms = [...new Set(priorityPlatforms)].filter((platform) =>
    contentScanPlatforms.includes(platform),
  );
  const targetedOwnerScan = priorityIds.length > 0 || priorityBookContactIds.length > 0;
  const targetedPlatformScan = requestedPlatforms.length > 0;
  const targetedScan = targetedOwnerScan || targetedPlatformScan;
  const prioritySourceLimit = Math.min(
    25,
    Math.max(
      1,
      targetedPlatformScan
        ? requestedPlatforms.length
        : (priorityIds.length + priorityBookContactIds.length) * contentScanPlatforms.length,
    ),
  );
  if (!settings.enabled) {
    return { started: 0, failed: 0, available: 0, status: "disabled" as const };
  }
  const sourceSync = await syncContentScanSources({ admin, tenantId });
  const apifyAvailable = providerPlan.enabled && apifyConfigured();
  const configuredPlatforms = contentScanPlatforms.filter(
    (platform) =>
      apifyAvailable &&
      platform !== "website" &&
      (!targetedPlatformScan || requestedPlatforms.includes(platform)) &&
      configuredContentScanConnector(settings, platform),
  );
  let websiteSources: ScanSource[] = [];
  if (!targetedPlatformScan || requestedPlatforms.includes("website")) {
    let websiteQuery = admin
      .from("content_scan_sources")
      .select("id, tenant_id, contact_id, want_to_know_id, platform, source_url")
      .eq("tenant_id", tenantId)
      .eq("enabled", true)
      .eq("platform", "website")
      .order("last_started_at", { ascending: true, nullsFirst: true })
      .order("next_scan_at", { ascending: true });
    if (targetedOwnerScan) {
      websiteQuery = priorityBookContactIds.length > 0
        ? websiteQuery.in("contact_id", priorityBookContactIds).limit(prioritySourceLimit)
        : websiteQuery.in("want_to_know_id", priorityIds).limit(prioritySourceLimit);
    } else if (targetedPlatformScan) {
      websiteQuery = websiteQuery.limit(1);
    } else {
      websiteQuery = websiteQuery.limit(Math.min(3, settings.daily_run_limit));
    }
    if (!force) websiteQuery = websiteQuery.lte("next_scan_at", new Date().toISOString());
    const { data, error } = await websiteQuery;
    if (error) throw new Error("Due website scans could not be loaded.");
    websiteSources = (data ?? []) as ScanSource[];
  }
  const websiteResults = await Promise.all(
    websiteSources.map((source) =>
      scanWebsiteSource({
        admin,
        tenantId,
        source,
        cadenceDays: settings.cadence_days,
      }),
    ),
  );
  const directWebsiteCompleted = websiteResults.filter((result) => result.completed).length;
  const directWebsiteFailed = websiteResults.length - directWebsiteCompleted;
  let started = directWebsiteCompleted;
  let failed = directWebsiteFailed;

  if (configuredPlatforms.length === 0) {
    return {
      started,
      failed,
      available: sourceSync.active,
      status:
        websiteResults.length > 0
          ? "started" as const
          : apifyAvailable
            ? "no_connectors" as const
            : providerPlan.enabled
              ? "not_configured" as const
              : "provider_disabled" as const,
    };
  }
  const buildSourceQuery = (platforms: ContentScanPlatform[]) => {
    let query = admin
      .from("content_scan_sources")
      .select(
        "id, tenant_id, contact_id, want_to_know_id, platform, source_url",
      )
      .eq("tenant_id", tenantId)
      .eq("enabled", true)
      .in("platform", platforms)
      // Never-scanned sources come first. Within that group, deliberate Want to
      // Know additions outrank the historical contact backlog.
      .order("last_started_at", { ascending: true, nullsFirst: true })
      .order("want_to_know_id", { ascending: true, nullsFirst: false })
      .order("next_scan_at", { ascending: true });
    if (targetedOwnerScan) {
      query = priorityBookContactIds.length > 0
        ? query.in("contact_id", priorityBookContactIds).limit(prioritySourceLimit)
        : query.in("want_to_know_id", priorityIds).limit(prioritySourceLimit);
    } else {
      query = query.limit(targetedPlatformScan ? 1 : settings.daily_run_limit);
    }
    if (!force) query = query.lte("next_scan_at", new Date().toISOString());
    return query;
  };

  let sources: ScanSource[] = [];
  if (targetedPlatformScan) {
    for (const platform of configuredPlatforms) {
      const { data, error } = await buildSourceQuery([platform]);
      if (error) throw new Error("Due content scans could not be loaded.");
      sources.push(...((data ?? []) as ScanSource[]));
    }
  } else {
    const { data, error } = await buildSourceQuery(configuredPlatforms);
    if (error) throw new Error("Due content scans could not be loaded.");
    sources = (data ?? []) as ScanSource[];
  }

  for (const source of sources) {
    const connector = configuredContentScanConnector(settings, source.platform);
    if (!connector) continue;

    const { data: runId, error: reservationError } = await admin.rpc(
      "lbb_reserve_content_scan_run",
      {
        p_tenant_id: tenantId,
        p_source_id: source.id,
        p_provider_task_id: connector.task_id,
        p_reserved_cost_usd: connector.max_charge_usd,
        // An explicit owner addition should not wait behind the ordinary daily
        // reservoir. Preserve the monthly budget and concurrency caps while
        // allowing this small targeted burst through the daily ceiling.
        p_daily_run_limit: Math.min(
          25,
          settings.daily_run_limit + (targetedScan ? prioritySourceLimit : 0),
        ),
        p_concurrent_run_limit: settings.concurrent_run_limit,
        p_monthly_budget_usd: Math.min(
          settings.monthly_budget_usd,
          providerPlan.monthly_cost_limit_usd,
        ),
        p_metadata: {
          platform: source.platform,
          max_items_per_run: connector.max_items_per_run,
          forced: force,
          owner_priority: targetedOwnerScan,
          platform_priority: targetedPlatformScan,
          priority_contact: priorityBookContactIds.includes(source.contact_id ?? ""),
        },
      },
    );
    if (reservationError || !runId) continue;

    try {
      const pricingSnapshot = providerPricingSnapshot("apify", providerPlan);
      const { error: pricingError } = await admin
        .from("content_scan_runs")
        .update({ pricing_snapshot: pricingSnapshot })
        .eq("tenant_id", tenantId)
        .eq("id", runId);
      if (pricingError) throw new Error("Scan pricing could not be recorded.");

      const providerRun = await launchApifyTask({
        connector,
        sourceUrl: source.source_url,
      });
      const { error: updateError } = await admin
        .from("content_scan_runs")
        .update({
          provider_run_id: providerRun.id,
          provider_dataset_id: providerRun.defaultDatasetId ?? null,
          provider_user_id: providerRun.userId ?? null,
          status: "running",
          heartbeat_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", runId)
        .eq("provider_task_id", connector.task_id);
      if (updateError) throw new Error("Scan run could not be recorded.");

      await admin
        .from("content_scan_sources")
        .update({
          last_started_at: new Date().toISOString(),
          next_scan_at: nextScanAt(settings.cadence_days),
          last_error: null,
        })
        .eq("tenant_id", tenantId)
        .eq("id", source.id);
      started += 1;
    } catch (launchError) {
      const message =
        launchError instanceof Error
          ? launchError.message.slice(0, 500)
          : "Apify scan could not be started.";
      await admin
        .from("content_scan_runs")
        .update({
          status: "failed",
          error_message: message,
          finished_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", runId);
      await admin
        .from("content_scan_sources")
        .update({ last_error: message, next_scan_at: retryAt() })
        .eq("tenant_id", tenantId)
        .eq("id", source.id);
      failed += 1;
    }
  }

  await admin.from("audit_log").insert({
    tenant_id: tenantId,
    actor_type: "system",
    action: "automation.content_scans_started",
    table_name: "content_scan_runs",
    metadata: {
      started,
      failed,
      available_sources: sourceSync.active,
      disabled_sources: sourceSync.disabled,
      forced: force,
      status:
        started > 0
          ? "started"
          : failed > 0
            ? "completed_with_failures"
            : sources.length === 0
              ? "no_due_sources"
              : "no_runs_reserved",
    },
  });

  const status =
    started > 0
      ? ("started" as const)
      : failed > 0
        ? ("completed_with_failures" as const)
        : sources.length === 0
          ? ("no_due_sources" as const)
          : ("no_runs_reserved" as const);

  return {
    started,
    failed,
    available: sourceSync.active,
    status,
  };
}
