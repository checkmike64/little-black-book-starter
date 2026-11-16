import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  engagementRelationshipFit,
  fallbackRelationshipRationale,
  wantToKnowEngagementFit,
} from "../lib/engagement/relevance.js";

const context = {
  relationship_type: ["Referral Partner"],
  trust_level: "Tier 1",
  why_stay_in_touch: "Build a steady M&A referral relationship.",
  current_asks: "Introductions to independent business owners considering an exit.",
  wants_help_with: "Finding qualified acquisition targets.",
  what_they_want_more_of: null,
  ideal_referral: "Founder preparing to sell a profitable company.",
  services_offered: ["M&A advisory"],
  could_refer_me_for: ["Growth strategy"],
  top_3_tags: ["Acquisitions", "Founders"],
  keywords: ["M&A", "Exit planning"],
};

describe("engagement relationship relevance", () => {
  test("rejects generic support language with no relationship fit", () => {
    const fit = engagementRelationshipFit({
      content: "A personal reflection on making time for the weekend.",
      relevance: "A timely, low-friction opportunity to support Jamie.",
      classification: "CONTINUITY",
      context,
    });

    assert.equal(fit.eligible, false);
  });

  test("does not turn narrative relationship history into strategic relevance", () => {
    const fit = engagementRelationshipFit({
      content: "I have been learning to sit with uncertainty and stop controlling every outcome.",
      relevance: null,
      classification: null,
      context: {
        ...context,
        why_stay_in_touch:
          "A trusted friend who has shared personal conversations about uncertainty and outcomes.",
        current_asks: null,
        wants_help_with: null,
        ideal_referral: null,
        services_offered: null,
        could_refer_me_for: null,
        top_3_tags: null,
        keywords: null,
      },
    });

    assert.equal(fit.eligible, false);
  });

  test("accepts content that connects directly to captured goals", () => {
    const fit = engagementRelationshipFit({
      content: "Three exit planning mistakes founders make before selling a company.",
      relevance: "Useful perspective for your shared work with founders preparing for an exit.",
      classification: "STRUCTURAL",
      context,
    });

    assert.equal(fit.eligible, true);
    assert.ok(fit.matchedTerms.includes("founder"));
    assert.ok(fit.score >= 20);
  });

  test("leads the rationale with structured relationship themes", () => {
    const input = {
      content:
        "Scaling an unsystematized service business creates operational chaos. Document the workflows before adding fuel.",
      relevance: null,
      classification: "CONTINUITY",
      context: {
        ...context,
        wants_help_with:
          "Alex was asked to help because most of the business comes through introductions.",
        ideal_referral: "Owner-led service businesses that need stronger operations.",
        top_3_tags: ["Coaching", "Connector", "Operations"],
        keywords: ["B2B", "AI", "Automation"],
      },
    };
    const fit = engagementRelationshipFit(input);

    assert.equal(fit.eligible, true);
    assert.equal(fit.matchedTerms[0], "operations");
    assert.doesNotMatch(fallbackRelationshipRationale(input) ?? "", /comes|doesn|that/);
    assert.match(fallbackRelationshipRationale(input) ?? "", /^Relevant to your shared context:/);
  });

  test("keeps unusually strong posts from high-priority relationships", () => {
    const fit = engagementRelationshipFit({
      content: "A major company milestone.",
      relevance: null,
      classification: "CONTINUITY",
      metrics: { likes: 240, comments: 35 },
      context,
    });

    assert.equal(fit.eligible, true);
    assert.equal(fit.exceptionalResponse, true);
    assert.match(
      fallbackRelationshipRationale({
        content: "A major company milestone.",
        relevance: null,
        classification: "CONTINUITY",
        metrics: { likes: 240, comments: 35 },
        context,
      }) ?? "",
      /unusual attention/,
    );
  });

  test("captures concrete milestones even without keyword overlap", () => {
    const moments = [
      "We are hiring two client success leaders to join our team.",
      "Proud to announce that we launched our new product today.",
      "I joined the Founder Stories podcast as this week's guest.",
      "Company news: our team opened a new market in Mexico.",
    ];

    for (const content of moments) {
      const fit = engagementRelationshipFit({
        content,
        relevance: null,
        classification: "CONTINUITY",
        context: null,
      });
      assert.equal(fit.eligible, true, content);
      assert.equal(fit.meaningfulMoment, true, content);
    }
  });

  test("captures concrete opportunities to help or make an introduction", () => {
    const input = {
      content:
        "We are looking for a recommendation for an operator who can help us improve our sales pipeline.",
      relevance: null,
      classification: "CONTINUITY",
      context: null,
    };
    const fit = engagementRelationshipFit(input);

    assert.equal(fit.eligible, true);
    assert.equal(fit.helpOpportunity, true);
    assert.match(
      fallbackRelationshipRationale(input) ?? "",
      /useful offer, recommendation, or introduction/,
    );
  });

  test("still rejects generic thought leadership with no usable angle", () => {
    const fit = engagementRelationshipFit({
      content:
        "Consistency matters. Keep showing up every day and trust the process.",
      relevance: null,
      classification: "CONTINUITY",
      context: null,
    });

    assert.equal(fit.eligible, false);
    assert.equal(fit.meaningfulMoment, false);
    assert.equal(fit.helpOpportunity, false);
  });

  test("keeps podcast outreach tied to episodes and show milestones", () => {
    const context = {
      bucket: "Podcast hosts",
      lane: "podcast",
      engagement_focus: "Growth and acquisition stories",
    };
    assert.equal(wantToKnowEngagementFit({
      content: "Our latest episode with a founder is live today.",
      relevance: null,
      classification: "CONTINUITY",
      context,
    }).eligible, true);
    assert.equal(wantToKnowEngagementFit({
      content: "Consistency is everything. Keep going.",
      relevance: null,
      classification: "CONTINUITY",
      context,
    }).eligible, false);
  });

  test("keeps referral outreach tied to useful updates and celebrations", () => {
    const context = {
      bucket: "Referral partners",
      lane: "referral",
      engagement_focus: "Owner-led service firms and acquisitions",
    };
    assert.equal(wantToKnowEngagementFit({
      content: "We launched a new service for owner-led companies today.",
      relevance: null,
      classification: "MILESTONE",
      context,
    }).eligible, true);
    assert.equal(wantToKnowEngagementFit({
      content: "A quiet weekend and a good book.",
      relevance: null,
      classification: "CONTINUITY",
      context,
    }).eligible, false);
  });
});
