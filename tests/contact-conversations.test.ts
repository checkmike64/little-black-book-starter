import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildContactConversations } from "../lib/contact-detail/conversations.js";

describe("contact conversation history", () => {
  test("links transcript summaries, extracted promises, actions, and provenance", () => {
    const conversations = buildContactConversations({
      interactions: [
        {
          id: "interaction-1",
          occurred_at: "2026-08-20T15:00:00Z",
          interaction_type: "call",
          title: "Product roundtable",
          summary: "Reviewed the relationship product with five attendees.",
          source: "call_transcript",
          source_ref: "recording-1",
          metadata: {
            topics: ["relationship product", "launch"],
            key_takeaways: ["Several attendees asked for a demo."],
          },
        },
      ],
      transcripts: [
        {
          id: "transcript-1",
          interaction_id: "interaction-1",
          title: "Roundtable transcript",
          source: "fathom",
          source_ref: "recording-1",
          distilled_summary: "Five people requested a Loom walkthrough.",
          metadata: { action_items: ["Send the Black Book demo"] },
          created_at: "2026-08-20T16:00:00Z",
        },
      ],
      promises: [
        {
          id: "promise-1",
          interaction_id: "interaction-1",
          promise_text: "Send the Loom walkthrough",
          direction: "owner_owes_contact",
          status: "open",
          due_on: "2026-08-22",
          source: "call_transcript",
          evidence: { quote: "I'll send it over." },
        },
      ],
      actions: [
        {
          id: "action-1",
          title: "Record Black Book demo",
          action_type: "follow_up",
          status: "open",
          due_on: "2026-08-22",
          notes: "Use the latest build.",
          source: "claude",
          metadata: { interaction_id: "interaction-1" },
        },
      ],
    });

    assert.equal(conversations.length, 1);
    assert.equal(conversations[0].transcripts.length, 1);
    assert.equal(conversations[0].promises.length, 1);
    assert.equal(conversations[0].actions.length, 1);
    assert.ok(conversations[0].topics.includes("relationship product"));
    assert.ok(conversations[0].storedInterpretation.includes("Send the Black Book demo"));
    assert.ok(conversations[0].provenance.some((row) => row.includes("fathom")));
    assert.ok(conversations[0].provenance.some((row) => row.includes("call transcript")));
  });

  test("does not invent interpretation when only a source summary exists", () => {
    const conversations = buildContactConversations({
      actions: [],
      promises: [],
      transcripts: [],
      interactions: [
        {
          id: "interaction-2",
          occurred_at: "2026-08-19T12:00:00Z",
          interaction_type: "email",
          title: "Email thread",
          summary: "Shared a scheduling update.",
          source: "google_gmail",
          source_ref: "thread-1",
          metadata: {},
        },
      ],
    });

    assert.deepEqual(conversations[0].storedInterpretation, []);
    assert.deepEqual(conversations[0].promises, []);
    assert.deepEqual(conversations[0].actions, []);
    assert.ok(conversations[0].provenance.includes("Interaction source: google gmail"));
  });
});
