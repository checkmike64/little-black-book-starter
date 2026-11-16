import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildMovementCommand,
  movementCommandNextMoves,
} from "../lib/movement-command-center.js";
import { buildRelationshipActionPlan } from "../lib/relationship-action-planning.js";
import type { RelationshipMovementItem } from "../lib/relationship-movement.js";

const now = new Date("2026-07-21T12:00:00Z");
const emptySummary = {
  total: 0,
  promises: 0,
  introductions: 0,
  rewarm: 0,
  opportunities: 0,
};

function movement(
  overrides: Partial<RelationshipMovementItem>,
): RelationshipMovementItem {
  return {
    key: "move-1",
    kind: "rewarm",
    actionKind: "log_touch",
    recordId: "contact-1",
    title: "Alicia Harper",
    detail: "90 days since last touch",
    reason: "Important relationship is past cadence.",
    href: "/contacts/contact-1",
    action: "Rewarm",
    tone: "cool",
    score: 60,
    contactId: "contact-1",
    ...overrides,
  };
}

function actionPlan(
  overrides: {
    id?: string;
    title?: string;
    due_on?: string | null;
    priority?: string;
    action_type?: string;
    status?: string;
  } = {},
) {
  const dueOn = Object.hasOwn(overrides, "due_on")
    ? (overrides.due_on ?? null)
    : "2026-07-21";

  return buildRelationshipActionPlan(
    [
      {
        id: overrides.id ?? "action-1",
        title: overrides.title ?? "Follow up",
        action_type: overrides.action_type ?? "follow_up",
        status: overrides.status ?? "open",
        priority: overrides.priority ?? "normal",
        due_on: dueOn,
      },
    ],
    now,
  );
}

describe("movement command center", () => {
  test("prioritizes owner promises before other movement", () => {
    const command = buildMovementCommand({
      actionPlan: actionPlan({ title: "Hot follow-up" }),
      movementQueue: [
        movement({
          kind: "promise",
          actionKind: "complete_promise",
          title: "Send investor deck",
          action: "Close loop",
          tone: "hot",
          score: 120,
        }),
      ],
      movementSummary: { ...emptySummary, total: 1, promises: 1 },
      undecidedAskRuns: 0,
    });

    assert.equal(command.posture, "close_loop");
    assert.match(command.title, /Send investor deck/);
    assert.equal(command.primary.label, "Close loop");
    assert.equal(movementCommandNextMoves(command).some((move) => move.label === "Send investor deck"), false);
  });

  test("works hot dated relationship actions when they outrank softer movement", () => {
    const command = buildMovementCommand({
      actionPlan: actionPlan({
        title: "Verify conference intro",
        priority: "high",
        action_type: "owner_verification",
        due_on: "2026-07-20",
      }),
      movementQueue: [movement({ score: 45 })],
      movementSummary: { ...emptySummary, total: 1, rewarm: 1 },
      undecidedAskRuns: 0,
    });

    assert.equal(command.posture, "work_timed_action");
    assert.equal(command.primary.href, "/movement?view=hot");
    assert.match(command.guardrail, /dated relationship actions/);
    assert.equal(command.supportingMoves[0]?.label, "Verify conference intro");
    assert.equal(command.supportingMoves[0]?.href, "/movement?view=hot");
  });

  test("uses opportunities before creating more prospecting", () => {
    const command = buildMovementCommand({
      actionPlan: [],
      movementQueue: [
        movement({
          kind: "opportunity",
          actionKind: "use_opportunity",
          title: "Jordan Lee",
          detail: "Podcast fit for founder shows",
          action: "Use opportunity",
          tone: "gold",
          score: 82,
        }),
      ],
      movementSummary: { ...emptySummary, total: 1, opportunities: 1 },
      undecidedAskRuns: 0,
    });

    assert.equal(command.posture, "use_opportunity");
    assert.match(command.guardrail, /fresh prospecting list/);
  });

  test("schedules undated actions before treating the queue as clear", () => {
    const command = buildMovementCommand({
      actionPlan: actionPlan({ title: "Send loose follow-up", due_on: null }),
      movementQueue: [],
      movementSummary: emptySummary,
      undecidedAskRuns: 0,
    });

    assert.equal(command.posture, "schedule_action");
    assert.equal(command.primary.href, "/movement?view=needs_date");
  });

  test("surfaces saved Ask decisions when no relationship work is queued", () => {
    const command = buildMovementCommand({
      actionPlan: [],
      movementQueue: [],
      movementSummary: emptySummary,
      undecidedAskRuns: 3,
    });

    assert.equal(command.posture, "decide_ask");
    assert.equal(command.primary.href, "/ask?saved=needs_decision");
  });
});
