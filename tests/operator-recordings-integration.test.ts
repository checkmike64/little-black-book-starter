import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(path, "utf8");
}

function exportedAction(sourceText: string, name: string) {
  const start = sourceText.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} must remain exported`);
  const next = sourceText.indexOf("\nexport async function ", start + 1);
  return sourceText.slice(start, next === -1 ? undefined : next);
}

test("Recordings guards operator access before tenant-wide service reads", () => {
  const page = source("app/(portal)/recordings/page.tsx");
  const data = source("lib/recordings/data.ts");

  assert.ok(page.indexOf("await requireOperatorAccess()") < page.indexOf("await getRecordingsData"));
  assert.ok(data.indexOf('context.role !== "operator"') < data.indexOf("createSupabaseAdminClient()"));
  assert.doesNotMatch(data, /createSupabaseServerClient|getTenantContext/);
  assert.match(data, /\.from\("integration_connections"\)[\s\S]*?\.eq\("tenant_id", context\.tenantId\)/);
  assert.match(data, /\.from\("transcripts"\)[\s\S]*?\.eq\("tenant_id", context\.tenantId\)/);
  assert.match(data, /\.from\("recording_followups"\)[\s\S]*?\.eq\("tenant_id", context\.tenantId\)/);
  assert.match(data, /operatorIsStoredOwner: operatorMembershipResult\.data\?\.role === "owner"/);
});

test("operator Recordings exposes only owner-derived or operator-safe actions", () => {
  const page = source("app/(portal)/recordings/page.tsx");
  const actions = source("app/(portal)/recordings/actions.ts");

  assert.match(page, /provider === "notion" && !connected && context && operatorIsStoredOwner/);
  assert.doesNotMatch(page, /decideCalendarAttendee/);
  assert.doesNotMatch(page, /ownerEmail: context\?\.userEmail/);
  assert.equal(page.match(/ownerEmail: recordingOwnerEmail/g)?.length, 2);
  assert.match(page, /name="connection_id" type="hidden" value=\{connection\.id\}/);
  assert.match(page, /<h2 id="recording-timeline-heading">Meeting Inbox<\/h2>/);

  for (const name of [
    "disconnectRecordingConnection",
    "acceptRecordingNotes",
    "confirmRecordingPeople",
    "dismissRecordingNotes",
    "syncNotionMeetings",
    "recoverNotionMeeting",
    "routeRecordingFollowup",
  ]) {
    assert.match(exportedAction(actions, name), /requireRecordingOperatorAction\(formData\)/);
  }
  assert.match(exportedAction(actions, "configureRecordingConnection"), /singleActiveOwnerUserId/);
  assert.doesNotMatch(page, /Google Meet|Gemini|google_meet|importGoogleMeetingNotes/);
  assert.doesNotMatch(actions, /export async function importGoogleMeetingNotes/);
  assert.match(exportedAction(actions, "syncNotionMeetings"), /activeOwnerRecordingConnection/);
  assert.match(exportedAction(actions, "recoverNotionMeeting"), /activeOwnerRecordingConnection/);
  assert.match(actions, /lbb_operator_confirm_meeting_contacts/);
  assert.match(actions, /lbb_operator_dismiss_meeting_artifact/);
  assert.match(actions, /lbb_operator_decide_recording_followup/);
  assert.match(actions, /p_expected_transcript_updated_at: submittedUpdatedAt/);
  assert.doesNotMatch(actions, /lbb_decide_recording_followup|lbb_review_recording_followup/);

  const accept = exportedAction(actions, "acceptRecordingNotes");
  const decide = exportedAction(actions, "routeRecordingFollowup");
  assert.match(accept, /formData\.get\("transcript_updated_at"\)[\s\S]*Date\.parse\(submittedUpdatedAt\)/);
  assert.match(decide, /parseRecordingFollowupDecisionForm[\s\S]*formData\.get\("transcript_updated_at"\)/);
  assert.match(page, /name="transcript_updated_at" type="hidden" value=\{recording\.updated_at\}/);
});

test("Notion OAuth is guarded before privileged state or admin access", () => {
  for (const path of [
    "app/api/integrations/notion/connect/route.ts",
    "app/api/integrations/notion/callback/route.ts",
  ]) {
    const route = source(path);
    assert.ok(route.indexOf("await requireOperatorAccess()") < route.indexOf("createSupabaseAdminClient()"));
    const requestStateRead = route.indexOf("request.nextUrl.searchParams");
    if (requestStateRead >= 0) {
      assert.ok(route.indexOf("await requireOperatorAccess()") < requestStateRead);
    }
  }
});

test("owner review surfaces use atomic operator-proposal RPCs", () => {
  const promiseActions = source("app/(portal)/promises/actions.ts");
  const promisePage = source("app/(portal)/promises/page.tsx");
  const changesActions = source("app/(portal)/changes/actions.ts");

  assert.match(promiseActions, /lbb_review_operator_routed_promise/);
  assert.match(promiseActions, /\.eq\("review_status", "accepted"\)[\s\S]*?\.eq\("status", "open"\)/);
  assert.match(promisePage, /promise\.review_status === "pending_owner"[\s\S]*?promise\.status === "pending_review"[\s\S]*?promise\.owner_user_id === tenantContext\?\.userId/);
  assert.match(promisePage, /value="accept">\s*Approve/);
  assert.match(promisePage, /value="already_done">\s*Already done/);
  assert.match(promisePage, /value="decline">\s*Decline/);

  const approve = exportedAction(changesActions, "approvePendingChange");
  const dismiss = exportedAction(changesActions, "dismissPendingChange");
  assert.ok(approve.indexOf("isOperatorRecordingAction") < approve.indexOf("approvalBlockedReason"));
  assert.ok(dismiss.indexOf("isOperatorRecordingAction") < dismiss.indexOf('.from("pending_changes")'));
  assert.match(changesActions, /lbb_review_operator_recording_action/);
  assert.match(changesActions, /lbb_review_recording_baseline_change/);
});

test("recording baseline cron claims one oldest-due mode with bounded headroom", () => {
  const worker = source("lib/recordings/baseline-worker.ts");
  const cron = source("app/api/automation/recordings/route.ts");

  assert.match(worker, /lbb_claim_next_recording_baseline_job/);
  assert.doesNotMatch(worker, /lbb_claim_recording_baseline_jobs|lbb_claim_operator_recording_baseline_jobs/);
  assert.match(worker, /job\.job_type === "recording_baseline_operator"[\s\S]*?lbb_apply_operator_recording_baseline/);
  assert.match(worker, /job\.job_type === "recording_baseline_operator"[\s\S]*?lbb_fail_operator_recording_baseline_job/);
  assert.match(worker, /actor_user_id: string/);
  assert.match(worker, /userId: job\.actor_user_id/);
  assert.match(cron, /export const maxDuration = 240/);
  assert.match(cron, /export const baselineClaimCutoffMs = 90_000/);
  assert.match(cron, /elapsedBeforeBaselineMs <= baselineClaimCutoffMs/);
  assert.match(cron, /processQueuedRecordingBaselines\(\{ admin \}\)/);
});

test("late owner attendee repair preserves operator-reviewed proposal-only processing", () => {
  const dashboardActions = source("app/(portal)/dashboard/actions.ts");
  assert.match(dashboardActions, /metadata\.evidence_grade === "operator_reviewed"/);
  assert.match(dashboardActions, /lbb_owner_repair_operator_meeting_contacts/);
  assert.match(dashboardActions, /p_expected_transcript_updated_at: meeting\.updated_at/);
  assert.match(dashboardActions, /else \{[\s\S]*confirmMeetingContacts/);
});

test("private pending-change API reserves both recording proposal sources", () => {
  const route = source("app/api/claude/pending-changes/route.ts");
  assert.match(route, /\["recording_baseline", "recording_operator"\]\.includes\(source\)/);
});
