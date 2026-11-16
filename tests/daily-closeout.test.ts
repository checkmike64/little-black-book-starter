import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildDailyCloseoutSummary } from "../lib/daily-closeout.js";

describe("daily closeout", () => {
  test("summarizes completed relationship movement", () => {
    const summary = buildDailyCloseoutSummary({
      commandJobs: [],
      interactions: [
        {
          id: "interaction-1",
          occurred_at: "2026-07-21T12:00:00.000Z",
          interaction_type: "call",
          title: "Investor call",
          summary: null,
          interaction_contacts: [
            { contacts: { full_name: "Alicia Harper" } },
          ],
        },
      ],
      promises: [
        {
          id: "promise-1",
          promise_text: "Send the deck",
          status: "completed",
          completed_at: "2026-07-21T13:00:00.000Z",
          contacts: { id: "contact-1", full_name: "Alicia Harper" },
        },
      ],
      relationshipActions: [
        {
          id: "action-1",
          title: "Follow up after call",
          action_type: "follow_up",
          status: "done",
          completed_at: "2026-07-21T14:00:00.000Z",
          contacts: { id: "contact-1", full_name: "Alicia Harper" },
        },
      ],
      unresolvedDecisions: 0,
    });

    assert.equal(summary.status, "progress");
    assert.equal(summary.counts.totalClosed, 3);
    assert.equal(summary.nextAction.href, "/movement?view=closed");
    assert.equal(summary.items[0]?.label, "Promise done");
  });

  test("prioritizes unresolved decisions over completed volume", () => {
    const summary = buildDailyCloseoutSummary({
      commandJobs: [
        {
          id: "job-1",
          job_type: "relationship_command",
          status: "succeeded",
          result: {
            summary: "Created new reviewable relationship updates.",
            created_pending_change_ids: ["change-1"],
          },
        },
      ],
      interactions: [],
      promises: [],
      relationshipActions: [],
      unresolvedDecisions: 2,
    });

    assert.equal(summary.status, "needs_review");
    assert.equal(summary.tone, "gold");
    assert.equal(summary.nextAction.href, "/ask?saved=needs_decision");
    assert.equal(summary.items[0]?.label, "Claude review");
  });

  test("nudges useful work when nothing is closed yet", () => {
    const summary = buildDailyCloseoutSummary({
      commandJobs: [],
      interactions: [],
      promises: [],
      relationshipActions: [],
      unresolvedDecisions: 0,
    });

    assert.equal(summary.status, "clear");
    assert.equal(summary.tone, "hot");
    assert.equal(summary.counts.totalClosed, 0);
    assert.equal(summary.nextAction.label, "Work today plan");
  });
});
