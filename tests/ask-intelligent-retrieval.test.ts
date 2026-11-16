import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  analyzeAskQuery,
  attributableAskParticipantIds,
  askMatchExplanation,
  isAskEvidenceTypeAllowed,
  isGroundedAskObligationMatch,
  matchAskDocument,
} from "../lib/ask/retrieval.js";

describe("intelligent Ask retrieval", () => {
  test("does not attribute a meeting-level request to every participant", () => {
    assert.deepEqual(attributableAskParticipantIds(["ava"]), ["ava"]);
    assert.deepEqual(attributableAskParticipantIds(["ava", "bob"]), []);
  });
  test("interprets Loom and Black Book language as concepts rather than exact tokens", () => {
    const analysis = analyzeAskQuery(
      "Who do I owe a Loom video about the Black Book to?",
    );

    assert.equal(analysis.intent.ownerObligation, true);
    assert.equal(analysis.intent.requestedDeliverable, true);
    assert.ok(
      analysis.concepts.some((concept) =>
        concept.label.includes("Loom, video, demo, or walkthrough"),
      ),
    );
    assert.ok(
      analysis.concepts.some((concept) =>
        concept.label.includes("Little Black Book product"),
      ),
    );
    assert.doesNotMatch(analysis.coreTerms.join(" "), /\b(who|do|i|about|the|to)\b/);
  });

  test("finds a paraphrased requested demo in conversation evidence", () => {
    const analysis = analyzeAskQuery(
      "Who do I owe a Loom video about the Black Book to?",
    );
    const match = matchAskDocument(
      "Five attendees asked Alex to send a demo walkthrough of the relationship operating system he is building.",
      analysis,
      { requestedByContact: true },
    );

    assert.ok(match.score >= 100);
    assert.ok(match.matchedConcepts.includes("a Loom, video, demo, or walkthrough"));
    assert.ok(match.matchedConcepts.includes("the Little Black Book product"));
    assert.ok(match.matchedConcepts.includes("a request from this person"));
    assert.match(askMatchExplanation(match), /walkthrough/);
  });

  test("ranks a relevant obligation above an unrelated owner promise", () => {
    const analysis = analyzeAskQuery(
      "Who do I owe a Loom video about the Black Book to?",
    );
    const relevant = matchAskDocument(
      "owner owes contact: Send the requested video demo of the Little Black Book relationship app.",
      analysis,
      { ownerOwes: true },
    );
    const unrelated = matchAskDocument(
      "owner owes contact: Send the investor spreadsheet.",
      analysis,
      { ownerOwes: true },
    );

    assert.ok(relevant.score > unrelated.score + 80);
    assert.ok(relevant.matchedConcepts.includes("something you owe this person"));
    assert.ok(!unrelated.matchedConcepts.includes("something you owe this person"));
  });

  test("handles a second natural paraphrase without requiring Loom or Black Book", () => {
    const analysis = analyzeAskQuery(
      "Which people are waiting for a screen recording of the relationship OS?",
    );
    const match = matchAskDocument(
      "Requested a walkthrough demo of the private relationship operating system.",
      analysis,
      { requestedByContact: true },
    );

    assert.ok(match.score >= 80);
    assert.ok(match.matchedConcepts.includes("a Loom, video, demo, or walkthrough"));
    assert.ok(match.matchedConcepts.includes("the Little Black Book product"));
  });

  test("requires an explicit request or owner promise for obligation answers", () => {
    const analysis = analyzeAskQuery(
      "Who do I owe a Loom video about the Black Book to?",
    );
    const genericProfile = matchAskDocument(
      "Podcast guest who published a video about a personal relationship CRM.",
      analysis,
    );
    const observedRequest = matchAskDocument(
      "The attendee asked Alex to send a walkthrough of the relationship operating system.",
      analysis,
      { requestedByContact: true },
    );

    assert.equal(
      isGroundedAskObligationMatch(genericProfile, analysis),
      false,
    );
    assert.equal(
      isGroundedAskObligationMatch(observedRequest, analysis),
      true,
    );
  });

  test("excludes profiles, jobs, and networking edges from obligation evidence", () => {
    const analysis = analyzeAskQuery(
      "Who do I owe a Loom video about the Black Book to?",
    );

    assert.equal(isAskEvidenceTypeAllowed("profile", analysis), false);
    assert.equal(isAskEvidenceTypeAllowed("job", analysis), false);
    assert.equal(isAskEvidenceTypeAllowed("connection", analysis), false);
    assert.equal(isAskEvidenceTypeAllowed("promise", analysis), true);
    assert.equal(isAskEvidenceTypeAllowed("transcript", analysis), true);
  });
});
