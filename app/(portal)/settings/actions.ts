"use server";

import { revalidatePath } from "next/cache";
import { featureModules, type ModuleKey } from "@/lib/modules";
import { parseProspectingBucketLines } from "@/lib/prospecting-buckets";
import { requireOperatorAccess } from "@/lib/operator-access";
import {
  requireOperatorTenantActionContext,
  type TenantActionContext,
} from "@/lib/server-action-context";
import {
  normalizeTenantSettings,
  type TenantSettings,
} from "@/lib/tenant-settings";
import {
  contentScanPlatforms,
  type ContentScanPlatform,
  type ContentScanInputFormat,
} from "@/lib/automation/content-scan-settings";
import { redirectWithMessage } from "@/lib/server-action-redirect";
import { runContentScansForTenant } from "@/lib/automation/content-scans";

type SettingsSection = "install" | "intake";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanText(formData: FormData, key: string, maxLength = 2500) {
  return String(formData.get(key) ?? "").trim().slice(0, maxLength);
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function numberField(formData: FormData, key: string, fallback: number) {
  const raw = Number(String(formData.get(key) ?? ""));
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.round(raw), 0), 10000);
}

/** A date input ("YYYY-MM-DD") read as the end of that UTC day; empty clears it. */
function catchupUntilField(formData: FormData, key: string) {
  const raw = cleanText(formData, key, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw))
    ? `${raw}T23:59:59.000Z`
    : null;
}

function decimalField(formData: FormData, key: string, fallback: number) {
  const raw = Number(String(formData.get(key) ?? ""));
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.round(raw * 100) / 100, 0.01), 25);
}

function moneyField(formData: FormData, key: string, fallback: number) {
  const raw = Number(String(formData.get(key) ?? ""));
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.round(raw * 100) / 100, 0), 10_000);
}

function percentField(formData: FormData, key: string, fallback: number) {
  const raw = Number(String(formData.get(key) ?? ""));
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.round(raw * 100) / 100, 0), 500);
}

