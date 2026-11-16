import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildDailyBrief, type DailyBriefInput } from "../lib/daily-brief.js";

const topPriority = {
  key: "priority-1",
  eyebrow: "Next",
  title: "Do the thing",
  detail: "Useful detail",
  reason: "Useful reason",
  href: "/movement",
  action: "Work move",
  tone: "gold",
  score: 80,
} as const;

function input(overrides: Partial<DailyBriefInput> = {}): DailyBriefInput {
  return {
    topPriority,
    contactCount: 50,
    pendingChangeCount: 0,
    askRunUndecidedCount: 0,
    overduePromises: 0,
    highRiskChanges: 0,
    hotRelationshipActions: 0,
    untrackedCommandOutputs: 0,
    staleUsefulContacts: 0,
    ...overrides,
  };
}

describe("daily brief", () => {
  test("prioritizes setup before normal daily use", () => {
    const brief = buildDailyBrief(input({ contactCount: 0 }));

    assert.equal(brief.mode, "Setup");
    assert.equal(brief.href, "/contacts");
    assert.doesNotMatch(brief.detail, /Claude|operator intake/i);
    assert.match(brief.detail, /first verified contacts/);
  });

  test("protects trust before review and movement", () => {
    const brief = buildDailyBrief(
      input({
        topPriority: {
          ...topPriority,
          href: "/contacts/contact-1",
          action: "Close promise",
        },
        overduePromises: 2,
        highRiskChanges: 4,
        hotRelationshipActions: 3,
      }),
    );

    assert.equal(brief.mode, "Protect Trust");
    assert.match(brief.detail, /2 promises/);
    assert.equal(brief.href, "/contacts/contact-1");
    assert.equal(brief.nextLabel, "Close promise");
  });

  test("routes judgment pressure to the review surface", () => {
    const brief = buildDailyBrief(input({ highRiskChanges: 1, pendingChangeCount: 2 }));

    assert.equal(brief.mode, "Verify Judgment");
    assert.equal(brief.href, "/changes");
  });

  test("uses Ask when the day has no urgent operating pressure", () => {
    const brief = buildDailyBrief(input());

    assert.equal(brief.mode, "Ask");
    assert.equal(brief.tone, "cool");
    assert.equal(brief.href, "/ask");
  });

  test("uses the ranked movement route when hot relationship actions are due", () => {
    const brief = buildDailyBrief(
      input({
        topPriority: {
          ...topPriority,
          href: "/contacts/contact-1",
          action: "Work Alicia",
        },
        hotRelationshipActions: 1,
      }),
    );

    assert.equal(brief.mode, "Move Work");
    assert.equal(brief.href, "/contacts/contact-1");
    assert.equal(brief.nextLabel, "Work Alicia");
  });
});
