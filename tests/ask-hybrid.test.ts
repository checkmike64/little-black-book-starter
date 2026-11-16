import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLoadedEvidenceRetrievalSources,
  hybridRetrieveAsk,
  type AskEvidenceDocument,
  type AskRetrievalSource,
} from "../lib/ask/hybrid.js";

const loomEvidence: AskEvidenceDocument = {
  id: "promise-1",
  type: "promise",
  contactId: "contact-1",
  title: "Follow up with Ava",
  text: "Ava asked Alex to send a Loom about the Little Black Book.",
  occurredAt: "2026-08-20T12:00:00.000Z",
};

function source(
  channel: AskRetrievalSource["channel"],
  score: number,
  document = loomEvidence,
): AskRetrievalSource {
  return {
    channel,
    async search() {
      return [{ document, score, channel, explanation: `${channel} match` }];
    },
  };
}

describe("hybrid Ask retrieval", () => {
  it("fuses exact, full-text, and semantic evidence by stable document ID", async () => {
    const result = await hybridRetrieveAsk(
      "Who do I owe a Loom about the Black Book?",
      [source("exact", 0.85), source("full_text", 0.8), source("semantic", 0.78)],
    );
    assert.equal(result.status, "answerable");
    assert.equal(result.hits.length, 1);
    assert.deepEqual(result.hits[0].channels.sort(), ["exact", "full_text", "semantic"]);
    assert.equal(result.hits[0].contactId, "contact-1");
  });

  it("abstains when semantic similarity is weak or uncorroborated", async () => {
    const weak = await hybridRetrieveAsk("Who needs a video?", [
      source("semantic", 0.4),
    ]);
    assert.equal(weak.status, "abstain");
    assert.equal(weak.reason, "insufficient_evidence");

    const lone = await hybridRetrieveAsk("Who needs a video?", [
      source("semantic", 0.75),
    ]);
    assert.equal(lone.status, "abstain");
    assert.ok(["insufficient_evidence", "uncorroborated_evidence"].includes(lone.reason ?? ""));
  });

  it("continues when one retrieval channel is unavailable", async () => {
    const failed: AskRetrievalSource = {
      channel: "semantic",
      async search() {
        throw new Error("embedding provider unavailable");
      },
    };
    const result = await hybridRetrieveAsk("Ava Loom", [
      failed,
      source("exact", 0.95),
    ]);
    assert.equal(result.status, "answerable");
    assert.equal(result.hits[0].id, "promise-1");
  });

  it("uses the production loaded-evidence adapter for interpretive obligation queries", async () => {
    const result = await hybridRetrieveAsk(
      "Who do I owe a Loom video about the Black Book to?",
      buildLoadedEvidenceRetrievalSources([loomEvidence]),
    );
    assert.equal(result.status, "answerable");
    assert.equal(result.hits[0].contactId, "contact-1");
    assert.ok(result.hits[0].channels.includes("exact"));
    assert.ok(result.hits[0].channels.includes("full_text"));
    assert.ok(result.hits[0].channels.includes("semantic"));
  });

  it("retrieves natural paraphrases through the production semantic channel", async () => {
    for (const query of [
      "Who is waiting for the product tour I agreed to make?",
      "Which person is expecting the relationship software walkthrough I said I would record?",
    ]) {
      const result = await hybridRetrieveAsk(
        query,
        buildLoadedEvidenceRetrievalSources([loomEvidence]),
      );
      assert.equal(result.status, "answerable", query);
      assert.ok(result.hits[0].channels.includes("semantic"), query);
    }
  });

  it("keeps the requested deliverable attached to the obligation", async () => {
    const spreadsheetEvidence: AskEvidenceDocument = {
      id: "promise-spreadsheet",
      type: "promise",
      contactId: "contact-bob",
      title: "Follow up with Bob",
      text: "Bob asked Alex to send the investor spreadsheet.",
    };
    const falseMatch = await hybridRetrieveAsk(
      "Who is expecting me to show them how the Book works?",
      buildLoadedEvidenceRetrievalSources([spreadsheetEvidence]),
    );
    assert.equal(falseMatch.status, "abstain");

    const crmTour = await hybridRetrieveAsk(
      "Who did I commit to giving a tour of my CRM?",
      buildLoadedEvidenceRetrievalSources([loomEvidence]),
    );
    assert.equal(crmTour.status, "answerable");
    assert.equal(crmTour.hits[0]?.contactId, "contact-1");
  });

  it("does not treat two unrelated semantic hits as corroboration", async () => {
    const unrelated: AskEvidenceDocument = {
      ...loomEvidence,
      id: "unrelated-2",
      contactId: "contact-2",
      text: "A different person discussed a general marketing video.",
    };
    const result = await hybridRetrieveAsk("Who needs a video?", [
      source("semantic", 0.9),
      source("semantic", 0.89, unrelated),
    ]);
    assert.equal(result.status, "abstain");
    assert.equal(result.reason, "uncorroborated_evidence");
  });
});
