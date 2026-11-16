import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  parseRelationshipActionCreateForm,
  parseRelationshipActionMovementUpdateForm,
  parseRelationshipActionStatusForm,
  relationshipActionCompletedAt,
  relationshipActionNotesWithStatusNote,
  relationshipActionStatusNeedsNote,
} from "../lib/relationship-action-validation.js";

const contactId = "11111111-1111-4111-8111-111111111111";
const actionId = "22222222-2222-4222-8222-222222222222";

describe("relationship action validation", () => {
  test("normalizes create input and rejects malformed choices", () => {
    const formData = new FormData();
    formData.set("contact_id", contactId);
    formData.set("title", "  Send intro recap  ");
    formData.set("action_type", "delete_everything");
    formData.set("priority", "urgent");
    formData.set("due_on", "tomorrow");
    formData.set("notes", "  Confirm next step with Claude first.  ");

    assert.deepEqual(parseRelationshipActionCreateForm(formData), {
      contactId,
      contactIdValid: true,
      title: "Send intro recap",
      titleValid: true,
      actionType: "follow_up",
      priority: "normal",
      dueOn: null,
      evidenceSummary: null,
      notes: "Confirm next step with Claude first.",
      source: "contact_profile",
      sourceRef: null,
    });
  });

  test("preserves supported create choices and valid dates", () => {
    const formData = new FormData();
    formData.set("contact_id", contactId);
    formData.set("title", "Book podcast prep");
    formData.set("action_type", "podcast");
    formData.set("priority", "high");
    formData.set("due_on", "2026-08-01");
    formData.set("evidence_summary", "Podcast lane has useful context.");
    formData.set("source", "scoreboard");
    formData.set("source_ref", "scoreboard:podcast-lane");

    const parsed = parseRelationshipActionCreateForm(formData);

    assert.equal(parsed.actionType, "podcast");
    assert.equal(parsed.priority, "high");
    assert.equal(parsed.dueOn, "2026-08-01");
    assert.equal(parsed.evidenceSummary, "Podcast lane has useful context.");
    assert.equal(parsed.source, "scoreboard");
    assert.equal(parsed.sourceRef, "scoreboard:podcast-lane");
  });

  test("flags missing title and invalid contact id before database writes", () => {
    const formData = new FormData();
    formData.set("contact_id", "not-a-contact");
    formData.set("title", "   ");

    const parsed = parseRelationshipActionCreateForm(formData);

    assert.equal(parsed.contactIdValid, false);
    assert.equal(parsed.titleValid, false);
  });

  test("normalizes status updates and marks terminal statuses", () => {
    const formData = new FormData();
    formData.set("contact_id", contactId);
    formData.set("action_id", actionId);
    formData.set("status", "done");

    assert.deepEqual(parseRelationshipActionStatusForm(formData), {
      actionId,
      actionIdValid: true,
      contactId,
      contactIdValid: true,
      status: "done",
      statusNote: null,
      completedAtRequired: true,
    });
  });

  test("falls back invalid statuses to open", () => {
    const formData = new FormData();
    formData.set("contact_id", contactId);
    formData.set("action_id", actionId);
    formData.set("status", "archived");

    const parsed = parseRelationshipActionStatusForm(formData);

    assert.equal(parsed.status, "open");
    assert.equal(parsed.statusNote, null);
    assert.equal(parsed.completedAtRequired, false);
  });

  test("normalizes movement queue updates", () => {
    const formData = new FormData();
    formData.set("action_id", actionId);
    formData.set("status", "deferred");
    formData.set("priority", "high");
    formData.set("due_on", "2026-08-15");

    assert.deepEqual(parseRelationshipActionMovementUpdateForm(formData), {
      actionId,
      actionIdValid: true,
      status: "deferred",
      priority: "high",
      dueOn: "2026-08-15",
      statusNote: null,
      completedAtRequired: false,
    });
  });

  test("sanitizes malformed movement queue updates", () => {
    const formData = new FormData();
    formData.set("action_id", "not-an-action");
    formData.set("status", "archived");
    formData.set("priority", "urgent");
    formData.set("due_on", "next week");

    const parsed = parseRelationshipActionMovementUpdateForm(formData);

    assert.equal(parsed.actionIdValid, false);
    assert.equal(parsed.status, "open");
    assert.equal(parsed.priority, "normal");
    assert.equal(parsed.dueOn, null);
    assert.equal(parsed.statusNote, null);
  });

  test("sets completion time only when entering a terminal status", () => {
    assert.equal(
      relationshipActionCompletedAt({
        previousStatus: "open",
        nextStatus: "done",
        previousCompletedAt: null,
        now: "2026-07-21T10:00:00.000Z",
      }),
      "2026-07-21T10:00:00.000Z",
    );
  });

  test("preserves completion history when editing an already terminal action", () => {
    assert.equal(
      relationshipActionCompletedAt({
        previousStatus: "done",
        nextStatus: "skipped",
        previousCompletedAt: "2026-07-10T10:00:00.000Z",
        now: "2026-07-21T10:00:00.000Z",
      }),
      "2026-07-10T10:00:00.000Z",
    );
  });

  test("clears completion time when reopening relationship action work", () => {
    assert.equal(
      relationshipActionCompletedAt({
        previousStatus: "done",
        nextStatus: "open",
        previousCompletedAt: "2026-07-10T10:00:00.000Z",
        now: "2026-07-21T10:00:00.000Z",
      }),
      null,
    );
  });

  test("requires reasons only for deferred and skipped actions", () => {
    assert.equal(relationshipActionStatusNeedsNote("done"), false);
    assert.equal(relationshipActionStatusNeedsNote("open"), false);
    assert.equal(relationshipActionStatusNeedsNote("deferred"), true);
    assert.equal(relationshipActionStatusNeedsNote("skipped"), true);
  });

  test("appends status reasons without losing existing notes", () => {
    assert.equal(
      relationshipActionNotesWithStatusNote({
        existingNotes: "Original context.",
        nextStatus: "skipped",
        now: "2026-07-22T10:00:00.000Z",
        statusNote: "Not relevant anymore.",
      }),
      "Original context.\n[2026-07-22] skipped: Not relevant anymore.",
    );
  });

  test("does not append status notes for non-review statuses", () => {
    assert.equal(
      relationshipActionNotesWithStatusNote({
        existingNotes: "Original context.",
        nextStatus: "done",
        now: "2026-07-22T10:00:00.000Z",
        statusNote: "Finished cleanly.",
      }),
      "Original context.",
    );
  });
});
