import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildEngagementCandidate,
  buildEngagementQueue,
  type EngagementContactRow,
} from "../lib/engagement-candidates.js";

function contact(overrides: Partial<EngagementContactRow>): EngagementContactRow {
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
    ...overrides,
  };
}

describe("engagement candidates", () => {
  test("promotes overdue owner promises above useful outreach", () => {
    const queue = buildEngagementQueue({
      contacts: [
        contact({
          id: "promise",
          full_name: "Morgan Promise",
        }),
        contact({
          id: "objective",
          current_asks: "Needs an intro to a strategic buyer.",
          full_name: "Parker Objective",
        }),
      ],
      promises: [
        {
          id: "promise-1",
          contact_id: "promise",
          direction: "owner_owes_contact",
          due_on: "2026-01-10",
          promise_text: "Send the diligence notes",
        },
      ],
    });

    assert.equal(queue[0]?.id, "promise");
    assert.equal(queue[0]?.rung, "Follow through");
    assert.equal(queue[0]?.risk, "Trust risk");
    assert.equal(queue[1]?.rung, "Be useful");
  });

  test("keeps referral and rewarm logic bucket-agnostic", () => {
    const referral = buildEngagementCandidate(
      contact({
        id: "referral",
        relationship_type: ["Warm intro partner"],
        top_3_tags: ["strategic intros"],
      }),
      [],
    );
    const rewarm = buildEngagementCandidate(
      contact({
        id: "rewarm",
        last_spoke: "2025-01-01",
        relationship_type: ["Advisor"],
        top_3_tags: [],
      }),
      [],
    );

    assert.equal(referral.priority, "P2");
    assert.equal(referral.rung, "Comment");
    assert.equal(rewarm.priority, "P3");
    assert.equal(rewarm.risk, "Cooling relationship");
  });
});
