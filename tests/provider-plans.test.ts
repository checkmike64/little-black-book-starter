import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { normalizedActiveMigrationSql } from "./migration-source.js";
import {
  normalizeProviderPlans,
  providerBillableCents,
  providerPricingSnapshot,
} from "../lib/provider-plans.js";

describe("managed provider plans", () => {
  test("keeps provider credentials operator-owned and bounds client pricing", () => {
    const plans = normalizeProviderPlans({
      apify: {
        enabled: true,
        credential_owner: "client",
        monthly_cost_limit_usd: 20_000,
        markup_percent: 900,
        included_usage_usd: -5,
      },
    });

    assert.equal(plans.apify.enabled, true);
    assert.equal(plans.apify.credential_owner, "operator");
    assert.equal(plans.apify.monthly_cost_limit_usd, 10_000);
    assert.equal(plans.apify.markup_percent, 500);
    assert.equal(plans.apify.included_usage_usd, 0);
    assert.equal(plans.outscraper.enabled, false);
  });

  test("snapshots markup and calculates billable cents deterministically", () => {
    const snapshot = providerPricingSnapshot("apify", {
      enabled: true,
      credential_owner: "operator",
      monthly_cost_limit_usd: 100,
      markup_percent: 50,
      included_usage_usd: 5,
    });

    assert.equal(providerBillableCents(200, snapshot), 300);
    assert.equal(snapshot.credential_owner, "operator");
    assert.equal(snapshot.currency, "USD");
  });

  test("keeps provider billing writes service-role only and idempotent", () => {
    const migration = normalizedActiveMigrationSql;

    assert.match(migration, /usage_events_provider_external_idx/);
    assert.match(migration, /lbb_record_provider_usage/);
    assert.match(
      migration,
      /from public, anon, authenticated/,
    );
    assert.match(migration, /to service_role/);
    assert.match(migration, /provider_cost_cents/);
    assert.match(migration, /billable_cents/);
    assert.match(migration, /pricing_snapshot/);
  });
});
