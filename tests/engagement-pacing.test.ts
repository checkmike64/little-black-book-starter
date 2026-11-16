import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  engagementCadenceAllows,
  engagementTargetPerMonth,
  minimumEngagementGapDays,
} from "../lib/engagement/pacing.js";
import {
  activityDayWindow,
  normalizeActivitySettings,
} from "../lib/activity-settings.js";

describe("engagement pacing", () => {
  it("gives prospects and referral-building relationships a monthly target", () => {
    assert.equal(engagementTargetPerMonth({ is_want_to_know: true }), 1);
    assert.equal(
      engagementTargetPerMonth({
        is_want_to_know: true,
        default_target_per_month: 2,
      }),
      2,
    );
    assert.equal(
      engagementTargetPerMonth({
        relationship_type: ["Building Referral Partnership"],
        trust_level: "Tier 3 - Acquaintance",
      }),
      1,
    );
  });

  it("slows lower-priority contacts when no explicit cadence exists", () => {
    assert.equal(
      engagementTargetPerMonth({ trust_level: "Tier 1 - Deep Trust" }),
      1,
    );
    assert.equal(
      engagementTargetPerMonth({ trust_level: "Tier 3 - Acquaintance" }),
      0.25,
    );
  });

  it("uses communication cadence and manual overrides", () => {
    assert.equal(
      engagementTargetPerMonth({ touch_cadence: "Monthly" }),
      1,
    );
    assert.equal(
      minimumEngagementGapDays({ touch_cadence: "Every 6 months" }),
      180,
    );
    assert.equal(
      minimumEngagementGapDays({ engagement_target_per_month: 2 }),
      15,
    );
    assert.equal(minimumEngagementGapDays({ touch_cadence: "Biannual" }), 180);
    assert.equal(
      minimumEngagementGapDays({ touch_cadence: "Dormant" }),
      Number.POSITIVE_INFINITY,
    );
  });

  it("suppresses another recommendation inside the target gap", () => {
    const now = new Date("2026-07-29T12:00:00Z");
    assert.equal(
      engagementCadenceAllows({
        identity: { touch_cadence: "Monthly" },
        lastEngagedAt: "2026-07-10T12:00:00Z",
        now,
      }),
      false,
    );
    assert.equal(
      engagementCadenceAllows({
        identity: { touch_cadence: "Monthly" },
        lastEngagedAt: "2026-06-20T12:00:00Z",
        now,
      }),
      true,
    );
  });

  it("resets daily activity at midnight in the configured timezone", () => {
    const window = activityDayWindow(
      "America/Mexico_City",
      new Date("2026-07-29T03:00:00Z"),
    );
    assert.equal(window.date, "2026-07-28");
    assert.equal(window.startIso, "2026-07-28T06:00:00.000Z");
  });

  it("falls back from invalid activity timezones", () => {
    assert.equal(
      normalizeActivitySettings({ time_zone: "not/a-zone" }).time_zone,
      "UTC",
    );
  });
});
