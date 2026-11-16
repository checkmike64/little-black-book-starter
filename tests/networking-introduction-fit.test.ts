import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  resolveIntroductionFitEvidence,
  type NetworkingContact,
} from "../lib/networking/matching.js";

function contact(
  id: string,
  fullName: string,
  overrides: Partial<NetworkingContact> = {},
): NetworkingContact {
  return {
    id,
    full_name: fullName,
    company_name: null,
    company_description: null,
    role_title: null,
    one_line_summary: null,
    current_asks: null,
    wants_help_with: null,
    what_they_want_more_of: null,
    ideal_referral: null,
    podcast_fit: null,
    podcast_url: null,
    services_offered: null,
    could_refer_me_for: null,
    primary_category: null,
    top_3_tags: null,
    keywords: null,
    do_not_refer_for: null,
    ...overrides,
  };
}

describe("networking introduction fit evidence", () => {
  test("preserves accepted source-backed terms", () => {
    assert.deepEqual(
      resolveIntroductionFitEvidence({
        evidence: {
          matched_terms: [" operations ", "operations", "leadership"],
          matched_terms_source: "stored_evidence_exact_excerpt",
        },
      }),
      {
        terms: ["operations", "leadership"],
        reasonSource: "connection.matched_terms",
      },
    );
  });

  test("repairs a legacy recommendation from current deterministic contact facts", () => {
    const seeker = contact("seeker", "Ava", {
      podcast_fit:
        "Ava wants podcast appearances about AI systems for solo founders, including the Focused Founder show.",
    });
    const host = contact("host", "Bob", {
      company_name: "Focused Founder",
      role_title: ["Podcaster"],
      one_line_summary: "Host of the Focused Founder show about AI systems.",
    });

    const result = resolveIntroductionFitEvidence({
      evidence: {
        summary: "Untrusted legacy model prose.",
        evidence_refs: [{ kind: "owner_note", note: "Unbound legacy note." }],
      },
      contactA: seeker,
      contactB: host,
    });

    assert.equal(result?.reasonSource, "connection.current_contact_match");
    assert.deepEqual(result?.terms, ["focused", "systems"]);
  });

  test("fails closed when only legacy prose exists and current facts do not fit", () => {
    assert.equal(
      resolveIntroductionFitEvidence({
        evidence: {
          summary: "These people would be a great fit.",
          evidence_refs: [{ note: "A prior model recommended them." }],
        },
        contactA: contact("a", "Ava", { current_asks: "Healthcare leadership" }),
        contactB: contact("b", "Bob", { services_offered: ["Ecommerce marketing"] }),
      }),
      null,
    );
  });

  test("keeps current do-not-refer and tenant rules fail closed", () => {
    const seeker = contact("seeker", "Ava", {
      current_asks: "Needs operations support.",
    });
    const restricted = contact("provider", "Bob", {
      services_offered: ["Operations support"],
      do_not_refer_for: "Operations",
    });
    assert.equal(
      resolveIntroductionFitEvidence({
        evidence: {},
        contactA: seeker,
        contactB: restricted,
      }),
      null,
    );

    const allowed = { ...restricted, do_not_refer_for: null };
    assert.equal(
      resolveIntroductionFitEvidence({
        evidence: {},
        contactA: seeker,
        contactB: allowed,
        policy: { relationshipRules: "Do not make operations introductions." },
      }),
      null,
    );
  });
});
