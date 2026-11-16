import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAdvanceLastSpoke } from "../lib/interaction-freshness.js";

describe("interaction freshness", () => {
  const now = new Date("2026-07-30T12:00:00Z");

  it("allows completed and near-current interactions to advance last spoke", () => {
    assert.equal(canAdvanceLastSpoke("2026-07-29T12:00:00Z", now), true);
    assert.equal(canAdvanceLastSpoke("2026-07-30T12:04:00Z", now), true);
  });

  it("does not let a scheduled future meeting advance last spoke", () => {
    assert.equal(canAdvanceLastSpoke("2026-07-30T13:00:00Z", now), false);
    assert.equal(canAdvanceLastSpoke("2026-08-03T15:00:00Z", now), false);
  });

  it("rejects invalid timestamps", () => {
    assert.equal(canAdvanceLastSpoke("not-a-date", now), false);
  });
});
