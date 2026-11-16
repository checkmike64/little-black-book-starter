import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { productionCheckItems } from "../lib/deployment-readiness.js";
import { buildPreinstallEvidencePlan } from "../lib/preinstall-evidence-plan.js";

describe("pre-install evidence plan", () => {
  test("separates technical proof from client-specific records", () => {
    const plan = buildPreinstallEvidencePlan({
      checks: productionCheckItems,
      records: {},
    });

    assert.equal(plan.technical.length, 5);
    assert.equal(plan.client.length, 6);
    assert.equal(plan.total, 11);
    assert.equal(plan.confirmed, 0);
    assert.equal(plan.next?.key, "supabase_project_isolated");
  });

  test("does not treat a legacy checkbox without evidence as confirmed", () => {
    const plan = buildPreinstallEvidencePlan({
      checks: productionCheckItems,
      records: {
        supabase_project_isolated: {
          confirmed: true,
          confirmed_at: "2026-08-29T00:00:00.000Z",
          confirmed_by: "operator@example.com",
          evidence_ref: null,
        },
      },
    });

    const isolation = plan.items.find(
      (item) => item.key === "supabase_project_isolated",
    );
    assert.equal(isolation?.status, "evidence_needed");
    assert.equal(isolation?.statusLabel, "Evidence ID needed");
    assert.equal(plan.evidenceNeeded, 1);
    assert.equal(plan.confirmed, 0);
  });

  test("counts only evidence-backed confirmations and advances the next action", () => {
    const records = Object.fromEntries(
      productionCheckItems.slice(0, 2).map((item) => [
        item.key,
        {
          confirmed: true,
          confirmed_at: "2026-09-12T12:00:00.000Z",
          confirmed_by: "operator@example.com",
          evidence_ref: `packet/${item.key}`,
        },
      ]),
    );
    const plan = buildPreinstallEvidencePlan({
      checks: productionCheckItems,
      records,
    });

    assert.equal(plan.confirmed, 2);
    assert.equal(plan.ready, false);
    assert.equal(plan.next?.key, "preview_protection_enabled");
  });

  test("is ready only when every check has an evidence reference", () => {
    const records = Object.fromEntries(
      productionCheckItems.map((item) => [
        item.key,
        {
          confirmed: true,
          confirmed_at: "2026-09-12T12:00:00.000Z",
          confirmed_by: "operator@example.com",
          evidence_ref: `packet/${item.key}`,
        },
      ]),
    );
    const plan = buildPreinstallEvidencePlan({
      checks: productionCheckItems,
      records,
    });

    assert.equal(plan.confirmed, 11);
    assert.equal(plan.ready, true);
    assert.equal(plan.next, null);
  });
});
