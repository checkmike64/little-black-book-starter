import assert from "node:assert/strict";
import { test } from "node:test";
import { buildKeepInTouchQueue, contactTier, defaultKeepInTouchSettings as defaults, explicitCadenceDays, normalizeKeepInTouchSettings } from "../lib/keep-in-touch.js";

const now = new Date("2026-11-16T12:00:00Z");
const contact = (id: string, tier: string | null, last: string | null, cadence: string | null = null) => ({ id, full_name: id, trust_level: tier, last_spoke: last, touch_cadence: cadence });
test("tier reminders include all three tiers without posts, asks, or relationship strength", () => {
  const rows = buildKeepInTouchQueue([
    contact("one", "Tier 1", "2026-10-17"),
    contact("two", "Tier 2", "2026-09-17"),
    contact("three", "Tier 3", "2026-08-18"),
    contact("recent", "Tier 1", "2026-10-18"),
    contact("unassigned", null, "2020-01-01"),
  ], defaults, "UTC", now);
  assert.deepEqual(rows.map(r => r.contact.id), ["one", "two", "three"]);
  assert.ok(rows.every(r => r.daysOverdue === 0));
});
test("saved settings change eligibility; logging a conversation restarts the interval", () => {
  const c = contact("person", "Tier 2", "2026-11-01");
  assert.equal(buildKeepInTouchQueue([c], defaults, "UTC", now).length, 0);
  assert.equal(buildKeepInTouchQueue([c], { ...defaults, tier_2_days: 10 }, "UTC", now).length, 1);
  assert.equal(buildKeepInTouchQueue([{ ...c, last_spoke: "2026-11-16" }], { ...defaults, tier_2_days: 10 }, "UTC", now).length, 0);
});
test("explicit cadence overrides tiers and opted-out contacts stay out", () => {
  const rows = buildKeepInTouchQueue([
    contact("weekly", "Tier 3", "2026-11-09", "Weekly"),
    contact("monthly", "Tier 1", "2026-11-01", "Monthly"),
    contact("dormant", "Tier 1", null, "Dormant"),
    contact("adhoc", "Tier 1", "2020-01-01", "Ad hoc"),
    contact("custom", null, "2026-11-06", "Every 10 days"),
  ], defaults, "UTC", now);
  assert.deepEqual(rows.map(r => r.contact.id), ["weekly", "custom"]);
  assert.equal(explicitCadenceDays("Biweekly"), 14);
  assert.equal(explicitCadenceDays("Semi-annual"), 180);
});
test("missing and invalid dates are actionable; future dates are not due", () => {
  const rows = buildKeepInTouchQueue([
    contact("missing", "Tier 3", null), contact("invalid", "Tier 2", "2026-02-30"),
    contact("future", "Tier 1", "2027-01-01"),
  ], defaults, "UTC", now);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.daysOverdue === null));
});
test("uses owner calendar days near midnight without shifting date-only last_spoke", () => {
  const c = contact("one", "Tier 1", "2026-10-17");
  assert.equal(buildKeepInTouchQueue([c], defaults, "America/Los_Angeles", new Date("2026-11-16T01:00:00Z")).length, 0);
  assert.equal(buildKeepInTouchQueue([c], defaults, "America/Los_Angeles", new Date("2026-11-16T09:00:00Z")).length, 1);
});
test("validates settings and avoids tier prefix collisions", () => {
  assert.deepEqual(normalizeKeepInTouchSettings(null), defaults);
  assert.deepEqual(normalizeKeepInTouchSettings({ tier_1_days: -1, tier_2_days: Infinity, tier_3_days: 99999 }), { tier_1_days: 1, tier_2_days: 60, tier_3_days: 3650 });
  assert.equal(contactTier("Tier 10"), null);
  assert.equal(contactTier("Tier 3 - occasional"), 3);
});
