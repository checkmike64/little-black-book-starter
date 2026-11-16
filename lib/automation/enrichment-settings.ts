// Per-install pacing for the contact-enrichment worker, stored in
// tenants.settings.automation.enrichment. Pure for testing.

export type EnrichmentAutomationSettings = {
  /** Owner/operator switch for this install. The env kill switch still wins. */
  enabled: boolean;
  /** People researched per UTC day in normal operation. */
  daily_limit: number;
  /** While in the future, the catch-up pace applies (capped at 7 days ahead). */
  catchup_until: string | null;
  /** People per UTC day during a catch-up window. */
  catchup_daily_limit: number;
};

export const defaultEnrichmentAutomationSettings: EnrichmentAutomationSettings = {
  enabled: true,
  daily_limit: 25,
  catchup_until: null,
  catchup_daily_limit: 150,
};

const maxCatchupMs = 7 * 86_400_000;

function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), min), max)
    : fallback;
}

export function normalizeEnrichmentAutomationSettings(value: unknown): EnrichmentAutomationSettings {
  const root = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const catchupUntil = typeof root.catchup_until === "string" && Number.isFinite(Date.parse(root.catchup_until))
    ? new Date(root.catchup_until).toISOString()
    : null;
  return {
    enabled: typeof root.enabled === "boolean" ? root.enabled : defaultEnrichmentAutomationSettings.enabled,
    daily_limit: bounded(root.daily_limit, defaultEnrichmentAutomationSettings.daily_limit, 0, 200),
    catchup_until: catchupUntil,
    catchup_daily_limit: bounded(
      root.catchup_daily_limit,
      defaultEnrichmentAutomationSettings.catchup_daily_limit,
      0,
      500,
    ),
  };
}

export type EnrichmentPace = {
  enabled: boolean;
  dailyLimit: number;
  /** People researched in parallel per scheduled run. */
  perRunLimit: number;
  catchingUp: boolean;
  catchupEndsAt: string | null;
};

/**
 * Effective pace for one install. `LBB_ENRICHMENT_WORKER_ENABLED=false` stops
 * every install; `LBB_ENRICHMENT_DAILY_LIMIT` caps every install's daily limit.
 * A catch-up window ending more than 7 days out is ignored, so a typo cannot
 * leave an install on catch-up pace indefinitely.
 */
export function enrichmentPace(
  settings: EnrichmentAutomationSettings,
  env: Readonly<Record<string, string | undefined>>,
  now: Date,
): EnrichmentPace {
  const globallyEnabled = !/^(0|false|no|off)$/i.test(env.LBB_ENRICHMENT_WORKER_ENABLED?.trim() ?? "");
  const envCap = Number.parseInt(env.LBB_ENRICHMENT_DAILY_LIMIT?.trim() ?? "", 10);
  const cap = Number.isFinite(envCap) ? Math.min(Math.max(envCap, 0), 500) : 500;
  const until = settings.catchup_until ? Date.parse(settings.catchup_until) : Number.NaN;
  const catchingUp = Number.isFinite(until)
    && until > now.getTime()
    && until - now.getTime() <= maxCatchupMs;
  const catchupEndsAt = catchingUp ? new Date(until).toISOString() : null;
  const dailyLimit = Math.min(catchingUp ? settings.catchup_daily_limit : settings.daily_limit, cap);
  return {
    enabled: globallyEnabled && settings.enabled && dailyLimit > 0,
    dailyLimit,
    perRunLimit: catchingUp ? 4 : 2,
    catchingUp,
    catchupEndsAt,
  };
}
