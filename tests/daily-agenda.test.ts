import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildDailyAgenda } from "../lib/daily-agenda.js";
import type { DailyBrief } from "../lib/daily-brief.js";
import type { DailyPriority } from "../lib/daily-priorities.js";

const brief: DailyBrief = {
  mode: "Protect Trust",
  tone: "hot",
  headline: "Close promise pressure before adding new volume",
  detail: "2 promises are due or overdue.",
  nextLabel: "Review promise",
  href: "/promises",
  signals: [],
};

function priority(overrides: Partial<DailyPriority>): DailyPriority {
  return {
    key: "priority-1",
    eyebrow: "Next",
    title: "Top priority",
    detail: "Top detail",
    reason: "Top reason",
    href: "/movement",
    action: "Work move",
    tone: "gold",
    score: 80,
    ...overrides,
  };
}

describe("daily agenda", () => {
  test("uses a concierge setup agenda before contacts exist", () => {
    const agenda = buildDailyAgenda({
      brief: {
        ...brief,
        mode: "Setup",
        tone: "gold",
        headline: "The Book needs relationship data before daily use",
        detail: "The first verified contacts need to be loaded.",
        nextLabel: "Open the book",
        href: "/contacts",
      },
      priorities: [priority({ key: "empty:ask", title: "Ask the book", href: "/ask" })],
    });

    assert.equal(agenda.headline, "The Book needs relationship data before daily use");
    assert.equal(agenda.primary.href, "/contacts");
    assert.equal(agenda.primary.title, "Wait for the first verified relationship data");
    assert.equal(agenda.decisions.length, 0);
    assert.equal(agenda.keepWarm.length, 0);
    assert.match(agenda.ignoreForNow, /concierge import/);
  });

  test("turns ranked priorities into a simple owner agenda", () => {
    const agenda = buildDailyAgenda({
      brief,
      priorities: [
        priority({
          key: "promise:1",
          title: "Send the investor list",
          tone: "hot",
          action: "Close loop",
          secondaryAction: "Promise lane",
          secondaryHref: "/promises?filter=owner",
        }),
        priority({
          key: "change:1",
          title: "Verify referral readiness",
          eyebrow: "Verify",
          href: "/changes/1",
        }),
        priority({
          key: "contact:1",
          title: "Rewarm Maya",
          suggestedActionType: "reconnect",
          href: "/contacts/1",
        }),
      ],
    });

    assert.equal(agenda.primary.title, "Send the investor list");
    assert.equal(agenda.primary.tone, "hot");
    assert.equal(agenda.primary.secondaryHref, "/promises?filter=owner");
    assert.equal(agenda.decisions[0]?.title, "Verify referral readiness");
    assert.equal(agenda.keepWarm[0]?.title, "Rewarm Maya");
    assert.match(agenda.ignoreForNow, /prospecting/);
  });

  test("uses support items when there are no explicit decisions", () => {
    const agenda = buildDailyAgenda({
      brief: { ...brief, mode: "Ask", headline: "No urgent queue", detail: "Ask." },
      priorities: [
        priority({ key: "empty:ask", title: "Ask the book", href: "/ask" }),
        priority({ key: "relationship_action:1", title: "Review next move" }),
      ],
    });

    assert.equal(agenda.headline, "Use the Book to create one useful relationship move");
    assert.equal(agenda.decisions[0]?.label, "If time");
    assert.match(agenda.ignoreForNow, /one useful move/);
  });
});
