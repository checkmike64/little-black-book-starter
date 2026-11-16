import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildChangeReviewCommand,
  type ChangeReviewCommandInput,
} from "../lib/change-review-command.js";

function input(
  overrides: Partial<ChangeReviewCommandInput> = {},
): ChangeReviewCommandInput {
  return {
    activeCount: 4,
    lowRiskCount: 1,
    highRiskCount: 0,
    detailedReviewCount: 0,
    ownerContextCount: 0,
    answeredContextCount: 0,
    revisionQueuedCount: 0,
    quickApprovalCount: 1,
    unsupportedKeyCount: 0,
    nextReview: {
      href: "/changes/abc",
      summary: "Update relationship context",
      contactLabel: "Alicia Stone",
      lane: "Quick approval",
      riskReason: "Low-risk enrichment.",
    },
    ...overrides,
  };
}

describe("change review command", () => {
  test("treats owner-context blockers as the top review posture", () => {
    const command = buildChangeReviewCommand(
      input({
        highRiskCount: 3,
        ownerContextCount: 2,
      }),
    );

    assert.equal(command.mode, "Gather Context");
    assert.equal(command.tone, "hot");
    assert.equal(command.primary.label, "Open owner packet");
    assert.equal(command.primary.href, "#owner-verification-packet");
    assert.match(command.guardrail, /Do not approve blocked/);
  });

  test("routes high-risk proposals to one-by-one verification", () => {
    const command = buildChangeReviewCommand(
      input({
        quickApprovalCount: 4,
        highRiskCount: 1,
        detailedReviewCount: 2,
      }),
    );

    assert.equal(command.mode, "Verify Judgment");
    assert.equal(command.primary.href, "/changes/abc");
    assert.match(command.detail, /proposal/);
  });

  test("allows low-risk approval only when no sensitive blockers exist", () => {
    const command = buildChangeReviewCommand(input());

    assert.equal(command.mode, "Approve Low Risk");
    assert.equal(command.primary.label, "Approve visible low-risk");
  });

  test("marks an empty queue clear", () => {
    const command = buildChangeReviewCommand(
      input({
        activeCount: 0,
        lowRiskCount: 0,
        quickApprovalCount: 0,
        nextReview: null,
      }),
    );

    assert.equal(command.mode, "Clear");
    assert.equal(command.tone, "cool");
    assert.equal(command.primary.href, "/ask");
  });
});
