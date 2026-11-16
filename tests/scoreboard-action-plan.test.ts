import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildScoreboardActionPlan,
  type ScoreboardPlanInput,
} from "../lib/scoreboard-action-plan.js";

function input(overrides: Partial<ScoreboardPlanInput> = {}): ScoreboardPlanInput {
  return {
    contactCount: 100,
    duePromises: [],
    staleTrusted: [],
    pendingChanges: [],
    movementQueue: [],
    dataReadiness: 92,
    weakRecordCount: 2,
    highValueWeakCount: 0,
    recentInteractionCount: 12,
    connectionRate: 60,
    promiseKeepRate: 90,
    ...overrides,
  };
}

describe("scoreboard action plan", () => {
  test("prioritizes due promises before reviews and movement", () => {
    const plan = buildScoreboardActionPlan(
      input({
        duePromises: [
          {
            id: "promise-1",
            promise_text: "Send the investor list",
            direction: "owner_owes_contact",
            due_on: "2026-07-21",
            contacts: { id: "contact-1", full_name: "Alicia Ramos" },
          },
        ],
        pendingChanges: [
          {
            id: "change-1",
            summary: "Update trust tier",
            risk_level: "high",
            contacts: { id: "contact-2", full_name: "Jordan Lee" },
          },
        ],
      }),
    );

    assert.equal(plan.mode, "Protect Trust");
    assert.equal(plan.primary.href, "/promises");
    assert.match(plan.primary.detail, /Send the investor list/);
    assert.ok(plan.secondary.some((action) => action.href === "/changes"));
  });

  test("routes high-risk judgment pressure to Changes", () => {
    const plan = buildScoreboardActionPlan(
      input({
        pendingChanges: [
          {
            id: "change-1",
            summary: "Mark referral-ready after owner clarification",
            risk_level: "high",
            contacts: { id: "contact-1", full_name: "Maya Chen" },
          },
        ],
      }),
    );

    assert.equal(plan.mode, "Review Judgment");
    assert.equal(plan.primary.href, "/changes");
    assert.equal(plan.primary.metric, "1");
  });

  test("uses movement before stale trust when the queue is hot", () => {
    const plan = buildScoreboardActionPlan(
      input({
        staleTrusted: [
          {
            id: "contact-1",
            full_name: "Dana Park",
            company_name: "Park Capital",
            trust_level: "Tier 1",
            relationship_strength: "Strong",
            last_spoke: "2025-12-01",
            current_asks: null,
            wants_help_with: null,
            ideal_referral: "Family offices",
            podcast_fit: null,
          },
        ],
        movementQueue: [
          {
            key: "move-1",
            title: "Follow up on intro",
            detail: "Due today",
            href: "/networking",
            tone: "hot",
          },
        ],
      }),
    );

    assert.equal(plan.mode, "Move Relationships");
    assert.equal(plan.primary.href, "/networking");
  });

  test("moves to growth when urgent work is clear", () => {
    const plan = buildScoreboardActionPlan(input());

    assert.equal(plan.mode, "Grow");
    assert.equal(plan.primary.href, "/contacts");
    assert.match(plan.watchlist[0], /Nothing urgent/);
  });

  test("routes thin context to owner-safe relationship review", () => {
    const plan = buildScoreboardActionPlan(
      input({
        dataReadiness: 62,
        weakRecordCount: 8,
        highValueWeakCount: 3,
      }),
    );

    assert.equal(plan.mode, "Improve Data");
    assert.equal(plan.primary.href, "/contacts?view=judgment");
    assert.equal(plan.primary.label, "Complete profiles");
    assert.match(plan.primary.detail, /priority profiles/);
    assert.ok(!plan.primary.detail.includes("Quality"));
  });
});
