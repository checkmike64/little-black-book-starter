import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isAskLandingRequest } from "../lib/ask/load-plan.js";

describe("Ask data load plan", () => {
  test("uses the lightweight path only for the empty search landing page", () => {
    assert.equal(isAskLandingRequest("", "search", null), true);
    assert.equal(isAskLandingRequest("who should I meet?", "search", null), false);
    assert.equal(isAskLandingRequest("", "referrals", null), false);
    assert.equal(
      isAskLandingRequest("", "search", "11111111-1111-4111-8111-111111111111"),
      false,
    );
  });
});
