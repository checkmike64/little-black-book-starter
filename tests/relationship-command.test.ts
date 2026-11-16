import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  cleanRelationshipCommandIntent,
  parseRelationshipCommandJobForm,
  relationshipCommandIntents,
} from "../lib/relationship-command.js";

const contactId = "11111111-1111-4111-8111-111111111111";

describe("relationship command helpers", () => {
  test("normalizes supported and unsupported command intents", () => {
    assert.equal(cleanRelationshipCommandIntent("prep_for_call"), "prep_for_call");
    assert.equal(cleanRelationshipCommandIntent("delete_everything"), "draft_outreach");
  });

  test("parses command job forms with safe text limits", () => {
    const formData = new FormData();
    formData.set("contact_id", contactId);
    formData.set("intent", "verify_referral_lane");
    formData.set("primary_move", "  Pressure test this referral lane.  ");
    formData.set("command_prompt", "Use only authorized Claude context.");
    formData.set("source", "ask_result");

    const parsed = parseRelationshipCommandJobForm(formData);

    assert.equal(parsed.contactId, contactId);
    assert.equal(parsed.contactIdValid, true);
    assert.equal(parsed.intent, "verify_referral_lane");
    assert.equal(parsed.command, relationshipCommandIntents.verify_referral_lane);
    assert.equal(parsed.primaryMove, "Pressure test this referral lane.");
    assert.equal(parsed.commandPrompt, "Use only authorized Claude context.");
    assert.equal(parsed.source, "ask_result");
  });

  test("flags missing contact ids before database writes", () => {
    const formData = new FormData();
    formData.set("contact_id", "not-a-contact");

    const parsed = parseRelationshipCommandJobForm(formData);

    assert.equal(parsed.contactIdValid, false);
    assert.equal(parsed.intent, "draft_outreach");
  });
});
