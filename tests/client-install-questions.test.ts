import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildClientInstallQuestions,
  type ClientInstallQuestionInput,
} from "../lib/client-install-questions.js";

function input(
  overrides: Partial<ClientInstallQuestionInput> = {},
): ClientInstallQuestionInput {
  return {
    contactCount: 25,
    enabledModules: ["Ask", "Networking", "Want to Know"],
    hiddenModules: ["Engagement"],
    highValueWeakCount: 0,
    pendingReviewCount: 0,
    askRunCount: 1,
    commandJobCount: 1,
    rehearsalComplete: true,
    launchNotesReady: true,
    networkThesis: "Use trusted relationships to source investor intros.",
    referralLanes: "Investor and operator introductions.",
    prospectingFocus: "Investor targets.",
    outreachFocus: "Warm investor conversations.",
    relationshipRules: "No cold mass outreach.",
    ownerVoice: "Direct, warm, low hype.",
    prospectingBucketCount: 2,
    ...overrides,
  };
}

describe("client install questions", () => {
  test("asks critical setup questions before launch mechanics", () => {
    const questions = buildClientInstallQuestions(
      input({
        contactCount: 0,
        enabledModules: [],
        networkThesis: "",
        commandJobCount: 0,
      }),
    );

    assert.equal(questions[0]?.priority, "critical");
    assert.ok(questions.some((question) => question.key === "first-data-source"));
    assert.ok(questions.some((question) => question.key === "enabled-modules"));
    assert.ok(questions.some((question) => question.key === "network-thesis"));
  });

  test("asks for prospecting buckets only when prospecting is enabled", () => {
    const enabled = buildClientInstallQuestions(
      input({
        prospectingBucketCount: 0,
      }),
    );
    const disabled = buildClientInstallQuestions(
      input({
        enabledModules: ["Ask", "Networking"],
        prospectingBucketCount: 0,
      }),
    );

    assert.ok(enabled.some((question) => question.key === "prospecting-buckets"));
    assert.ok(!disabled.some((question) => question.key === "prospecting-buckets"));
  });

  test("surfaces high-value weak data and proof gaps", () => {
    const questions = buildClientInstallQuestions(
      input({
        highValueWeakCount: 3,
        pendingReviewCount: 2,
        askRunCount: 0,
        commandJobCount: 0,
      }),
    );

    assert.ok(questions.some((question) => question.key === "high-value-weak-records"));
    assert.ok(questions.some((question) => question.key === "pending-review-owner"));
    assert.ok(questions.some((question) => question.key === "ask-proof"));
    assert.ok(questions.some((question) => question.key === "claude-command-proof"));
  });
});
