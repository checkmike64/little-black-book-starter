export const contentScanPlatforms = [
  "linkedin",
  "instagram",
  "facebook",
  "x_twitter",
  "youtube",
  "website",
] as const;

export type ContentScanPlatform = (typeof contentScanPlatforms)[number];
export type ContentScanInputFormat = "string_array" | "request_list";

export type ContentScanConnectorSettings = {
  platform: ContentScanPlatform;
  enabled: boolean;
  task_id: string;
  input_field: string;
  input_format: ContentScanInputFormat;
  /** Actor input field that caps results per profile; empty when none. */
  limit_field: string;
  max_items_per_run: number;
  max_charge_usd: number;
};

export type ContentScanSettings = {
  enabled: boolean;
  cadence_days: number;
  daily_run_limit: number;
  concurrent_run_limit: number;
  monthly_budget_usd: number;
  connectors: ContentScanConnectorSettings[];
};

const connectorDefaults: Record<
  ContentScanPlatform,
  Omit<ContentScanConnectorSettings, "platform">
> = {
  linkedin: {
    enabled: true,
    task_id: "",
    input_field: "targetUrls",
    input_format: "string_array",
    limit_field: "maxPosts",
    max_items_per_run: 20,
    max_charge_usd: 1,
  },
  instagram: {
    enabled: true,
    task_id: "",
    input_field: "directUrls",
    input_format: "string_array",
    limit_field: "resultsLimit",
    max_items_per_run: 20,
    max_charge_usd: 1,
  },
  facebook: {
    enabled: false,
    task_id: "",
    input_field: "startUrls",
    input_format: "request_list",
    limit_field: "resultsLimit",
    max_items_per_run: 20,
    max_charge_usd: 1,
  },
  x_twitter: {
    enabled: true,
    task_id: "",
    input_field: "startUrls",
    input_format: "string_array",
    limit_field: "maxItems",
    max_items_per_run: 20,
    max_charge_usd: 1,
  },
  youtube: {
    enabled: true,
    task_id: "",
    input_field: "startUrls",
    input_format: "request_list",
    limit_field: "maxResults",
    max_items_per_run: 20,
    max_charge_usd: 1,
  },
  website: {
    enabled: true,
    task_id: "",
    input_field: "startUrls",
    input_format: "request_list",
    limit_field: "",
    max_items_per_run: 20,
    max_charge_usd: 1,
  },
};

export const defaultContentScanSettings: ContentScanSettings = {
  enabled: false,
  cadence_days: 7,
  daily_run_limit: 5,
  concurrent_run_limit: 2,
  monthly_budget_usd: 10,
  connectors: contentScanPlatforms.map((platform) => ({
    platform,
    ...connectorDefaults[platform],
  })),
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function boundedCost(value: unknown, fallback: number, max = 25) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(0.01, Math.round(value * 100) / 100))
    : fallback;
}

function cleanIdentifier(value: unknown, fallback: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[a-zA-Z0-9_.~/-]+$/.test(text) && text.length <= maxLength
    ? text
    : fallback;
}

export function normalizeContentScanSettings(value: unknown): ContentScanSettings {
  const root = record(value);
  const suppliedConnectors = Array.isArray(root.connectors)
    ? root.connectors.map(record)
    : [];

  return {
    enabled:
      typeof root.enabled === "boolean"
        ? root.enabled
        : defaultContentScanSettings.enabled,
    cadence_days: boundedInteger(
      root.cadence_days,
      defaultContentScanSettings.cadence_days,
      1,
      30,
    ),
    daily_run_limit: boundedInteger(
      root.daily_run_limit,
      defaultContentScanSettings.daily_run_limit,
      1,
      25,
    ),
    concurrent_run_limit: boundedInteger(
      root.concurrent_run_limit,
      defaultContentScanSettings.concurrent_run_limit,
      1,
      10,
    ),
    monthly_budget_usd: boundedCost(
      root.monthly_budget_usd,
      defaultContentScanSettings.monthly_budget_usd,
      10_000,
    ),
    connectors: contentScanPlatforms.map((platform) => {
      const supplied =
        suppliedConnectors.find((item) => item.platform === platform) ?? {};
      const defaults = connectorDefaults[platform];
      return {
        platform,
        enabled:
          typeof supplied.enabled === "boolean"
            ? supplied.enabled
            : defaults.enabled,
        task_id: cleanIdentifier(supplied.task_id, "", 160),
        input_field: cleanIdentifier(
          supplied.input_field,
          defaults.input_field,
          80,
        ),
        input_format:
          supplied.input_format === "request_list" ||
          supplied.input_format === "string_array"
            ? supplied.input_format
            : defaults.input_format,
        limit_field: cleanIdentifier(
          supplied.limit_field,
          defaults.limit_field,
          80,
        ),
        max_items_per_run: boundedInteger(
          supplied.max_items_per_run,
          defaults.max_items_per_run,
          1,
          100,
        ),
        max_charge_usd: boundedCost(
          supplied.max_charge_usd,
          defaults.max_charge_usd,
        ),
      };
    }),
  };
}

export function configuredContentScanConnector(
  settings: ContentScanSettings,
  platform: ContentScanPlatform,
) {
  const connector = settings.connectors.find(
    (candidate) => candidate.platform === platform,
  );
  return connector?.enabled && connector.task_id ? connector : null;
}
