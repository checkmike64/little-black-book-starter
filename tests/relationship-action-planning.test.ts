import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildRelationshipActionPlan,
  daysUntilRelationshipActionDue,
  relationshipActionLane,
  relationshipActionPlanSummary,
  relationshipActionPriorityScore,
  relationshipActionUrgencyLabel,
  type RelationshipActionPlanningInput,
} from "../lib/relationship-action-planning.js";

const now = new Date("2026-07-20T12:00:00Z");

function action(
  overrides: Partial<RelationshipActionPlanningInput>,
): RelationshipActionPlanningInput {
  return {
    id: "action-1",
    title: "Follow up",
    action_type: "follow_up",
    status: "open",
    priority: "normal",
    due_on: "2026-07-20",
    source: "contact_profile",
    ...overrides,
  };
}

describe("relationship action planning", () => {
  test("classifies due dates into operating lanes", () => {
    assert.equal(daysUntilRelationshipActionDue("2026-07-20", now), 0);
    assert.equal(relationshipActionLane(action({ due_on: "2026-07-18" }), now), "overdue");
    assert.equal(relationshipActionLane(action({ due_on: "2026-07-20" }), now), "due_today");
    assert.equal(relationshipActionLane(action({ due_on: "2026-07-24" }), now), "due_soon");
    assert.equal(relationshipActionLane(action({ due_on: "2026-08-10" }), now), "scheduled");
    assert.equal(relationshipActionLane(action({ due_on: null }), now), "unscheduled");
    assert.equal(relationshipActionLane(action({ status: "done" }), now), "closed");
  });

  test("creates human urgency labels for the movement surface", () => {
    assert.equal(
      relationshipActionUrgencyLabel(action({ due_on: "2026-07-18" }), now),
      "2 days overdue",
    );
    assert.equal(
      relationshipActionUrgencyLabel(action({ due_on: "2026-07-21" }), now),
      "Due in 1 day",
    );
    assert.equal(
      relationshipActionUrgencyLabel(action({ status: "skipped" }), now),
      "Skipped",
    );
  });

  test("scores high leverage Claude-created actions above ordinary future work", () => {
    const highLeverage = action({
      id: "action-hot",
      action_type: "owner_verification",
      priority: "high",
      due_on: "2026-07-21",
      source: "claude_command_output",
    });
    const ordinary = action({
      id: "action-later",
      title: "Loose someday follow up",
      priority: "low",
      due_on: "2026-08-15",
    });

    assert.ok(
      relationshipActionPriorityScore(highLeverage, now) >
      relationshipActionPriorityScore(ordinary, now),
    );
  });

  test("uses metadata to score Claude-created actions consistently", () => {
    const generated = action({
      id: "generated",
      due_on: null,
      metadata: { command_label: "Prep warm outreach" },
      priority: "low",
      source: "manual",
    });
    const manual = action({
      id: "manual",
      due_on: null,
      priority: "low",
      source: "manual",
    });

    assert.equal(
      relationshipActionPriorityScore(generated, now) -
        relationshipActionPriorityScore(manual, now),
      6,
    );
  });

  test("sorts the action plan by operating urgency", () => {
    const plan = buildRelationshipActionPlan(
      [
        action({ id: "later", title: "Later", due_on: "2026-08-15" }),
        action({
          id: "verify",
          title: "Verify relationship note",
          action_type: "owner_verification",
          priority: "high",
          due_on: "2026-07-19",
        }),
        action({ id: "done", title: "Already handled", status: "done" }),
      ],
      now,
    );

    assert.equal(plan[0].action.id, "verify");
    assert.equal(plan.at(-1)?.action.id, "done");
  });

  test("summarizes open action pressure without counting closed work", () => {
    const summary = relationshipActionPlanSummary(
      [
        action({ id: "overdue", due_on: "2026-07-19" }),
        action({ id: "today", due_on: "2026-07-20" }),
        action({ id: "soon", due_on: "2026-07-22" }),
        action({ id: "loose", due_on: null }),
        action({ id: "done", status: "done" }),
      ],
      now,
    );

    assert.deepEqual(
      {
        open: summary.open,
        overdue: summary.overdue,
        dueToday: summary.dueToday,
        dueSoon: summary.dueSoon,
        unscheduled: summary.unscheduled,
        closed: summary.closed,
      },
      {
        open: 4,
        overdue: 1,
        dueToday: 1,
        dueSoon: 1,
        unscheduled: 1,
        closed: 1,
      },
    );
    assert.equal(summary.topAction?.action.id, "overdue");
  });
});
