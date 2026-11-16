import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  scoreNetworkingPair,
  selectDiverseMatches,
  selectRecommendationPortfolio,
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

describe("networking matching", () => {
  test("creates a strong, explainable podcast seeker-to-host match", () => {
    const seeker = contact("seeker", "Igor Shvartser", {
      current_asks:
        "Looking for podcast guest opportunities about leadership and scaling teams.",
    });
    const host = contact("host", "Cahill Camden", {
      one_line_summary:
        "Host of a show about leadership lessons and scaling strong teams.",
      podcast_url: "https://example.com/podcast",
    });

    const match = scoreNetworkingPair(seeker, host);

    assert.ok(match);
    assert.ok(match.score >= 80);
    assert.equal(match.direction, "a_to_b");
    assert.equal(match.evidence.match_type, "podcast");
    assert.equal(
      match.evidence.summary,
      "Igor Shvartser wants podcast appearances about leadership, scaling, and teams, and Cahill Camden's show covers those topics.",
    );
  });

  test("rejects a podcast pairing when the show and guest topics do not overlap", () => {
    const seeker = contact("seeker", "Guest", {
      current_asks: "Looking for podcast appearances about healthcare leadership.",
    });
    const host = contact("host", "Host", {
      one_line_summary: "Hosts a show about ecommerce marketing.",
      podcast_url: "https://example.com/podcast",
    });

    assert.equal(scoreNetworkingPair(seeker, host), null);
  });

  test("matches stated needs to concrete services and referral expertise", () => {
    const founder = contact("founder", "Alicia Harper", {
      wants_help_with: "Finding acquisition buyers and preparing for an exit.",
      ideal_referral: "An experienced M&A advisor.",
    });
    const advisor = contact("advisor", "Marcus Green", {
      services_offered: ["M&A advisory", "Exit planning"],
      could_refer_me_for: ["Acquisitions"],
      keywords: ["buyers", "founders"],
    });

    const match = scoreNetworkingPair(founder, advisor);

    assert.ok(match);
    assert.equal(match.direction, "a_to_b");
    assert.ok(match.matchedTerms.includes("acquisition"));
    assert.match(match.evidence.summary, /Alicia Harper is looking for help/);
    assert.match(match.evidence.summary, /Marcus Green works in that area/);
  });

  test("rejects unrelated people instead of inventing a reason", () => {
    const marketer = contact("marketer", "Priya Shah", {
      current_asks: "Looking for ecommerce brand marketing partnerships.",
    });
    const engineer = contact("engineer", "Daniel Kim", {
      company_description: "Builds industrial robotics and factory control systems.",
      services_offered: ["Mechanical engineering"],
      keywords: ["Robotics", "Manufacturing"],
    });

    const match = scoreNetworkingPair(marketer, engineer);

    assert.equal(match, null);
  });

  test("does not treat generic profile words as a networking reason", () => {
    const first = contact("first", "First Person", {
      current_asks: "Looking for the best clients to build with in 2026.",
    });
    const second = contact("second", "Second Person", {
      company_description: "A client service business built for owners in 2026.",
    });

    assert.equal(scoreNetworkingPair(first, second), null);
  });

  test("treats do-not-refer topics as a hard directional constraint", () => {
    const seeker = contact("seeker", "Seeker", {
      current_asks: "Needs finance and CFO help.",
    });
    const provider = contact("provider", "Provider", {
      services_offered: ["Finance and fractional CFO services"],
      do_not_refer_for: "Finance or CFO work",
    });

    assert.equal(scoreNetworkingPair(seeker, provider), null);
  });

  test("preserves an allowed direction when the reciprocal direction is restricted", () => {
    const first = contact("first", "First", {
      current_asks: "Needs marketing strategy.",
      services_offered: ["Operations consulting"],
      do_not_refer_for: "Operations",
    });
    const second = contact("second", "Second", {
      current_asks: "Needs operations advice.",
      services_offered: ["Marketing strategy"],
    });

    const match = scoreNetworkingPair(first, second);

    assert.ok(match);
    assert.equal(match.direction, "a_to_b");
    assert.deepEqual(match.evidence.policy_checks, [
      "tenant_relationship_rules",
      "contact_do_not_refer_for",
    ]);
  });

  test("enforces supported tenant relationship exclusions before ranking", () => {
    const first = contact("first", "First", {
      company_name: "Acme",
      current_asks: "Needs operations advice.",
    });
    const second = contact("second", "Second", {
      company_name: "Acme",
      services_offered: ["Operations consulting"],
    });

    assert.equal(
      scoreNetworkingPair(first, second, {
        relationshipRules: "Never introduce colleagues at the same company.",
      }),
      null,
    );
    assert.equal(
      scoreNetworkingPair(first, second, {
        relationshipRules: "Do not make operations referrals.",
      }),
      null,
    );
    assert.equal(
      scoreNetworkingPair(first, second, {
        relationshipRules: "Only introduce people after a private review.",
      }),
      null,
    );
  });

  test("uses explicit evidence signals rather than equating score with confidence", () => {
    const match = scoreNetworkingPair(
      contact("first", "First", { current_asks: "Needs operations advice." }),
      contact("second", "Second", { services_offered: ["Operations consulting"] }),
    );

    assert.ok(match);
    assert.notEqual(match.confidence, match.score / 100);
    assert.ok(match.confidence < 0.9);
    assert.equal(match.evidence.version, "network_fit_v3");
    assert.match(match.evidence.confidence_basis[0], /explicit need\/offer signal/);
  });

  test("spreads a batch across contacts before repeating one", () => {
    const a = contact("a", "A");
    const b = contact("b", "B");
    const c = contact("c", "C");
    const d = contact("d", "D");
    const e = contact("e", "E");
    const matches = [
      scoreNetworkingPair(
        { ...a, current_asks: "Needs operations advice" },
        { ...b, services_offered: ["Operations advice"] },
      ),
      scoreNetworkingPair(
        { ...a, current_asks: "Needs marketing strategy" },
        { ...c, services_offered: ["Marketing strategy"] },
      ),
      scoreNetworkingPair(
        { ...d, current_asks: "Needs software automation" },
        { ...e, services_offered: ["Software automation"] },
      ),
    ];

    const selected = selectDiverseMatches(
      matches.filter((match) => match !== null),
      3,
    );

    const firstPair = new Set([
      selected[0].contactA.id,
      selected[0].contactB.id,
    ]);
    assert.equal(
      firstPair.has(selected[1].contactA.id) ||
        firstPair.has(selected[1].contactB.id),
      false,
    );
    assert.equal(selected.length, 3);
  });

  test("honors a per-contact ceiling", () => {
    const a = contact("a", "A", { current_asks: "Needs operations advice" });
    const matches = [
      scoreNetworkingPair(
        a,
        contact("b", "B", { services_offered: ["Operations"] }),
      ),
      scoreNetworkingPair(
        a,
        contact("c", "C", { services_offered: ["Operations"] }),
      ),
    ].filter((match) => match !== null);

    const selected = selectDiverseMatches(matches, 2, 1);

    assert.equal(selected.length, 1);
  });

  test("treats a sourced, named introduction commitment as its own strongest lane", () => {
    const match = scoreNetworkingPair(
      contact("bond", "Bond Aster", {
        evidence_signals: [{
          source_kind: "conversation",
          source_ref: "interactions:call-1",
          role: "explicit_introduction",
          text: "Alex owes an intro to Morgan about exit planning.",
          observed_at: "2026-09-29T15:00:00Z",
        }],
      }),
      contact("morgan", "Morgan El-Asfahani"),
    );

    assert.ok(match);
    assert.equal(match.evidence.match_type, "explicit_introduction");
    assert.equal(match.score, 98);
    assert.equal(match.evidence.claims[0].source_ref, "interactions:call-1");
  });

  test("uses conversation needs and captured public content to create a candidate", () => {
    const match = scoreNetworkingPair(
      contact("founder", "Founder", {
        evidence_signals: [{
          source_kind: "conversation",
          source_ref: "interactions:call-2",
          role: "need",
          text: "She is looking for manufacturing partnerships and sales help.",
        }],
      }),
      contact("operator", "Operator", {
        evidence_signals: [{
          source_kind: "content",
          source_ref: "https://example.com/manufacturing",
          role: "offer",
          text: "We help manufacturing businesses build sales partnerships.",
        }],
      }),
    );

    assert.ok(match);
    assert.ok(match.matchedTerms.includes("manufacturing"));
    assert.deepEqual(
      new Set(match.evidence.claims.map((claim) => claim.source_kind)),
      new Set(["conversation", "content"]),
    );
  });

  test("caps podcasts at one fifth of a five-item recommendation portfolio", () => {
    const podcastMatches = Array.from({ length: 5 }, (_, index) =>
      scoreNetworkingPair(
        contact(`guest-${index}`, `Guest ${index}`, {
          current_asks: "Looking for podcast appearances about leadership and scaling teams.",
        }),
        contact(`host-${index}`, `Host ${index}`, {
          one_line_summary: "Hosts a podcast about leadership and scaling teams.",
          podcast_url: `https://example.com/podcast-${index}`,
        }),
      ),
    );
    const otherMatches = Array.from({ length: 5 }, (_, index) =>
      scoreNetworkingPair(
        contact(`buyer-${index}`, `Buyer ${index}`, {
          wants_help_with: "Manufacturing sales partnerships.",
        }),
        contact(`seller-${index}`, `Seller ${index}`, {
          services_offered: ["Manufacturing sales partnerships"],
        }),
      ),
    );
    const portfolio = selectRecommendationPortfolio(
      [...podcastMatches, ...otherMatches].filter((match) => match !== null),
      5,
    );

    assert.equal(portfolio.length, 5);
    assert.equal(
      portfolio.filter((match) => match.evidence.match_type === "podcast").length,
      1,
    );
  });
});