function settingsVersion(formData: FormData) {
  const value = Number.parseInt(String(formData.get("settings_version") ?? ""), 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function settingsRedirect(section: SettingsSection, message: string): never {
  const path = section === "intake" ? "/intake" : "/settings";
  redirectWithMessage(path, message);
}

async function saveSettings(
  { admin, context }: TenantActionContext,
  nextSettings: TenantSettings,
  section: SettingsSection,
  action: string,
  expectedVersion: number | null,
) {
  if (!expectedVersion) {
    settingsRedirect(section, "Refresh this page before saving settings.");
  }
  const existing = isRecord(context.settings) ? context.settings : {};
  const mergedSettings = {
    ...existing,
    keep_in_touch: nextSettings.keep_in_touch,
    modules: nextSettings.modules,
    quotas: nextSettings.quotas,
    write_rules: nextSettings.write_rules,
    onboarding: nextSettings.onboarding,
    prospecting: nextSettings.prospecting,
    activity: nextSettings.activity,
    automation: nextSettings.automation,
    providers: nextSettings.providers,
    delivery: nextSettings.delivery,
    voice_profile: nextSettings.voice_profile,
  };

  const { data: updatedTenant, error } = await admin.rpc(
    "lbb_update_tenant_settings",
    {
      p_tenant_id: context.tenantId,
      p_actor_user_id: context.userId,
      p_expected_version: expectedVersion,
      p_settings: mergedSettings,
      p_action: action,
    },
  );

  if (error || !updatedTenant) {
    if (error?.code === "40001") {
      settingsRedirect(
        section,
        "These settings changed in another session. Refresh and review before saving again.",
      );
    }
    settingsRedirect(section, "Settings could not be saved.");
  }

  revalidatePath("/settings");
  revalidatePath("/intake");
  revalidatePath("/dashboard");
  revalidatePath("/movement");
  revalidatePath("/scoreboard");
}

export async function updateInstallSettings(formData: FormData) {
  await requireOperatorAccess();
  const actionContext = await requireOperatorTenantActionContext(
    () => settingsRedirect("install", "Supabase admin environment is not configured."),
    () =>
      redirectWithMessage(
        "/dashboard",
        "Setup tools are operator-only for this install.",
      ),
  );

  const current = normalizeTenantSettings(actionContext.context.settings);
  const apifyMonthlyCostLimit = moneyField(
    formData,
    "provider_apify_monthly_cost_limit",
    current.providers.apify.monthly_cost_limit_usd,
  );
  const modules = Object.fromEntries(
    featureModules.map((module) => [
      module.key,
      checked(formData, `module_${module.key}`),
    ]),
  ) as Record<ModuleKey, boolean>;

  await saveSettings(
    actionContext,
    {
      ...current,
      modules,
      keep_in_touch: {
        tier_1_days: Math.min(3650, Math.max(1, numberField(formData, "tier_1_days", current.keep_in_touch.tier_1_days))),
        tier_2_days: Math.min(3650, Math.max(1, numberField(formData, "tier_2_days", current.keep_in_touch.tier_2_days))),
        tier_3_days: Math.min(3650, Math.max(1, numberField(formData, "tier_3_days", current.keep_in_touch.tier_3_days))),
      },
      quotas: {
        enrichment_monthly: numberField(
          formData,
          "enrichment_monthly",
          current.quotas.enrichment_monthly,
        ),
        pulse_posts_monthly: numberField(
          formData,
          "pulse_posts_monthly",
          current.quotas.pulse_posts_monthly,
        ),
        claude_writes_daily: numberField(
          formData,
          "claude_writes_daily",
          current.quotas.claude_writes_daily,
        ),
      },
      write_rules: {
        ...current.write_rules,
        mechanical_writes: checked(formData, "mechanical_writes"),
        transcript_storage:
          formData.get("transcript_storage") === "detailed_notes"
            ? "detailed_notes"
            : "intake_full_then_notes",
      },
      activity: {
        engagement_daily_floor: numberField(
          formData,
          "engagement_daily_floor",
          current.activity.engagement_daily_floor,
        ),
        engagement_daily_limit: numberField(
          formData,
          "engagement_daily_limit",
          current.activity.engagement_daily_limit,
        ),
        networking_daily_limit: numberField(
          formData,
          "networking_daily_limit",
          current.activity.networking_daily_limit,
        ),
        engagement_more_batch: numberField(
          formData,
          "engagement_more_batch",
          current.activity.engagement_more_batch,
        ),
        networking_more_batch: numberField(
          formData,
          "networking_more_batch",
          current.activity.networking_more_batch,
        ),
        want_to_know_daily_limit: numberField(
          formData,
          "want_to_know_daily_limit",
          current.activity.want_to_know_daily_limit,
        ),
        want_to_know_engagements_monthly: numberField(
          formData,
          "want_to_know_engagements_monthly",
          current.activity.want_to_know_engagements_monthly,
        ),
        time_zone:
          cleanText(formData, "activity_time_zone", 80) ||
          current.activity.time_zone,
      },
      automation: {
        llm_ranking_enabled: checked(formData, "llm_ranking_enabled"),
        content_scans: {
          enabled: checked(formData, "content_scans_enabled"),
          cadence_days: numberField(
            formData,
            "content_scan_cadence_days",
            current.automation.content_scans.cadence_days,
          ),
          daily_run_limit: numberField(
            formData,
            "content_scan_daily_limit",
            current.automation.content_scans.daily_run_limit,
          ),
          concurrent_run_limit: numberField(
            formData,
            "content_scan_concurrent_limit",
            current.automation.content_scans.concurrent_run_limit,
          ),
          monthly_budget_usd: apifyMonthlyCostLimit,
          connectors: contentScanPlatforms.map((platform) => {
            const existing =
              current.automation.content_scans.connectors.find(
                (connector) => connector.platform === platform,
              )!;
            return {
              platform,
              enabled: checked(formData, `scan_${platform}_enabled`),
              task_id: cleanText(
                formData,
                `scan_${platform}_task_id`,
                160,
              ),
              input_field:
                cleanText(
                  formData,
                  `scan_${platform}_input_field`,
                  80,
                ) || existing.input_field,
              input_format: (formData.get(`scan_${platform}_input_format`) ===
              "request_list"
                ? "request_list"
                : "string_array") as ContentScanInputFormat,
              limit_field:
                cleanText(
                  formData,
                  `scan_${platform}_limit_field`,
                  80,
                ) || existing.limit_field,
              max_items_per_run: numberField(
                formData,
                `scan_${platform}_max_items`,
                existing.max_items_per_run,
              ),
              max_charge_usd: decimalField(
                formData,
                `scan_${platform}_max_charge`,
                existing.max_charge_usd,
              ),
            };
          }),
        },
        enrichment: {
          enabled: checked(formData, "enrichment_enabled"),
          daily_limit: Math.min(
            numberField(formData, "enrichment_daily_limit", current.automation.enrichment.daily_limit),
            200,
          ),
          catchup_until: catchupUntilField(formData, "enrichment_catchup_until"),
          catchup_daily_limit: Math.min(
            numberField(
              formData,
              "enrichment_catchup_daily_limit",
              current.automation.enrichment.catchup_daily_limit,
            ),
            500,
          ),
        },
      },
      providers: {
        apify: {
          enabled: checked(formData, "provider_apify_enabled"),
          credential_owner: "operator",
          monthly_cost_limit_usd: apifyMonthlyCostLimit,
          markup_percent: percentField(
            formData,
            "provider_apify_markup_percent",
            current.providers.apify.markup_percent,
          ),
          included_usage_usd: moneyField(
            formData,
            "provider_apify_included_usage",
            current.providers.apify.included_usage_usd,
          ),
        },
        outscraper: {
          enabled: checked(formData, "provider_outscraper_enabled"),
          credential_owner: "operator",
          monthly_cost_limit_usd: moneyField(
            formData,
            "provider_outscraper_monthly_cost_limit",
            current.providers.outscraper.monthly_cost_limit_usd,
          ),
          markup_percent: percentField(
            formData,
            "provider_outscraper_markup_percent",
            current.providers.outscraper.markup_percent,
          ),
          included_usage_usd: moneyField(
            formData,
            "provider_outscraper_included_usage",
            current.providers.outscraper.included_usage_usd,
          ),
        },
      },
      delivery: {
        ...current.delivery,
        launch_notes: cleanText(formData, "launch_notes", 5000),
      },
    },
    "install",
    "tenant.settings.updated",
    settingsVersion(formData),
  );

  settingsRedirect("install", "Install settings saved.");
}

export async function runContentScanNow(formData: FormData) {
  await requireOperatorAccess();
  const { admin, context } = await requireOperatorTenantActionContext(
    () =>
      settingsRedirect(
        "install",
        "The private data connection is unavailable.",
      ),
    () =>
      redirectWithMessage(
        "/dashboard",
        "Setup tools are operator-only for this install.",
      ),
  );

  let result: Awaited<ReturnType<typeof runContentScansForTenant>>;
  const priorityPlatforms = formData
    .getAll("platform")
    .map((value) => String(value))
    .filter((value): value is ContentScanPlatform =>
      contentScanPlatforms.includes(value as ContentScanPlatform),
    );
  try {
    result = await runContentScansForTenant({
      admin,
      tenantId: context.tenantId,
      rawSettings: context.settings,
      force: true,
      priorityPlatforms,
    });
  } catch {
    settingsRedirect("install", "Content monitoring could not be started.");
  }

  revalidatePath("/settings");
  revalidatePath("/engagement");
  if (result.status === "disabled") {
    settingsRedirect("install", "Turn on automatic content monitoring first.");
  }
  if (result.status === "not_configured") {
    settingsRedirect("install", "Add the Apify credentials to Vercel first.");
  }
  if (result.status === "provider_disabled") {
    settingsRedirect("install", "Turn on the managed Apify plan first.");
  }
  settingsRedirect(
    "install",
    result.started > 0
      ? `Started ${result.started} content check${result.started === 1 ? "" : "s"}.`
      : "No content checks were due within the current limits.",
  );
}

export async function updateIntakeSettings(formData: FormData) {
  await requireOperatorAccess();
  const actionContext = await requireOperatorTenantActionContext(
    () => settingsRedirect("intake", "Supabase admin environment is not configured."),
    () =>
      redirectWithMessage(
        "/dashboard",
        "Setup tools are operator-only for this install.",
      ),
  );

  const current = normalizeTenantSettings(actionContext.context.settings);

  await saveSettings(
    actionContext,
    {
      ...current,
      onboarding: {
        network_thesis: cleanText(formData, "network_thesis"),
        referral_lanes: cleanText(formData, "referral_lanes"),
        prospecting_focus: cleanText(formData, "prospecting_focus"),
        outreach_focus: cleanText(formData, "outreach_focus"),
        relationship_rules: cleanText(formData, "relationship_rules"),
        intake_notes: cleanText(formData, "intake_notes", 5000),
      },
      prospecting: {
        buckets: parseProspectingBucketLines(
          cleanText(formData, "prospecting_buckets", 10000),
        ),
      },
      voice_profile: {
        owner_voice: cleanText(formData, "owner_voice"),
        assistant_style: cleanText(formData, "assistant_style"),
        default_outreach_tone: cleanText(formData, "default_outreach_tone"),
      },
    },
    "intake",
    "tenant.intake.updated",
    settingsVersion(formData),
  );

  settingsRedirect("intake", "Intake profile saved.");
}
