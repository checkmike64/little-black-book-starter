import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

describe("meeting-level contact confirmation UI", () => {
  const recordingsPage = readFileSync("app/(portal)/recordings/page.tsx", "utf8");

  test("shows confirmed people passively and asks once only when the meeting is ambiguous", () => {
    assert.match(recordingsPage, /className="recording-meeting-people"/);
    assert.match(recordingsPage, />With<\/span>/);
    assert.match(recordingsPage, /needsMeetingContactChoice \? \(/);
    assert.match(recordingsPage, /"Who was in this meeting\?"/);
    assert.match(recordingsPage, /action=\{confirmRecordingPeople\}/);
    assert.match(recordingsPage, /name="transcript_updated_at" type="hidden" value=\{recording\.updated_at\}/);
    assert.match(recordingsPage, /multiple\s+name="meeting_contact_ids"\s+required/);
    assert.match(recordingsPage, />Save people<\/button>/);
    assert.match(recordingsPage, /recording\.processing_status === "ready"\s*\? validatedConfirmedIds\.length === 0/);
    assert.match(recordingsPage, /const needsPeopleRepair =/);
    assert.match(recordingsPage, /contactOptionsIncomplete \|\| confirmedContactIds\.length === 0/);
    assert.match(recordingsPage, /activeContactIds\.has\(id\)/);
    assert.match(recordingsPage, /const oneClickLiveContact = unambiguousLiveMatchedIds\.length === 1/);
    assert.match(recordingsPage, /\{oneClickLiveContact \? \(/);
    assert.match(recordingsPage, /value=\{oneClickLiveContact\.id\}/);
    assert.match(recordingsPage, /`Save \$\{oneClickLiveContact\.full_name\} once/);
    assert.doesNotMatch(recordingsPage, /suggestedMeetingContactIds\.length === 1 \? \(/);
    assert.match(recordingsPage, /"Confirm who this was with"/);
  });

  test("keeps group meetings processable while directing unmatched people to the owner surface", () => {
    const dashboardPage = readFileSync("app/(portal)/dashboard/page.tsx", "utf8");
    const blockedExpression = recordingsPage.match(
      /const meetingContactChoiceBlocked =[\s\S]*?;\n\s*const meetingReturnTo/,
    )?.[0] ?? "";
    assert.doesNotMatch(blockedExpression, /unmatchedMeetingAttendees/);
    assert.match(recordingsPage, /defaultValue=\{suggestedMeetingContactIds\}/);
    assert.match(recordingsPage, /<h4>Owner decision needed<\/h4>/);
    assert.match(recordingsPage, /The owner can add each person or choose Not for the Book from Today\./);
    assert.doesNotMatch(recordingsPage, /action=\{decideCalendarAttendee\}/);
    assert.match(dashboardPage, /action=\{decideCalendarAttendee\}/);
    assert.match(dashboardPage, />\s*Add to Book\s*<\/button>/);
    assert.match(dashboardPage, />\s*Want to Know\s*<\/button>/);
    assert.match(dashboardPage, />\s*Not for the Book\s*<\/button>/);
    assert.match(
      recordingsPage,
      /const unmatchedMeetingAttendees = meetingPeople\.filter\(\s*calendarAttendeeNeedsBookDecision,?\s*\)/,
    );
    const liveMatchInference = recordingsPage.slice(
      recordingsPage.indexOf("const unambiguousLiveMatchedIds ="),
      recordingsPage.indexOf("const meetingHistoryIds ="),
    );
    assert.match(liveMatchInference, /meetingPeople\.length > 0/);
    assert.match(liveMatchInference, /meetingPeople\.every/);
  });

  test("submits inferred meeting people without exposing redundant item selectors", () => {
    assert.match(recordingsPage, /meetingHistoryIds\.map\(\(contactId\) =>/);
    assert.match(recordingsPage, /name="contact_ids" type="hidden" value=\{contactId\}/);
    assert.match(recordingsPage, /name="meeting_contact_ids" type="hidden" value=\{contactId\}/);
    assert.match(recordingsPage, /open=\{inference\.needsInput\}/);
    assert.match(recordingsPage, /\{!inference\.contactId \? \(/);
    assert.match(recordingsPage, /name="contact_id" type="hidden" value=\{inference\.contactId \?\? ""\}/);
    assert.match(recordingsPage, /<span>Who made this promise\?<\/span>/);
    assert.doesNotMatch(recordingsPage, />This is with<\/span>/);
    assert.doesNotMatch(recordingsPage, /<option value="action">/);
    assert.match(recordingsPage, /meetingFollowups\.length && !needsMeetingContactChoice/);
  });

  test("uses persisted meeting people for one-to-one inference when calendar identity is absent", () => {
    assert.match(
      recordingsPage,
      /const inferenceMeetingContactIds = meetingContactIdsForInference\(\{/,
    );
    assert.match(recordingsPage, /calendarAttendees: calendarEventId[\s\S]*: null/);
    assert.match(recordingsPage, /validatedConfirmedContactIds: validatedConfirmedIds/);
    assert.match(recordingsPage, /meetingContactIds: inferenceMeetingContactIds/);
    assert.doesNotMatch(
      recordingsPage,
      /inferRecordingFollowup\(\{[\s\S]*?meetingContactIds,\s*contacts:/,
    );
  });

  test("keeps an ignored extra attendee in live inference cardinality", () => {
    const liveInference = recordingsPage.slice(
      recordingsPage.indexOf("const inferenceMeetingContactIds ="),
      recordingsPage.indexOf("const meetingHistoryContacts ="),
    );
    assert.match(liveInference, /meetingCalendarAttendees\.map/);
    assert.doesNotMatch(liveInference, /calendarAttendeeNeedsBookDecision/);
    assert.doesNotMatch(liveInference, /ignored_by_owner/);
  });

  test("does not make terminal decisions satisfy promise-only browser fields", () => {
    assert.doesNotMatch(
      recordingsPage,
      /name="classification"[\s\S]{0,180}\brequired\b/,
    );
    assert.doesNotMatch(
      recordingsPage,
      /name="contact_id"[\s\S]{0,180}\brequired\b/,
    );
    assert.match(recordingsPage, /multiple\s+name="meeting_contact_ids"\s+required/);
    assert.match(recordingsPage, /value="already_done">Already done/);
    assert.match(recordingsPage, /value="decline">Decline/);
  });

  test("keeps meeting anchors on every owner submission", () => {
    assert.match(recordingsPage, /const meetingReturnTo = `\$\{returnTo\}#meeting-\$\{recording\.id\}`/);
    assert.match(recordingsPage, /name="return_to" type="hidden" value=\{meetingReturnTo\}/);
  });

  test("uses neutral language for legacy action receipts", () => {
    assert.match(recordingsPage, /if \(value === "action"\) return "Filed"/);
    assert.doesNotMatch(recordingsPage, /return "Action"/);
  });
});

describe("field-level Changes UI", () => {
  const changesPage = readFileSync("app/(portal)/changes/page.tsx", "utf8");
  const changeDetail = readFileSync("app/(portal)/changes/[id]/page.tsx", "utf8");
  const changeActions = readFileSync("app/(portal)/changes/actions.ts", "utf8");

  test("renders one concise row per person and keeps comparisons in detail review", () => {
    assert.match(changesPage, /const profileGroups = profileChangeGroups/);
    assert.match(changesPage, /<ContactChangeGroupCard key=\{group\.key\} rows=\{group\.rows\} \/>/);
    assert.match(changesPage, /Review together/);
    assert.match(changesPage, /className="changes-view-tabs"/);
    assert.doesNotMatch(changesPage, /<small>Current<\/small>/);
    assert.doesNotMatch(changesPage, /className="change-comparison-list"/);
  });

  test("requires detail review before a change decision", () => {
    assert.match(changesPage, /href={`\/changes\/\$\{row\.id\}\?return_to=/);
    assert.doesNotMatch(changesPage, /action=\{approvePendingChange\}/);
    assert.doesNotMatch(changesPage, /action=\{dismissPendingChange\}/);
    assert.doesNotMatch(changesPage, />\s*Edit\s*<\/Link>/);
    assert.doesNotMatch(changesPage, />\s*Dismiss\s*<\/button>/);
  });

  test("reviews all profile proposals together with independent field decisions", () => {
    assert.match(changeDetail, /function GroupedProfileReview/);
    assert.match(changeDetail, /name="fields"/);
    assert.match(changeDetail, /name="review_change_ids"/);
    assert.match(changeDetail, /defaultChecked/);
    assert.match(changeDetail, /Apply selected and finish/);
    assert.match(changeDetail, /aria-label="Apply selected fields and dismiss unchecked fields"/);
    assert.match(changeDetail, /action=\{dismissProfileField\} className="profile-field-dismiss-form"/);
    assert.match(changeDetail, /action=\{correctProfileField\}/);
    assert.match(changeDetail, />Correct this<\/summary>/);
    assert.match(changeDetail, /name="corrected_value"/);
    assert.match(changeDetail, /name="correction_reason"/);
    assert.match(changeDetail, /name="return_to" type="hidden" value=\{returnTo\}/);
    assert.match(changeDetail, /href=\{returnTo\}>Back<\/Link>/);
    assert.match(changeDetail, /form=\{reviewFormId\}/);
    assert.match(changeDetail, /anything unchecked is dismissed/i);
    assert.doesNotMatch(changeDetail, /Dismiss selected fields/);
    assert.doesNotMatch(changeDetail, /unchecked fields stay here for later/i);
    assert.match(changeActions, /export async function approveSelectedProfileFields/);
    assert.match(changeActions, /export async function dismissProfileField/);
    assert.match(changeActions, /export async function correctProfileField/);
    assert.match(changeActions, /remainingFieldPayload/);
    assert.match(changeActions, /dismissRemainingFields: true/);
    assert.match(changeActions, /fields_approved_with_unchecked_dismissed/);
    assert.match(changeActions, /unchecked_on_finish/);
    assert.match(changeActions, /fields_partially_dismissed/);
    assert.match(changeActions, /profileReviewRedirect\(formData/);
    assert.match(changeActions, /post_approval_enrichment: "suppressed"/);
    assert.match(changeActions, /source_ref: "owner_profile_correction"/);
    assert.match(changeActions, /pending_change\.field_corrected/);
    assert.doesNotMatch(changeActions, /trigger: "approved_contact_enrichment"/);
    assert.doesNotMatch(changeActions, /Unchecked fields are still waiting/);
  });
});
