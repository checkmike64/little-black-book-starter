import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildMovementViewBrief } from "../lib/movement-view-brief.js";

const sourceMix = {
  ask: 2,
  claude: 1,
  ownerVerification: 1,
  primary: {
    href: "/movement?view=from_ask",
    tone: "gold" as const,
  },
};

const summary = {
  closed: 3,
  dueSoon: 4,
  dueToday: 1,
  open: 9,
  overdue: 2,
  unscheduled: 5,
};

describe("movement view brief", () => {
  test("routes Ask-created movement back to undecided Ask work when needed", () => {
    const brief = buildMovementViewBrief({
      filteredCount: 2,
      query: "",
      sourceMix,
      summary,
      undecidedAskRuns: 3,
      view: "from_ask",
    });

    assert.equal(brief.actionHref, "/ask?saved=needs_decision");
    assert.equal(brief.actionLabel, "Close Ask decisions");
    assert.equal(brief.metrics[0]?.value, 2);
  });

  test("keeps loose movement focused on scheduling", () => {
    const brief = buildMovementViewBrief({
      filteredCount: 5,
      query: "intro",
      sourceMix,
      summary,
      undecidedAskRuns: 0,
      view: "needs_date",
    });

    assert.equal(brief.actionHref, "/movement?view=needs_date");
    assert.equal(brief.actionLabel, "Schedule loose moves");
    assert.match(brief.title, /Matching "intro"/);
    assert.equal(brief.tone, "gold");
  });

  test("uses the source mix primary lane for the active default", () => {
    const brief = buildMovementViewBrief({
      filteredCount: 9,
      query: "",
      sourceMix,
      summary,
      undecidedAskRuns: 0,
      view: "active",
    });

    assert.equal(brief.actionHref, "/movement?view=from_ask");
    assert.equal(brief.tone, "gold");
  });
});
