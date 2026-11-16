import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildEngagementWeeklyPlan,
  type WeeklyEngagementCandidate,
} from "../lib/engagement-weekly-plan.js";

function candidate(
  overrides: Partial<WeeklyEngagementCandidate>,
): WeeklyEngagementCandidate {
  return {
    id: "contact-1",
    full_name: "Alicia Harper",
    company_name: "Harper Co",
    priority: "P2",
    rung: "Comment",
    promises: [],
    score: 70,
    nextAction: "Send a useful note.",
    risk: "Relationship value",
    why: "Warm relationship.",
    staleDays: 30,
    recent_activity: null,
    ...overrides,
  };
}

describe("engagement weekly plan", () => {
  test("protects trust before broader outreach", () => {
    const plan = buildEngagementWeeklyPlan({
      queue: [
        candidate({
          id: "promise",
          rung: "Follow through",
          risk: "Trust risk",
          promises: [
            {
              direction: "owner_owes_contact",
              due_on: "2026-07-20",
              promise_text: "Send the deck",
            },
          ],
        }),
        candidate({
          id: "useful",
          rung: "Be useful",
          risk: "Active opportunity",
        }),
      ],
      recentInteractionCount: 2,
      signalCount: 3,
    });

    assert.equal(plan.posture, "protect_trust");
    assert.equal(plan.lead?.id, "promise");
    assert.equal(plan.counts.mustClose, 1);
    assert.equal(plan.lanes[0]?.items[0]?.id, "promise");
  });

  test("uses warm opportunities when promises are clear", () => {
    const plan = buildEngagementWeeklyPlan({
      queue: [
        candidate({
          id: "opportunity",
          rung: "Be useful",
          risk: "Active opportunity",
          nextAction: "Offer a targeted introduction.",
        }),
        candidate({
          id: "rewarm",
          priority: "P3",
          staleDays: 140,
          risk: "Cooling relationship",
        }),
      ],
      recentInteractionCount: 7,
      signalCount: 2,
    });

    assert.equal(plan.posture, "use_opportunities");
    assert.equal(plan.paceLabel, "On pace");
    assert.equal(plan.lead?.id, "opportunity");
    assert.equal(plan.counts.rewarm, 1);
  });

  test("falls back to rewarm and light-touch lanes", () => {
    const plan = buildEngagementWeeklyPlan({
      queue: [
        candidate({
          id: "stale",
          priority: "P3",
          staleDays: 120,
          risk: "Cooling relationship",
        }),
        candidate({
          id: "light",
          priority: "P4",
          rung: "Like",
          score: 28,
          risk: "Low urgency",
          staleDays: 20,
        }),
      ],
      recentInteractionCount: 1,
      signalCount: 0,
      targetTouches: 3,
    });

    assert.equal(plan.posture, "rewarm");
    assert.equal(plan.counts.selected, 2);
    assert.equal(plan.paceLabel, "2 touches to target");
    assert.equal(plan.lanes.find((lane) => lane.key === "light_touch")?.items[0]?.id, "light");
  });
});
