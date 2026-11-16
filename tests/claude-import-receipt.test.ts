import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildClaudeImportReceipt } from "../lib/claude-import-receipt.js";

describe("Claude import receipt", () => {
  test("waits for first Claude evidence when nothing has landed", () => {
    const receipt = buildClaudeImportReceipt({
      jobs: [],
      pendingChanges: [],
      audit: [],
      provenance: [],
      interactions: [],
    });

    assert.equal(receipt.status, "waiting");
    assert.equal(receipt.actions[0]?.label, "Run the first Claude operating pass");
  });

  test("surfaces review and owner verification pressure from pending changes", () => {
    const receipt = buildClaudeImportReceipt({
      jobs: [
        {
          id: "job-1",
          status: "succeeded",
          result: {},
          created_at: "2026-07-21T10:00:00.000Z",
        },
      ],
      pendingChanges: [
        {
          id: "change-1",
          status: "pending",
          change_type: "contact_enrichment",
          risk_level: "high",
          source: "client_claude_project",
          payload: {
            verification: {
              required: true,
              owner_question: "Is this referral lane accurate?",
            },
          },
          created_at: "2026-07-21T11:00:00.000Z",
        },
      ],
      audit: [
        {
          actor_type: "claude",
          action: "job.completed",
          metadata: {},
          created_at: "2026-07-21T12:00:00.000Z",
        },
      ],
      provenance: [],
      interactions: [],
    });

    assert.equal(receipt.status, "review");
    assert.equal(receipt.completedJobCount, 1);
    assert.equal(receipt.pendingReviewCount, 1);
    assert.equal(receipt.ownerVerificationCount, 1);
    assert.equal(receipt.highRiskPendingCount, 1);
    assert.deepEqual(
      receipt.actions.map((action) => action.label),
      [
        "Review Claude proposals",
        "Ask owner verification questions",
        "Approve one safe proposal",
      ],
    );
  });

  test("marks settled evidence recorded when writes have provenance", () => {
    const receipt = buildClaudeImportReceipt({
      jobs: [],
      pendingChanges: [],
      audit: [
        {
          actor_type: "claude",
          action: "pending_change.replacement_created",
          metadata: { duplicate: true },
          created_at: "2026-07-21T09:00:00.000Z",
        },
      ],
      provenance: [
        {
          field_name: "relationship_strength",
          source_type: "pending_change",
          source_ref: "change-1",
          metadata: {},
          created_at: "2026-07-21T10:00:00.000Z",
        },
      ],
      interactions: [
        {
          id: "interaction-1",
          source: "client_claude_project",
          source_ref: "calendar-call",
          created_at: "2026-07-21T11:00:00.000Z",
        },
      ],
    });

    assert.equal(receipt.status, "recorded");
    assert.equal(receipt.duplicateSignalCount, 1);
    assert.equal(receipt.provenanceCount, 1);
    assert.equal(receipt.interactionCount, 1);
    assert.deepEqual(receipt.actions, []);
  });
});
