import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { engagementActionDefaults } from "../lib/engagement-action-defaults.js";
import type { EngagementCandidate } from "../lib/engagement-candidates.js";

function candidate(
  overrides: Partial<EngagementCandidate>,
): EngagementCandidate {
  return {
    id: "contact-1",
    full_name: "Alicia Harper",
    company_name: "Harper Co",
    trust_level: "Warm",
    relationship_strength: "Strong",
    relationship_type: ["Investor"],
    touch_cadence: "Monthly",
    last_spoke: "2026-01-01",
    current_asks: null,
    wants_help_with: null,
    ideal_referral: null,
    podcast_fit: null,
    recent_activity: null,
    top_3_tags: [],
    priority: "P2",
    rung: "Comment",
    promises: [],
    score: 72,
    nextAction: "Ask Claude for a specific relationship-maintenance touch.",
    risk: "Relationship value",
    why: "Warm relationship.",
    staleDays: 40,
    ...overrides,
  };
}

describe("engagement action defaults", () => {
  test("routes owner promises to follow-through actions", () => {
    const defaults = engagementActionDefaults(
      candidate({
        priority: "P1",
        rung: "Follow through",
        nextAction: "Close the loop: send the notes",
        risk: "Trust risk",
      }),
    );

    assert.equal(defaults.actionKind, "log_touch");
    assert.equal(defaults.actionType, "promise");
    assert.equal(defaults.defaultPriority, "high");
    assert.doesNotMatch(defaults.assistTitle, /handoff/i);
    assert.equal(defaults.touchLabel, "Log follow-through");
  });

  test("keeps prospecting buckets flexible by inferring referral and podcast defaults", () => {
    const referral = engagementActionDefaults(
      candidate({
        rung: "Be useful",
        current_asks: "Needs an intro to a strategic buyer.",
        nextAction: "Look for an intro lane",
      }),
    );
    const podcast = engagementActionDefaults(
      candidate({
        rung: "Be useful",
        podcast_fit: "Good guest for private equity podcasts.",
        nextAction: "Use podcast context",
      }),
    );

    assert.equal(referral.actionType, "referral");
    assert.equal(referral.commandIntent, "verify_referral_lane");
    assert.doesNotMatch(referral.assistTitle, /handoff/i);
    assert.equal(podcast.actionType, "podcast");
    assert.equal(podcast.commandIntent, "draft_outreach");
    assert.doesNotMatch(podcast.assistTitle, /handoff/i);
  });

  test("routes cooling relationships to rewarm touches", () => {
    const defaults = engagementActionDefaults(
      candidate({
        priority: "P3",
        risk: "Cooling relationship",
        nextAction: "Draft a light reactivation note.",
      }),
    );

    assert.equal(defaults.actionType, "reconnect");
    assert.equal(defaults.assistTitle, "Prepare rewarm note");
    assert.doesNotMatch(defaults.assistTitle, /handoff/i);
  });
});
