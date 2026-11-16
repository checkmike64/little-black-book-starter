import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildContactSignal,
  contactValueLabel,
  contactViewMatches,
  normalizeContactSignalView,
  type ContactSignalContact,
} from "../lib/contact-signals.js";

const now = Date.parse("2026-07-21T12:00:00.000Z");

function contact(overrides: Partial<ContactSignalContact> = {}): ContactSignalContact {
  return {
    full_name: "Alicia Stone",
    company_name: "Stone Capital",
    role_title: ["Founder"],
    trust_level: "Tier 1",
    relationship_strength: "Strong",
    relationship_type: ["Investor"],
    email: "alicia@example.com",
    last_spoke: "2026-07-01",
    current_asks: null,
    wants_help_with: null,
    recent_activity: null,
    private_notes: null,
    ...overrides,
  };
}

describe("contact signals", () => {
  test("promotes overdue owner promises above ordinary context", () => {
    const signal = buildContactSignal(
      contact({ current_asks: "Looking for founders." }),
      [
        {
          direction: "owner_owes_contact",
          due_on: "2026-07-20",
          promise_text: "Send Alicia the operating memo",
        },
      ],
      now,
    );

    assert.equal(signal.risk, "Overdue promise");
    assert.match(signal.action, /Send Alicia/);
    assert.equal(signal.tone, "hot");
  });

  test("keeps view matching independent from podcast-specific assumptions", () => {
    const signal = buildContactSignal(
      contact({
        trust_level: "Warm",
        relationship_strength: "Medium",
        relationship_type: ["Referral partner"],
        current_asks: null,
      }),
      [],
      now,
    );

    assert.equal(signal.hasReferralLane, true);
    assert.equal(contactViewMatches("referrals", signal), true);
    assert.equal(
      contactValueLabel(
        contact({
          trust_level: "Unknown",
          relationship_strength: "Unscored",
          relationship_type: ["Acquisition target"],
        }),
      ),
      "Strategic",
    );
  });

  test("detects stale relationship and judgment queues", () => {
    const stale = buildContactSignal(
      contact({
        trust_level: null,
        relationship_strength: null,
        last_spoke: "2025-12-01",
      }),
      [],
      now,
    );

    assert.equal(stale.needsRewarm, true);
    assert.equal(stale.needsJudgment, true);
    assert.equal(contactViewMatches("rewarm", stale), true);
    assert.equal(contactViewMatches("judgment", stale), true);
  });

  test("normalizes unknown contact views back to priority", () => {
    assert.equal(normalizeContactSignalView("all"), "all");
    assert.equal(normalizeContactSignalView("not-a-view"), "priority");
    assert.equal(normalizeContactSignalView(undefined), "priority");
  });
});
