export const managedProviders = ["apify", "outscraper"] as const;

export type ManagedProvider = (typeof managedProviders)[number];

export type ProviderPlan = {
  enabled: boolean;
  credential_owner: "operator";
  monthly_cost_limit_usd: number;
  markup_percent: number;
  included_usage_usd: number;
};

export type ProviderPlans = Record<ManagedProvider, ProviderPlan>;

const defaultProviderPlan: ProviderPlan = {
  enabled: false,
  credential_owner: "operator",
  monthly_cost_limit_usd: 10,
  markup_percent: 0,
  included_usage_usd: 0,
};

export const defaultProviderPlans: ProviderPlans = {
  apify: { ...defaultProviderPlan },
  outscraper: { ...defaultProviderPlan },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedMoney(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(10_000, Math.max(0, Math.round(value * 100) / 100))
    : fallback;
}

function boundedPercent(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(500, Math.max(0, Math.round(value * 100) / 100))
    : fallback;
}

export function normalizeProviderPlans(value: unknown): ProviderPlans {
  const root = record(value);

  return Object.fromEntries(
    managedProviders.map((provider) => {
      const supplied = record(root[provider]);
      const defaults = defaultProviderPlans[provider];
      return [
        provider,
        {
          enabled:
            typeof supplied.enabled === "boolean"
              ? supplied.enabled
              : defaults.enabled,
          credential_owner: "operator",
          monthly_cost_limit_usd: boundedMoney(
            supplied.monthly_cost_limit_usd,
            defaults.monthly_cost_limit_usd,
          ),
          markup_percent: boundedPercent(
            supplied.markup_percent,
            defaults.markup_percent,
          ),
          included_usage_usd: boundedMoney(
            supplied.included_usage_usd,
            defaults.included_usage_usd,
          ),
        },
      ];
    }),
  ) as ProviderPlans;
}

export type ProviderPricingSnapshot = {
  provider: ManagedProvider;
  credential_owner: "operator";
  markup_percent: number;
  included_usage_usd: number;
  currency: "USD";
};

export function providerPricingSnapshot(
  provider: ManagedProvider,
  plan: ProviderPlan,
): ProviderPricingSnapshot {
  return {
    provider,
    credential_owner: "operator",
    markup_percent: plan.markup_percent,
    included_usage_usd: plan.included_usage_usd,
    currency: "USD",
  };
}

export function normalizeProviderPricingSnapshot(
  value: unknown,
  provider: ManagedProvider,
): ProviderPricingSnapshot {
  const supplied = record(value);
  const fallback = defaultProviderPlans[provider];
  return providerPricingSnapshot(provider, {
    ...fallback,
    markup_percent: boundedPercent(
      supplied.markup_percent,
      fallback.markup_percent,
    ),
    included_usage_usd: boundedMoney(
      supplied.included_usage_usd,
      fallback.included_usage_usd,
    ),
  });
}

export function providerCostCents(costUsd: number) {
  if (!Number.isFinite(costUsd)) return 0;
  return Math.max(0, Math.round(costUsd * 100));
}

export function providerBillableCents(
  providerCost: number,
  snapshot: ProviderPricingSnapshot,
) {
  return Math.max(
    0,
    Math.round(providerCost * (1 + snapshot.markup_percent / 100)),
  );
}
