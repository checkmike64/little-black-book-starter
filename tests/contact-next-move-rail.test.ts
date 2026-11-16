import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildContactNextMoveRail,
  type ContactNextMoveBrief,
} from "../lib/contact-next-move-rail.js";

function brief(overrides: Partial<ContactNextMoveBrief> = {}): ContactNextMoveBrief {
  return {
    askHref: "/ask?mode=search&q=Alicia",
    bestMove: "Look for a high-trust introduction lane.",
    guardrails: ["Verify referral safety before asking."],
    status: "Watch",
    ...overrides,
  };
}

describe("contact next move rail", () => {
  test("works an existing tracked move before creating another one", () => {
    const rail = buildContactNextMoveRail({
      contactId: "contact-1",
      contactName: "Alicia Stone",
      contactRisk: "No urgent risk",
      contactValue: "High-value relationship",
      executiveBrief: brief(),
      proofState: "Good proof coverage",
      trackedAction: {
        action_type: "follow_up",
        due_on: "2026-07-25",
        id: "action-1",
        priority: "high",
        status: "open",
        title: "Send Alicia the deck",
      },
    });

    assert.equal(rail.mode, "work_tracked");
    assert.equal(rail.headline, "Send Alicia the deck");
    assert.equal(rail.saveMove, null);
    assert.equal(rail.pressureTestHref, "/ask?mode=search&q=Alicia");
  });

  test("turns an unsaved recommended move into a default capture payload", () => {
    const rail = buildContactNextMoveRail({
      contactId: "contact-1",
      contactName: "Alicia Stone",
      contactRisk: "Needs owner judgment",
      contactValue: "High-value relationship",
      executiveBrief: brief({
        bestMove: "Verify trust, relationship strength, and referral safety.",
        status: "Verify",
      }),
      proofState: "Thin proof coverage",
      trackedAction: null,
    });

    assert.equal(rail.mode, "save_suggested");
    assert.equal(rail.saveMove?.defaultType, "owner_verification");
    assert.equal(rail.saveMove?.defaultPriority, "high");
    assert.equal(rail.saveMove?.source, "contact_next_move_rail");
    assert.match(rail.saveMove?.evidenceSummary ?? "", /Needs owner judgment/);
  });

  test("infers rewarm and referral move types without hard-coding one prospecting use case", () => {
    assert.equal(
      buildContactNextMoveRail({
        contactId: "contact-1",
        contactName: "Alicia Stone",
        contactRisk: "Stale relationship",
        contactValue: "Relationship to clarify",
        executiveBrief: brief({
          bestMove: "Send a light, specific rewarm touch.",
          status: "Rewarm",
        }),
        proofState: "Some proof coverage",
      }).saveMove?.defaultType,
      "reconnect",
    );

    assert.equal(
      buildContactNextMoveRail({
        contactId: "contact-1",
        contactName: "Alicia Stone",
        contactRisk: "No urgent risk",
        contactValue: "Referral relationship",
        executiveBrief: brief({
          bestMove: "Look for a useful referral lane.",
          status: "Watch",
        }),
        proofState: "Good proof coverage",
      }).saveMove?.defaultType,
      "referral",
    );
  });
});
