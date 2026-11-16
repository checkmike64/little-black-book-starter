import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  parseNotionMeetingReference,
  parseRecordingFollowupDecisionForm,
  parseRecordingFollowupRouteForm,
  recordingInboxView,
} from "../lib/recordings/followup-routing.js";

const followupId = "a14f4f34-2411-4d9d-a238-d63b44783f43";
const contactId = "9316457e-b01f-46cc-ac10-14e411c7d274";

function routeForm(route: string) {
  const formData = new FormData();
  formData.set("followup_id", followupId);
  formData.set("route", route);
  return formData;
}

function decisionForm(outcome: string) {
  const formData = new FormData();
  formData.set("followup_id", followupId);
  formData.set("classification", "owner_promise");
  formData.set("outcome", outcome);
  formData.set("contact_id", contactId);
  formData.append("meeting_contact_ids", contactId);
  return formData;
}

describe("recording follow-up action parsing", () => {
  test("parses bounded action routing input", () => {
    const formData = routeForm("action");
    formData.set("contact_id", contactId);
    formData.set("due_on", "2026-09-03");
    formData.set("note", "  Send   the useful recap  ");

    assert.deepEqual(parseRecordingFollowupRouteForm(formData), {
      ok: true,
      value: {
        followupId,
        route: "action",
        contactId,
        dueOn: "2026-09-03",
        note: "Send the useful recap",
      },
    });
  });

  test("requires a Book contact for either promise direction", () => {
    for (const route of ["owner_promise", "contact_promise"]) {
      const parsed = parseRecordingFollowupRouteForm(routeForm(route));
      assert.equal(parsed.ok, false);
      if (!parsed.ok) assert.match(parsed.message, /who this promise is with/i);
    }
  });

  test("rejects unsupported routes and impossible dates", () => {
    assert.equal(parseRecordingFollowupRouteForm(routeForm("promise")).ok, false);
    const formData = routeForm("action");
    formData.set("due_on", "2026-02-31");
    assert.equal(parseRecordingFollowupRouteForm(formData).ok, false);
  });

  test("parses approve, already-done, and decline decisions", () => {
    const approve = decisionForm("approve");
    approve.set("due_on", "2026-09-03");
    assert.deepEqual(parseRecordingFollowupDecisionForm(approve), {
      ok: true,
      value: {
        followupId,
        classification: "owner_promise",
        outcome: "approve",
        contactId,
        meetingContactIds: [contactId],
        dueOn: "2026-09-03",
        note: null,
      },
    });

    const done = decisionForm("already_done");
    done.set("due_on", "2026-09-03");
    const parsedDone = parseRecordingFollowupDecisionForm(done);
    assert.equal(parsedDone.ok, true);
    if (parsedDone.ok) assert.equal(parsedDone.value.dueOn, null);

    const decline = decisionForm("decline");
    const parsedDecline = parseRecordingFollowupDecisionForm(decline);
    assert.equal(parsedDecline.ok, true);
    if (parsedDecline.ok) assert.equal(parsedDecline.value.contactId, null);
  });

  test("requires a person only when approving a promise", () => {
    const approve = decisionForm("approve");
    approve.delete("contact_id");
    const parsedApprove = parseRecordingFollowupDecisionForm(approve);
    assert.equal(parsedApprove.ok, false);
    if (!parsedApprove.ok) assert.match(parsedApprove.message, /who this follow-up is with/i);

    const done = decisionForm("already_done");
    done.delete("contact_id");
    assert.deepEqual(parseRecordingFollowupDecisionForm(done), {
      ok: true,
      value: {
        followupId,
        classification: "owner_promise",
        outcome: "already_done",
        contactId: null,
        meetingContactIds: [contactId],
        dueOn: null,
        note: null,
      },
    });
  });

  test("allows an ambiguous one-to-one item after the owner chooses who is responsible", () => {
    const sendTheDeck = decisionForm("approve");
    sendTheDeck.set("classification", "contact_promise");
    assert.deepEqual(parseRecordingFollowupDecisionForm(sendTheDeck), {
      ok: true,
      value: {
        followupId,
        classification: "contact_promise",
        outcome: "approve",
        contactId,
        meetingContactIds: [contactId],
        dueOn: null,
        note: null,
      },
    });
  });

  test("requires at least one confirmed meeting contact for every item outcome", () => {
    const formData = decisionForm("decline");
    formData.delete("meeting_contact_ids");
    const parsed = parseRecordingFollowupDecisionForm(formData);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.message, /at least one person/i);
  });

  test("accepts a Notion meeting link or raw id and rejects foreign hosts", () => {
    const compact = followupId.replace(/-/g, "");
    assert.equal(parseNotionMeetingReference(followupId), followupId);
    assert.equal(
      parseNotionMeetingReference(`https://www.notion.so/Client-call-${compact}?source=copy_link`),
      followupId,
    );
    assert.equal(
      parseNotionMeetingReference(`https://app.notion.com/p/workspace/Client-call-${compact}?pvs=55`),
      followupId,
    );
    assert.equal(parseNotionMeetingReference(`https://evil.example/${compact}`), null);
    assert.equal(parseNotionMeetingReference(`https://notion.com.evil.example/${compact}`), null);
  });

  test("maps legacy inbox links into the two-state workflow", () => {
    assert.equal(recordingInboxView("review"), "to_process");
    assert.equal(recordingInboxView("followups"), "to_process");
    assert.equal(recordingInboxView("filed"), "processed");
    assert.equal(recordingInboxView("unknown"), "to_process");
  });
});

