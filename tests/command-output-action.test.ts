import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  commandOutputActionRecommendation,
  commandOutputActionType,
} from "../lib/command-output-action.js";

describe("command output action recommendation", () => {
  test("maps command intent to relationship action type", () => {
    assert.equal(commandOutputActionType("verify_referral_lane"), "referral");
    assert.equal(commandOutputActionType("build_intro_map"), "introduction");
    assert.equal(commandOutputActionType("draft_outreach"), "claude_draft");
    assert.equal(commandOutputActionType("unknown"), "claude_draft");
  });

  test("uses follow-up as the tracked action title when available", () => {
    const recommendation = commandOutputActionRecommendation({
      commandIntent: "draft_outreach",
      commandLabel: "Draft outreach",
      contactName: "Alicia Stone",
      commandOutput: "Here is a practical outreach draft.",
      followUpNeeded: "Send the note after confirming the ask.",
      verificationSummary: "Owner should confirm tone before sending.",
    });

    assert.equal(recommendation.title, "Send the note after confirming the ask.");
    assert.equal(recommendation.actionType, "claude_draft");
    assert.equal(recommendation.priority, "high");
    assert.match(recommendation.notes, /practical outreach draft/);
    assert.match(recommendation.notes, /Verification:/);
  });

  test("falls back to intent-specific titles without output text", () => {
    const recommendation = commandOutputActionRecommendation({
      commandIntent: "verify_referral_lane",
      commandLabel: "Verify referral lane",
      contactName: "Alicia Stone",
    });

    assert.equal(recommendation.title, "Review referral lane for Alicia Stone");
    assert.equal(recommendation.actionType, "referral");
    assert.equal(recommendation.priority, "normal");
  });
});
