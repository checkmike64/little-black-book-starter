import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  normalizeFathomArtifact,
  normalizeFathomRecordingId,
  markFathomOwnerAssigned,
} from "../lib/integrations/recordings/fathom.js";
import {
  verifyFathomWebhook,
  verifyFirefliesWebhook,
} from "../lib/integrations/recordings/webhook-verification.js";
import {
  analyzeAskQuery,
  isGroundedAskObligationMatch,
  matchAskDocument,
} from "../lib/ask/retrieval.js";

describe("recording integrations", () => {
  it("verifies Fireflies V2 raw-body signatures", () => {
    const rawBody = JSON.stringify({ event: "meeting.transcribed", meeting_id: "meeting-1" });
    const secret = "test-fireflies-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    assert.equal(verifyFirefliesWebhook({ rawBody, signature, secret }), true);
    assert.equal(
      verifyFirefliesWebhook({ rawBody: `${rawBody} `, signature, secret }),
      false,
    );
  });

  it("verifies Fathom signatures and rejects stale replays", () => {
    const nowSeconds = 1_800_000_000;
    const rawBody = JSON.stringify({ recording_id: "recording-1" });
    const webhookId = "message-1";
    const timestamp = String(nowSeconds);
    const secretBytes = Buffer.from("fathom-test-secret");
    const secret = `whsec_${secretBytes.toString("base64")}`;
    const signature = createHmac("sha256", secretBytes)
      .update(`${webhookId}.${timestamp}.${rawBody}`)
      .digest("base64");
    assert.equal(
      verifyFathomWebhook({
        rawBody,
        webhookId,
        timestamp,
        signature: `v1,${signature}`,
        secret,
        nowSeconds,
      }),
      true,
    );
    assert.equal(
      verifyFathomWebhook({
        rawBody,
        webhookId,
        timestamp,
        signature: `v1,${signature}`,
        secret,
        nowSeconds: nowSeconds + 301,
      }),
      false,
    );
  });

  it("normalizes Fathom without carrying raw transcript text forward", () => {
    const artifact = normalizeFathomArtifact({
      recording_id: 123456789,
      meeting_title: "Pipeline review",
      recording_start_time: "2026-08-23T15:00:00Z",
      recording_end_time: "2026-08-23T15:30:00Z",
      share_url: "https://fathom.video/share/recording-1",
      url: "https://fathom.video/recording-1",
      calendar_invitees: [{ email: "ava@example.com", name: "Ava" }],
      transcript: [{ speaker: "Ava", text: "private raw words" }],
      default_summary: { markdown_formatted: "Ava requested a product walkthrough." },
      action_items: [{
        description: "Send the walkthrough",
        assignee: { name: "Alex", email: "alex@example.com" },
      }],
    });
    assert.equal(artifact.durationSeconds, 1800);
    assert.equal(artifact.externalArtifactId, "123456789");
    assert.equal(artifact.recordingUrl, "https://fathom.video/recording-1");
    assert.deepEqual(artifact.participantEmails, ["ava@example.com"]);
    assert.match(artifact.distilledSummary, /Provider-generated summary for review/);
    assert.ok(artifact.transcriptSha256);
    assert.equal(artifact.actionItems[0]?.assignee_email, "alex@example.com");
    assert.equal(artifact.actionItems[0]?.owner_assigned, false);
    const assigned = markFathomOwnerAssigned(artifact, "ALEX@example.com");
    assert.equal(assigned.actionItems[0]?.owner_assigned, true);
    assert.doesNotMatch(JSON.stringify(artifact), /private raw words/);
  });

  it("accepts official Fathom numeric IDs and rejects share-only URLs", () => {
    assert.equal(normalizeFathomRecordingId(123456789), "123456789");
    assert.equal(normalizeFathomRecordingId("123456789"), "123456789");
    assert.equal(normalizeFathomRecordingId("recording-1"), null);
    const artifact = normalizeFathomArtifact({
      recording_id: "42",
      share_url: "https://fathom.video/share/secret",
      recording_start_time: "2026-08-23T15:00:00Z",
      default_summary: "Summary",
    });
    assert.equal(artifact.recordingUrl, null);
  });

  it("keeps receipts service-only and recording writes atomic and idempotent", () => {
    const migration = readFileSync(
      "supabase/migrations/20260823152625_recording_integrations.sql",
      "utf8",
    );
    assert.match(migration, /recording_ingest_receipts/);
    assert.match(migration, /revoke all on table public\.recording_ingest_receipts from public, anon, authenticated/);
    assert.match(migration, /pg_advisory_xact_lock/);
    assert.match(migration, /transcripts_external_artifact_unique_idx/);
    assert.match(migration, /raw_transcript_stored', false/);
    assert.match(migration, /vault\.create_secret/);
    assert.match(migration, /lbb_ensure_manual_recording_connection/);
    assert.match(migration, /lbb_enqueue_recording_receipt/);
    assert.match(migration, /lbb_claim_recording_receipts/);
    assert.match(migration, /lbb_prepare_recording_connection/);
    assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(/);
    assert.match(migration, /metadata->>'provisioning_token' = p_claim_token::text/);
    assert.match(migration, /lbb_abandon_recording_connection_provisioning/);
    assert.match(migration, /lbb_mark_recording_provisioning_cleanup_pending/);
    assert.match(migration, /lbb_upsert_recording_connection\(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text\)/);
    assert.match(migration, /app_private\.is_tenant_member\(tenant_id\)[\s\S]*owner_user_id = \(select auth\.uid\(\)\)/);
    assert.match(migration, /for update of r skip locked/i);
    assert.match(migration, /next_attempt_at/);
    assert.doesNotMatch(migration, /raw_payload\s+jsonb/i);
  });

  it("never trusts tenant identity from provider payloads", () => {
    const firefliesRoute = readFileSync(
      "app/api/integrations/recordings/fireflies/[connectionId]/route.ts",
      "utf8",
    );
    const fathomRoute = readFileSync(
      "app/api/integrations/recordings/fathom/[connectionId]/route.ts",
      "utf8",
    );
    for (const route of [firefliesRoute, fathomRoute]) {
      assert.match(route, /recordingConnectionSecret\(connectionId\)/);
      assert.match(route, /Payload too large/);
      assert.match(route, /Invalid webhook signature/);
      assert.doesNotMatch(route, /payload\.tenant_id/);
      assert.doesNotMatch(route, /\bafter\s*\(/);
      assert.doesNotMatch(route, /processRecordingArtifact/);
    }
    assert.match(fathomRoute, /normalizeFathomRecordingId\(payload\.recording_id\)/);
    const worker = readFileSync("lib/integrations/recordings/ingest.ts", "utf8");
    assert.match(worker, /processQueuedRecordingReceipts/);
    assert.match(worker, /reconcileRecordingProviderReceipts/);
    assert.match(worker, /lbb_claim_recording_receipts/);
    assert.match(worker, /RecordingArtifactPendingError/);
    assert.match(worker, /external_account_email/);
    assert.match(worker, /\.eq\("status", "active"\)/);
    const fathom = readFileSync("lib/integrations/recordings/fathom.ts", "utf8");
    assert.match(fathom, /owner_assigned/);
    assert.match(fathom, /recorded_by\[\]/);
    assert.match(fathom, /isFathomOwnerMeeting/);
    assert.doesNotMatch(fathom, /safeHttpUrl\(payload\.share_url/);
    const fireflies = readFileSync("lib/integrations/recordings/fireflies.ts", "utf8");
    assert.match(fireflies, /mine: true/);
    assert.match(fireflies, /organizer_email/);
    assert.match(fireflies, /transcriptOwnershipQuery/);
    assert.ok(
      fireflies.indexOf("query: transcriptOwnershipQuery")
        < fireflies.indexOf("query: transcriptQuery"),
    );
    const proxy = readFileSync("proxy.ts", "utf8");
    assert.match(proxy, /pathname\.startsWith\("\/api\/integrations\/recordings\/"\)/);
    assert.match(proxy, /pathname === "\/api\/automation\/recordings"/);
  });

  it("keeps direct account-specific imports out of the operator surface", () => {
    const page = readFileSync("app/(portal)/recordings/page.tsx", "utf8");
    const actions = readFileSync("app/(portal)/recordings/actions.ts", "utf8");
    assert.doesNotMatch(page, /Google Meet|Gemini|google_meet/);
    assert.doesNotMatch(actions, /importGoogleMeetingNotes|consent_attestation_google/);
  });

  it("re-arms exhausted reconciliation safely and closes old consent receipts", () => {
    const migration = readFileSync(
      "supabase/migrations/20260823152625_recording_integrations.sql",
      "utf8",
    );
    assert.match(migration, /recording_ingest_receipts\.status = 'ignored'/);
    assert.match(migration, /excluded\.event_type = 'daily\.reconcile'/);
    assert.match(migration, /rearmed_by_reconciliation_at/);
    assert.match(migration, /status in \('received', 'processing', 'failed'\)/);
    assert.match(migration, /not exists \([\s\S]*public\.transcripts t[\s\S]*external_artifact_id = excluded\.external_artifact_id/);
  });

  it("reserves a single provider connection before creating an upstream webhook", () => {
    const actions = readFileSync("app/(portal)/recordings/actions.ts", "utf8");
    const prepareIndex = actions.indexOf("lbb_prepare_recording_connection");
    const createIndex = actions.indexOf("createFathomWebhook({");
    assert.notEqual(prepareIndex, -1);
    assert.notEqual(createIndex, -1);
    assert.ok(prepareIndex < createIndex);
    assert.match(actions, /p_claim_token: claimToken/);
    assert.match(actions, /lbb_mark_recording_provisioning_cleanup_pending/);
  });

  it("enforces retention through the scheduled automation loop", () => {
    const retention = readFileSync("lib/automation/transcript-retention.ts", "utf8");
    const daily = readFileSync("app/api/automation/daily/route.ts", "utf8");
    assert.match(retention, /\.lte\("retention_until", today\)/);
    assert.match(retention, /\.not\("storage_path", "is", null\)/);
    assert.doesNotMatch(retention, /processing_status:\s*"purged"/);
    assert.match(retention, /storage[\s\S]*\.from\("transcripts"\)[\s\S]*\.remove/);
    assert.match(retention, /recording\.raw_transcript_purged/);
    assert.match(daily, /enforceTranscriptRetention/);
    assert.match(daily, /transcript_retention/);
    assert.match(daily, /processQueuedRecordingReceipts/);
    assert.match(daily, /reconcileRecordingProviderReceipts/);
    assert.match(daily, /recording_queue/);
    const recordingCron = readFileSync(
      "app/api/automation/recordings/route.ts",
      "utf8",
    );
    assert.match(recordingCron, /processQueuedRecordingReceipts/);
  });

  it("keeps provider notes outside relationship evidence until explicit review", () => {
    const migration = readFileSync(
      "supabase/migrations/20260823152625_recording_integrations.sql",
      "utf8",
    );
    const ask = readFileSync("lib/ask/data.ts", "utf8");
    const networking = readFileSync("app/api/claude/networking/route.ts", "utf8");
    const contactData = readFileSync("lib/contact-detail/data.ts", "utf8");
    const page = readFileSync("app/(portal)/recordings/page.tsx", "utf8");
    assert.match(migration, /interaction_id, connection_id[\s\S]*p_tenant_id, null, p_connection_id/);
    assert.match(migration, /nullif\(left\([\s\S]*\), 'review'/);
    assert.match(migration, /lbb_accept_meeting_artifact/);
    assert.match(migration, /lbb_dismiss_meeting_artifact/);
    assert.match(migration, /owners may review only their own meeting artifacts/);
    assert.match(ask, /\.eq\("processing_status", "ready"\)/);
    assert.match(networking, /\.eq\("processing_status", "ready"\)/);
    assert.match(contactData, /\.eq\("processing_status", "ready"\)/);
    assert.match(page, /acceptRecordingNotes/);
    assert.match(page, /dismissRecordingNotes/);
    assert.match(page, /Approve, mark done, or decline each item/);
    assert.match(page, /meetingFollowups\.length === 0/);
    assert.doesNotMatch(page, /before confirming the meeting notes/);
  });

  it("makes confirmed owner-assigned recording actions discoverable as obligations", () => {
    const analysis = analyzeAskQuery("Who do I owe a Loom video about the Black Book to?");
    const body = "Ava requested a Black Book walkthrough. Send the Black Book walkthrough.";
    const match = matchAskDocument(body, analysis, { ownerOwes: true });
    assert.equal(isGroundedAskObligationMatch(match, analysis), true);
    const ask = readFileSync("lib/ask/data.ts", "utf8");
    assert.match(ask, /ownerOwes:\s*\(transcript\.action_items \?\? \[\]\)\.some/);
    assert.match(ask, /action_items/);
  });

  it("uses operator-attested owner-only setup and hides it outside admin mode", () => {
    const migration = readFileSync(
      "supabase/migrations/20260823152625_recording_integrations.sql",
      "utf8",
    );
    const page = readFileSync("app/(portal)/recordings/page.tsx", "utf8");
    const actions = readFileSync("app/(portal)/recordings/actions.ts", "utf8");
    const fathomWebhooks = readFileSync(
      "lib/integrations/recordings/fathom-webhooks.ts",
      "utf8",
    );
    const revocation = readFileSync(
      "lib/integrations/recordings/revocation.ts",
      "utf8",
    );
    assert.match(migration, /authorization_attested_by/);
    assert.match(migration, /role = 'owner'/);
    assert.match(migration, /p_scope <> 'my_recordings'/);
    assert.doesNotMatch(page, /option value="team_recordings"/);
    assert.match(page, /shouldUseAdminTools/);
    assert.match(page, /documented owner authorization is on file/);
    assert.match(actions, /createFathomWebhook/);
    assert.match(actions, /deleteFathomWebhook/);
    assert.match(migration, /upstream_revoke_status = 'cleanup_pending'/);
    assert.match(actions, /confirmRecordingWebhookRemoved/);
    assert.doesNotMatch(page, /Google Meet|Gemini|google_meet/);
    assert.match(migration, /lbb_confirm_recording_upstream_revoked/);
    assert.match(fathomWebhooks, /\[404, 410\]/);
    assert.match(revocation, /lbb_finalize_recording_revocation/);
    assert.match(migration, /upstream_revoke_status = 'revoked'/);
  });

  it("runs a bounded fair recording worker with daily reconciliation fallback", () => {
    const cron = readFileSync("app/api/automation/recordings/route.ts", "utf8");
    const vercel = readFileSync("vercel.json", "utf8");
    const ingest = readFileSync("lib/integrations/recordings/ingest.ts", "utf8");
    const migration = readFileSync(
      "supabase/migrations/20260823152625_recording_integrations.sql",
      "utf8",
    );
    assert.match(vercel, /"schedule": "\*\/5 \* \* \* \*"/);
    assert.match(cron, /processQueuedRecordingReceipts\(\{ admin, limit: 8 \}\)/);
    assert.match(cron, /oldest_due_age_seconds/);
    assert.match(ingest, /reconcileRecordingProviderReceipts/);
    assert.match(migration, /partition by r\.tenant_id/);
  });
});
