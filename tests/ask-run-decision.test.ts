import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  askRunDecisionLabel,
  askRunDecisionState,
  buildAskRunDecision,
  hasAskRunDecision,
  readAskRunDecision,
} from "../lib/ask-run-decision.js";

describe("ask run decisions", () => {
  test("builds normalized follow-up and no-action decisions", () => {
    const followUp = buildAskRunDecision({
      status: "follow_up_needed",
      note: "Create a move.",
      decidedAt: "2026-07-20T12:00:00.000Z",
      decidedBy: "user-1",
    });
    const noAction = buildAskRunDecision({
      status: "verified_no_action",
    });

    assert.equal(followUp.label, "follow-up needed");
    assert.equal(followUp.note, "Create a move.");
    assert.equal(followUp.decided_by, "user-1");
    assert.equal(noAction.label, "verified, no action");
    assert.equal(askRunDecisionLabel("verified_no_action"), "verified, no action");
  });

  test("reads valid decisions from saved Ask run answer JSON", () => {
    const decision = readAskRunDecision({
      decision: {
        status: "follow_up_needed",
        note: "Needs a promise follow-up.",
      },
    });

    assert.equal(decision?.status, "follow_up_needed");
    assert.equal(decision?.label, "follow-up needed");
    assert.equal(decision?.note, "Needs a promise follow-up.");
  });

  test("ignores legacy or malformed saved runs without decisions", () => {
    assert.equal(hasAskRunDecision({}), false);
    assert.equal(hasAskRunDecision({ decision: { status: "maybe" } }), false);
    assert.equal(hasAskRunDecision(null), false);
    assert.equal(
      hasAskRunDecision({ decision: { status: "verified_no_action" } }),
      true,
    );
  });

  test("classifies saved runs by decision state", () => {
    assert.equal(askRunDecisionState({}), "needs_decision");
    assert.equal(
      askRunDecisionState({ decision: { status: "follow_up_needed" } }),
      "decided",
    );
  });
});
