import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildContactExecutiveBrief } from "../lib/contact-executive-brief.js";
import type { BriefContact } from "../lib/contact-brief.js";

function contact(overrides: Partial<BriefContact> = {}): BriefContact {
  return {
    id: "contact-1",
    full_name: "Alicia Stone",
    company_name: "Stone Capital",
    role_title: ["Founder"],
    one_line_summary: "Investor and operator.",
    trust_level: "Tier 1",
    relationship_strength: "Strong",
    relationship_strength_reason: "Multiple successful intros.",
    relationship_strength_override: false,
    relationship_type: ["Investor"],
    last_spoke: new Date().toISOString().slice(0, 10),
    touch_cadence: "Monthly",
    how_we_met: "Operator dinner",
    why_stay_in_touch: "Can help with investor intros.",
    current_asks: "Looking for software founders.",
    wants_help_with: null,
    what_they_want_more_of: null,
    ideal_referral: "B2B SaaS founders",
    do_not_refer_for: null,
    referral_intro_blurb: null,
    podcast_fit: null,
    recent_activity: "Raised a new fund.",
    personal_notes: null,
    private_notes: null,
    top_3_tags: ["Investor"],
    keywords: ["capital"],
    ...overrides,
  };
}

describe("contact executive brief", () => {
  test("prioritizes owner promise debt before other moves", () => {
    const brief = buildContactExecutiveBrief({
      contact: contact(),
      introductions: [],
      promises: [
        {
          id: "promise-1",
          promise_text: "Send the founder list",
          direction: "owner_owes_contact",
          status: "open",
          due_on: "2026-01-01",
        },
      ],
      quality: { readiness: 95, missing: [], nextStep: "Ready." },
    });

    assert.equal(brief.status, "Act");
    assert.equal(brief.tone, "hot");
    assert.match(brief.bestMove, /Send the founder list/);
    assert.ok(brief.guardrails.some((item) => /overdue/.test(item)));
  });

  test("routes missing trust posture to verification", () => {
    const brief = buildContactExecutiveBrief({
      contact: contact({ trust_level: null, relationship_strength: null }),
      introductions: [],
      promises: [],
      quality: {
        readiness: 68,
        missing: ["trust tier", "relationship strength"],
        nextStep: "Ask the owner to verify judgment fields.",
      },
    });

    assert.equal(brief.status, "Verify");
    assert.match(brief.bestMove, /Verify trust/);
    assert.ok(brief.guardrails.some((item) => /Trust or strength/.test(item)));
  });

  test("marks clean current profiles as ready to use", () => {
    const brief = buildContactExecutiveBrief({
      contact: contact(),
      introductions: [],
      promises: [],
      quality: { readiness: 92, missing: [], nextStep: "Ready enough." },
    });

    assert.equal(brief.status, "Watch");
    assert.equal(brief.tone, "cool");
    assert.match(brief.bestMove, /current ask/i);
    assert.match(brief.askHref, /Alicia%20Stone/);
  });
});
