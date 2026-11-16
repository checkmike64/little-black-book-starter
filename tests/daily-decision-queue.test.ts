import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildDailyDecisionQueue,
  type DecisionCommandJob,
  type DecisionPendingChange,
} from "../lib/daily-decision-queue.js";

function pendingChange(
  overrides: Partial<DecisionPendingChange> = {},
): DecisionPendingChange {
  return {
    id: "change-1",
    change_type: "relationship_update",
    summary: "Update referral readiness for Alicia Stone",
    risk_level: "normal",
    source: "claude",
    created_at: "2026-07-21T12:00:00.000Z",
    ...overrides,
  };
}

function commandJob(
  overrides: Partial<DecisionCommandJob> = {},
): DecisionCommandJob {
  return {
    id: "job-1",
    job_type: "contact_command",
    status: "succeeded",
    created_at: "2026-07-21T12:00:00.000Z",
    payload: {
      command_focus: {
        intent: "verify_referral_lane",
        label: "Verify referral lane",
      },
    },
    result: {
      command_output: "Referral lane looks promising but owner should confirm trust.",
      verification_summary: "Owner should verify before outreach.",
    },
    trackedAction: null,
    ...overrides,
  };
}

describe("daily decision queue", () => {
  test("prioritizes high-risk pending changes as the first owner decision", () => {
    const queue = buildDailyDecisionQueue({
      pendingChanges: [
        pendingChange({ id: "change-normal", risk_level: "normal" }),
        pendingChange({
          id: "change-risky",
          risk_level: "high",
          summary: "Change trust bucket for key investor",
        }),
      ],
      askRunUndecidedCount: 2,
      commandJobs: [commandJob()],
    });

    assert.equal(queue.status, "urgent");
    assert.equal(queue.items[0].key, "change:change-risky");
    assert.equal(queue.nextAction.href, "/changes/change-risky");
    assert.equal(queue.counts.pendingChanges, 2);
    assert.equal(queue.counts.highRiskChanges, 1);
    assert.equal(queue.counts.askDecisions, 2);
    assert.equal(queue.counts.commandOutputs, 1);
  });

  test("collapses saved Ask decisions into one review item", () => {
    const queue = buildDailyDecisionQueue({
      pendingChanges: [],
      askRunUndecidedCount: 3,
      commandJobs: [],
    });

    assert.equal(queue.status, "review");
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].key, "ask:decisions");
    assert.equal(queue.items[0].href, "/ask?saved=needs_decision");
    assert.match(queue.items[0].detail, /3 saved Ask runs/);
  });

  test("includes untracked Claude command output for admin review", () => {
    const queue = buildDailyDecisionQueue({
      pendingChanges: [],
      askRunUndecidedCount: 0,
      commandJobs: [commandJob()],
    });

    assert.equal(queue.items[0].key, "command:job-1");
    assert.equal(queue.items[0].href, "/ops/jobs/job-1");
    assert.equal(queue.items[0].action, "Capture or dismiss");
    assert.equal(queue.items[0].tone, "warn");
  });

  test("ignores Claude output that has already been captured or dismissed", () => {
    const queue = buildDailyDecisionQueue({
      pendingChanges: [],
      askRunUndecidedCount: 0,
      commandJobs: [
        commandJob({
          id: "tracked",
          trackedAction: {
            id: "action-1",
            status: "open",
          },
        }),
        commandJob({
          id: "dismissed",
          result: {
            command_output: "Useful context, but no tracked move is needed.",
            command_output_dismissed_at: "2026-07-21T12:00:00.000Z",
          },
        }),
      ],
    });

    assert.equal(queue.status, "clear");
    assert.equal(queue.items.length, 0);
    assert.equal(queue.nextAction.href, "/ask");
  });
});
