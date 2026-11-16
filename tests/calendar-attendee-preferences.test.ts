import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  calendarAttendeeNeedsBookDecision,
  calendarAttendeeEmailIsIgnored,
  exactCalendarPreferenceRowsAreComplete,
  ignoredCalendarAttendeeEmails,
  withCalendarAttendeePreferenceState,
} from "../lib/calendar-attendee-preferences.js";
import { oneToOneMatchedContactIds } from "../lib/recordings/followup-inference.js";

describe("calendar attendee preference suppression", () => {
  test("requires an exact trustworthy count before applying suppression", () => {
    assert.equal(exactCalendarPreferenceRowsAreComplete(2, 2), true);
    assert.equal(exactCalendarPreferenceRowsAreComplete(null, 0), false);
    assert.equal(exactCalendarPreferenceRowsAreComplete(3, 2), false);
    assert.equal(exactCalendarPreferenceRowsAreComplete(1, 2), false);
    assert.equal(exactCalendarPreferenceRowsAreComplete(-1, 0), false);
    assert.equal(exactCalendarPreferenceRowsAreComplete(1.5, 1), false);
  });

  test("suppresses only explicitly ignored attendees with normalized email matching", () => {
    const ignoredEmails = ignoredCalendarAttendeeEmails([
      { normalized_email: " OMIT@Example.com ", decision: "ignore" },
      { normalized_email: "saved@example.com", decision: "book" },
      { normalized_email: "prospect@example.com", decision: "want_to_know" },
    ]);

    assert.equal(calendarAttendeeEmailIsIgnored("omit@example.COM", ignoredEmails), true);
    assert.equal(calendarAttendeeEmailIsIgnored("saved@example.com", ignoredEmails), false);
    const attendees = withCalendarAttendeePreferenceState([
      { id: "ignored", normalized_email: "omit@example.com" },
      { id: "kept", normalized_email: "saved@example.com" },
    ], ignoredEmails);
    assert.deepEqual(attendees, [
      { id: "ignored", normalized_email: "omit@example.com", ignored_by_owner: true },
      { id: "kept", normalized_email: "saved@example.com", ignored_by_owner: false },
    ]);
  });

  test("partitions suppression by each recording owner and fails closed", () => {
    const data = readFileSync("lib/recordings/data.ts", "utf8");
    const preferenceQuery = data.slice(
      data.indexOf("const calendarAttendeePreferencesResult"),
      data.indexOf("const ignoredAttendeeEmails"),
    );

    assert.match(preferenceQuery, /\.from\("calendar_attendee_preferences"\)/);
    assert.match(preferenceQuery, /\.select\("user_id,normalized_email,decision", \{ count: "exact" \}\)/);
    assert.match(preferenceQuery, /\.eq\("tenant_id", context\.tenantId\)/);
    assert.match(preferenceQuery, /\.in\("user_id", recordingOwnerUserIds\)/);
    assert.match(preferenceQuery, /\.eq\("decision", "ignore"\)/);
    assert.match(preferenceQuery, /count: "exact"/);
    assert.match(data, /const ignoredAttendeeEmailsByOwner = new Map/);
    assert.match(data, /preference\.user_id === ownerUserId/);
    assert.match(data, /ignoredAttendeeEmailsByOwner\.get\(attendee\.owner_user_id\)/);
    assert.equal(data.match(/!exactCalendarPreferenceRowsAreComplete/g)?.length, 2);
    assert.match(data, /calendarAttendeesLoadError:[\s\S]*calendarAttendeePreferencesIncomplete/);
  });

  test("does not let one owner's ignore decision suppress another owner's attendee", () => {
    const ignoredByOwner = new Map([
      ["owner-a", ignoredCalendarAttendeeEmails([
        { normalized_email: "shared@example.com", decision: "ignore" },
      ])],
      ["owner-b", ignoredCalendarAttendeeEmails([])],
    ]);

    assert.equal(
      calendarAttendeeEmailIsIgnored(
        "shared@example.com",
        ignoredByOwner.get("owner-a") ?? new Set<string>(),
      ),
      true,
    );
    assert.equal(
      calendarAttendeeEmailIsIgnored(
        "shared@example.com",
        ignoredByOwner.get("owner-b") ?? new Set<string>(),
      ),
      false,
    );
  });

  test("keeps ignored attendees in group cardinality while suppressing their prompt after resync", () => {
    const knownContactId = "320b1ef7-56c0-42a5-9bc7-691b8624ecb2";
    const ignoredEmails = ignoredCalendarAttendeeEmails([
      { normalized_email: "ignored@example.com", decision: "ignore" },
    ]);
    const freshlySyncedAttendees = withCalendarAttendeePreferenceState([
      {
        normalized_email: "known@example.com",
        matched_contact_id: knownContactId,
        matched_want_to_know_id: null,
      },
      {
        normalized_email: "ignored@example.com",
        matched_contact_id: null,
        matched_want_to_know_id: null,
      },
    ], ignoredEmails);

    assert.deepEqual(
      oneToOneMatchedContactIds(
        freshlySyncedAttendees.map((attendee) => ({
          normalizedEmail: attendee.normalized_email,
          matchedContactId: attendee.matched_contact_id,
        })),
        true,
        "owner@example.com",
      ),
      [],
    );
    assert.deepEqual(
      freshlySyncedAttendees.filter(calendarAttendeeNeedsBookDecision),
      [],
    );

    const intake = readFileSync("app/api/claude/calendar/route.ts", "utf8");
    assert.match(intake, /const attendees = \(event\.attendees \?\? \[\]\)/);
    assert.doesNotMatch(intake, /calendarAttendeeEmailIsIgnored/);
    assert.doesNotMatch(intake, /calendar_attendee_preferences[\s\S]*delete/);
  });
});
