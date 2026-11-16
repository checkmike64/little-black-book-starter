import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  followupInferenceLabel,
  inferRecordingFollowup,
  meetingContactIdsForInference,
  oneToOneMatchedContactIds,
} from "../lib/recordings/followup-inference.js";

const casey = {
  id: "320b1ef7-56c0-42a5-9bc7-691b8624ecb2",
  full_name: "Casey Sample",
  email: "casey@example.com",
};
const jamie = {
  id: "85e5ff4d-d1e1-40fa-bf8d-30adf2c19407",
  full_name: "Jamie Sample",
  email: "jamie@example.com",
};

function infer(overrides: Partial<Parameters<typeof inferRecordingFollowup>[0]> = {}) {
  return inferRecordingFollowup({
    followupText: "Alex Example to send the sales page to Casey",
    assignee: null,
    assigneeEmail: null,
    ownerAssigned: false,
    ownerEmail: "alex@example.com",
    meetingContactIds: [casey.id],
    contacts: [casey, jamie],
    ...overrides,
  });
}

describe("recording follow-up inference", () => {
  test("attaches the unique meeting contact and recognizes the owner by name", () => {
    const result = infer();
    assert.equal(result.contactId, casey.id);
    assert.equal(result.classification, "owner_promise");
    assert.equal(result.needsInput, false);
    assert.equal(followupInferenceLabel(result), "You promised Casey Sample");
  });

  test("uses exact provider assignee identity before text inference", () => {
    const result = infer({
      followupText: "Send the useful recap",
      assignee: "Casey Sample",
      assigneeEmail: "CASEY@example.com",
    });
    assert.equal(result.contactId, casey.id);
    assert.equal(result.classification, "contact_promise");
    assert.equal(result.confidence, "high");
  });

  test("requires a unique email match before trusting provider identity", () => {
    const result = infer({
      followupText: "Send the useful recap",
      assignee: null,
      assigneeEmail: "shared@example.com",
      meetingContactIds: [],
      contacts: [
        { ...casey, email: "shared@example.com" },
        { ...jamie, email: "shared@example.com" },
      ],
    });
    assert.equal(result.needsInput, true);
  });

  test("does not let a name override a duplicate provider email", () => {
    const result = infer({
      followupText: "Send the useful recap",
      assignee: "Casey Sample",
      assigneeEmail: "shared@example.com",
      meetingContactIds: [],
      contacts: [
        { ...casey, email: "shared@example.com" },
        { ...jamie, email: "shared@example.com" },
      ],
    });
    assert.equal(result.needsInput, true);
    assert.equal(result.contactId, null);
  });

  test("recognizes a named meeting contact as the actor", () => {
    const result = infer({ followupText: "Casey will send the introduction" });
    assert.equal(result.classification, "contact_promise");
    assert.equal(followupInferenceLabel(result), "Casey Sample promised you");
  });

  test("keeps the person but openly asks for direction on an ambiguous one-to-one promise", () => {
    const result = infer({ followupText: "Send the deck" });
    assert.equal(result.classification, "action");
    assert.equal(result.contactId, casey.id);
    assert.equal(result.contactName, "Casey Sample");
    assert.equal(result.needsInput, true);
    assert.equal(followupInferenceLabel(result), "Choose who is responsible");
  });

  test("prefers a uniquely named Book contact over the meeting attendee", () => {
    const result = infer({
      followupText: "Alex Example to send a demo video to Jamie Sample",
    });
    assert.equal(result.classification, "owner_promise");
    assert.equal(result.contactId, jamie.id);
    assert.equal(followupInferenceLabel(result), "You promised Jamie Sample");
  });

  test("requires input for a group or incomplete contact set without exact evidence", () => {
    const group = infer({
      followupText: "Review the next version",
      meetingContactIds: [casey.id, jamie.id],
    });
    assert.equal(group.needsInput, true);

    const incomplete = infer({
      followupText: "Review the next version",
      meetingContactIds: [],
      contactsIncomplete: true,
    });
    assert.equal(incomplete.needsInput, true);
    assert.equal(followupInferenceLabel(incomplete), "Needs your input");
  });

  test("proves one-to-one identity from the complete attendee set", () => {
    assert.deepEqual(oneToOneMatchedContactIds([
      { normalizedEmail: "alex@example.com", matchedContactId: null },
      { normalizedEmail: "casey@example.com", matchedContactId: casey.id },
    ], true, "alex@example.com"), [casey.id]);
    assert.deepEqual(oneToOneMatchedContactIds([
      { normalizedEmail: "casey@example.com", matchedContactId: casey.id },
    ], true, "alex@example.com"), [casey.id]);
    assert.deepEqual(oneToOneMatchedContactIds([
      { normalizedEmail: "casey@example.com", matchedContactId: casey.id },
      { normalizedEmail: "guest@example.com", matchedContactId: null },
    ], true, "alex@example.com"), []);
    assert.deepEqual(oneToOneMatchedContactIds([
      { normalizedEmail: "casey@example.com", matchedContactId: casey.id },
    ], false, "alex@example.com"), []);
    assert.deepEqual(oneToOneMatchedContactIds([
      { normalizedEmail: "casey@example.com", matchedContactId: casey.id },
    ], true, null), []);
  });

  test("chooses inference contacts from the safest available identity source", () => {
    assert.deepEqual(meetingContactIdsForInference({
      calendarAttendees: null,
      calendarAttendeesComplete: true,
      ownerEmail: "alex@example.com",
      validatedConfirmedContactIds: [casey.id],
    }), [casey.id]);

    assert.deepEqual(meetingContactIdsForInference({
      calendarAttendees: [
        { normalizedEmail: "alex@example.com", matchedContactId: null },
        { normalizedEmail: "casey@example.com", matchedContactId: casey.id },
      ],
      calendarAttendeesComplete: true,
      ownerEmail: "alex@example.com",
      validatedConfirmedContactIds: [],
    }), [casey.id]);

    assert.deepEqual(meetingContactIdsForInference({
      calendarAttendees: [
        { normalizedEmail: "alex@example.com", matchedContactId: null },
        { normalizedEmail: "casey@example.com", matchedContactId: casey.id },
        { normalizedEmail: "ignored@example.com", matchedContactId: null },
      ],
      calendarAttendeesComplete: true,
      ownerEmail: "alex@example.com",
      validatedConfirmedContactIds: [casey.id],
    }), []);

    assert.deepEqual(meetingContactIdsForInference({
      calendarAttendees: [
        { normalizedEmail: "casey@example.com", matchedContactId: casey.id },
        { normalizedEmail: "jamie@example.com", matchedContactId: jamie.id },
      ],
      calendarAttendeesComplete: true,
      ownerEmail: "alex@example.com",
      validatedConfirmedContactIds: [casey.id],
    }), []);

    assert.deepEqual(meetingContactIdsForInference({
      calendarAttendees: [
        { normalizedEmail: "alex@example.com", matchedContactId: null },
        { normalizedEmail: "casey@example.com", matchedContactId: casey.id },
      ],
      calendarAttendeesComplete: false,
      ownerEmail: "alex@example.com",
      validatedConfirmedContactIds: [casey.id],
    }), []);
  });
});