describe("meeting inbox UI contract", () => {
  test("offers two meeting states and one plain-language decision set", () => {
    const page = readFileSync("app/(portal)/recordings/page.tsx", "utf8");

    assert.match(page, /\["to_process", "To Process"\]/);
    assert.match(page, /\["processed", "Processed"\]/);
    assert.doesNotMatch(page, /\["followups", "Follow-ups"\]/);
    assert.match(page, /value="approve">Approve/);
    assert.match(page, /value="already_done">Already done/);
    assert.match(page, /value="decline">Decline/);
    assert.match(page, /<summary>Change<\/summary>/);
    assert.doesNotMatch(page, /value="action">Action/);
    assert.doesNotMatch(page, /value="owner_promise">I promised/);
    assert.doesNotMatch(page, /value="contact_promise">They promised/);
    assert.match(page, /Proposed items/);
    assert.doesNotMatch(page, /value="confirm">Accurate/);
    assert.doesNotMatch(page, /value="dismiss">Incorrect/);
    assert.doesNotMatch(page, />Finish meeting</);
    assert.match(page, /Owner decision needed/);
    assert.match(page, /choose Not for the Book from Today/);
    assert.match(page, /Open client intake/);
    assert.doesNotMatch(page, /decideCalendarAttendee/);
    assert.ok(
      page.indexOf('className="recording-decision-stack"')
      < page.indexOf('className="recording-notes"'),
    );
    assert.match(page, /#meeting-\$\{recording\.id\}/);
  });

  test("keeps sync and one-meeting recovery on the private recording surface", () => {
    const page = readFileSync("app/(portal)/recordings/page.tsx", "utf8");
    const actions = readFileSync("app/(portal)/recordings/actions.ts", "utf8");

    assert.match(page, /action=\{syncNotionMeetings\}/);
    assert.match(page, /action=\{recoverNotionMeeting\}/);
    assert.match(page, /No audio or video copied/);
    assert.match(actions, /lbb_operator_decide_recording_followup/);
    assert.match(actions, /lbb_operator_confirm_meeting_contacts/);
    assert.match(actions, /p_outcome: parsed\.value\.outcome/);
    assert.match(actions, /Array\.isArray\(value\) \? value\[0\] : value/);
    assert.match(actions, /reconcileNotionArtifactReceipts/);
    assert.match(actions, /artifactId: meetingNoteId/);
    assert.match(actions, /processQueuedRecordingReceipts/);
  });
});
