import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildScoreboardPulse } from "../lib/scoreboard-pulse.js";

describe("scoreboard pulse", () => {
  test("marks a clean operating system strong", () => {
    const pulse = buildScoreboardPulse({
      connectionRate: 80,
      promiseKeepRate: 90,
      warmRate: 70,
      dataReadiness: 92,
      duePromiseCount: 0,
      staleTrustedCount: 0,
      pendingChangeCount: 0,
      movementRiskCount: 2,
    });

    assert.equal(pulse.status, "Strong");
    assert.equal(pulse.nextAction.href, "/movement");
  });

  test("prioritizes due promises above other work", () => {
    const pulse = buildScoreboardPulse({
      connectionRate: 90,
      promiseKeepRate: 80,
      warmRate: 80,
      dataReadiness: 90,
      duePromiseCount: 2,
      staleTrustedCount: 0,
      pendingChangeCount: 0,
      movementRiskCount: 0,
    });

    assert.equal(pulse.status, "Attention");
    assert.equal(pulse.nextAction.href, "/promises");
    assert.match(pulse.detail, /2 items/);
  });

  test("routes review queue and weak data to the right surfaces", () => {
    const reviewPulse = buildScoreboardPulse({
      connectionRate: 50,
      promiseKeepRate: 90,
      warmRate: 75,
      dataReadiness: 88,
      duePromiseCount: 0,
      staleTrustedCount: 0,
      pendingChangeCount: 3,
      movementRiskCount: 0,
    });
    const weakDataPulse = buildScoreboardPulse({
      connectionRate: 50,
      promiseKeepRate: 90,
      warmRate: 75,
      dataReadiness: 62,
      duePromiseCount: 0,
      staleTrustedCount: 0,
      pendingChangeCount: 0,
      movementRiskCount: 0,
    });

    assert.equal(reviewPulse.nextAction.href, "/changes");
    assert.equal(weakDataPulse.nextAction.href, "/contacts?view=judgment");
    assert.equal(weakDataPulse.nextAction.label, "Complete profiles");
  });
});
