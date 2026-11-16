import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  askRunHref,
  buildAskDecisionQueue,
  ownerConfirmedAskActionType,
  recommendAskDecisionAction,
} from "../lib/ask-decision-queue.js";
import { buildAskRunDecision } from "../lib/ask-run-decision.js";

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    mode: "search",
    query: "podcast hosts",
    title: "Search: podcast hosts",
    answer: {
      answer: {
        headline: "Three podcast hosts look warm",
        recommendation: "Ask for two targeted introductions.",
        confidence_label: "usable",
        source_audit: {
          label: "grounded",
        },
      },
    },
    shortlist: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        full_name: "Alicia Harper",
        score: 91,
      },
    ],
    context_hits: [{ title: "Prior email" }],
    created_at: "2026-07-21T12:00:00.000Z",
    ...overrides,
  };
}

describe("Ask decision queue", () => {
  test("turns undecided saved Ask runs into movement-ready queue items", () => {
    const [item] = buildAskDecisionQueue([run()]);

    assert.equal(item.title, "Three podcast hosts look warm");
    assert.equal(item.suggestedContactId, "22222222-2222-4222-8222-222222222222");
    assert.equal(item.suggestedContactName, "Alicia Harper");
    assert.equal(item.suggestedActionType, "podcast");
    assert.equal(item.suggestedPriority, "high");
    assert.match(item.suggestedActionTitle, /Follow up from Ask/);
    assert.match(item.reason, /Confidence: usable/);
  });

  test("filters Ask runs that already have decisions", () => {
    const queue = buildAskDecisionQueue([
      run({
        answer: {
          decision: buildAskRunDecision({
            status: "verified_no_action",
            decidedAt: "2026-07-21T12:00:00.000Z",
          }),
        },
      }),
    ]);

    assert.equal(queue.length, 0);
  });

  test("builds stable deep links back to the saved Ask answer", () => {
    assert.equal(
      askRunHref({ id: "run-1", mode: "referrals", query: "warm intros" }),
      "/ask?run=run-1&mode=referrals&q=warm%20intros",
    );
  });

  test("infers due dates and action shape from Ask answer text", () => {
    const recommendation = recommendAskDecisionAction(
      run({
        mode: "referrals",
        query: "warm intro to buyers",
        title: "Referral ask: warm intro to buyers",
        answer: {
          answer: {
            headline: "Start with Alicia",
            recommendation: "Ask Alicia for a warm introduction tomorrow.",
            nextActions: [
              {
                label: "Request intro",
                detail: "Send the intro ask tomorrow.",
              },
            ],
            confidence_label: "usable",
          },
        },
      }),
      new Date("2026-07-21T12:00:00.000Z"),
    );

    assert.equal(recommendation.actionType, "introduction");
    assert.equal(recommendation.priority, "high");
    assert.equal(recommendation.dueOn, "2026-07-22");
    assert.equal(recommendation.dueLabel, "Tomorrow");
  });

  test("routes thin or ungrounded Ask answers to owner verification", () => {
    const recommendation = recommendAskDecisionAction(
      run({
        query: "is this person safe to refer?",
        answer: {
          answer: {
            headline: "Needs verification",
            recommendation: "Verify the relationship evidence before outreach.",
            confidence_label: "thin",
            source_audit: {
              label: "not grounded",
            },
          },
        },
        shortlist: [],
        context_hits: [],
      }),
    );

    assert.equal(recommendation.actionType, "owner_verification");
    assert.equal(recommendation.priority, "high");
  });

  test("reads the flat answer shape stored by the live Ask workflow", () => {
    const [item] = buildAskDecisionQueue([
      run({
        mode: "referrals",
        query: "referral",
        title: "Start with Anthony",
        answer: {
          headline: "Start with Anthony",
          recommendation:
            "Have Claude prepare a referral map and ask the owner to confirm the warmest path.",
          why: ["Stored referral context"],
        },
        context_hits: [],
      }),
    ]);

    assert.match(item.detail, /confirm the warmest path/);
    assert.equal(item.suggestedActionType, "owner_verification");
    assert.equal(item.suggestedPriority, "high");
    assert.equal(item.needsEvidenceVerification, true);
  });

  test("turns explicit owner intent into the mode-specific next move", () => {
    assert.equal(ownerConfirmedAskActionType("referrals"), "referral");
    assert.equal(ownerConfirmedAskActionType("podcasts"), "podcast");
    assert.equal(ownerConfirmedAskActionType("stale"), "reconnect");
    assert.equal(ownerConfirmedAskActionType("search"), "follow_up");
  });
});
