import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildQualityCleanupFocus } from "../lib/data-quality.js";

const baseContact = {
  id: "contact-1",
  full_name: "Alicia Example",
  email: "alicia@example.com",
  phone: null,
  company_name: "Example Co",
  role_title: ["Founder"],
  one_line_summary: "Founder and trusted referral partner.",
  trust_level: "trusted",
  relationship_strength: "strong",
  relationship_type: ["referral"],
  last_spoke: "2026-07-20",
  how_we_met: "Introduced by Alex",
  why_stay_in_touch: "Strong referral partner",
  current_asks: "Looking for podcast guests",
  wants_help_with: null,
  ideal_referral: null,
  podcast_fit: null,
  linkedin: null,
  instagram: null,
  facebook: null,
  x_twitter: null,
  youtube: null,
  podcast_url: null,
  website: null,
  recent_activity: "Recent call",
  private_notes: null,
};

describe("quality cleanup queue", () => {
  test("marks trust and relationship gaps as owner verification work", () => {
    const focus = buildQualityCleanupFocus({
      ...baseContact,
      trust_level: null,
      relationship_strength: null,
    });

    assert.equal(focus.owner_verification_required, true);
    assert.deepEqual(
      focus.missing.filter((item: string) =>
        ["trust tier", "relationship strength"].includes(item),
      ),
      ["trust tier", "relationship strength"],
    );
    assert.match(focus.next_step, /owner/i);
  });

  test("allows source-backed enrichment when judgment fields are already present", () => {
    const focus = buildQualityCleanupFocus({
      ...baseContact,
      how_we_met: null,
      last_spoke: null,
    });

    assert.equal(focus.owner_verification_required, false);
    assert.deepEqual(
      focus.missing.filter((item: string) =>
        ["how you met", "last touch date"].includes(item),
      ),
      ["last touch date", "how you met"],
    );
  });

  test("flags stale podcast context without treating the contact as a prospect", () => {
    const focus = buildQualityCleanupFocus({
      ...baseContact,
      role_title: ["Podcast Host"],
      podcast_fit: "Alex appeared on the show.",
      recent_activity: null,
    });

    assert.ok(focus.missing.includes("current podcast or publishing signal"));
    assert.match(focus.next_step, /still active/i);
  });

  test("does not mistake ordinary podcast fit for a podcast-host record", () => {
    const focus = buildQualityCleanupFocus({
      ...baseContact,
      podcast_fit: "Could be a useful guest on an M&A podcast.",
      recent_activity: null,
      private_notes: "Known through business.",
    });

    assert.equal(
      focus.missing.includes("current podcast or publishing signal"),
      false,
    );
  });
});
