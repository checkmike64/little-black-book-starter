"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOperatorAccess } from "@/lib/operator-access";
import { purgeConnectionRawTranscripts } from "@/lib/automation/transcript-retention";
import {
  requireOperatorTenantActionContext,
  type AdminClient,
} from "@/lib/server-action-context";
import {
  redirectWithMessage,
  safeFormReturnPath,
} from "@/lib/server-action-redirect";
import {
  createFathomWebhook,
  deleteFathomWebhook,
} from "@/lib/integrations/recordings/fathom-webhooks";
import {
  processQueuedRecordingReceipts,
  reconcileNotionArtifactReceipts,
} from "@/lib/integrations/recordings/ingest";
import {
  meetingContactIdsFromForm,
  parseNotionMeetingReference,
  parseRecordingFollowupDecisionForm,
} from "@/lib/recordings/followup-routing";

const consentVersion = "recording-import-v1";

function redirectRecording(message: string, formData?: FormData): never {
  redirectWithMessage(
    formData ? safeFormReturnPath(formData, "/recordings") : "/recordings",
    message,
  );
}

function rpcObject(value: unknown) {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved && typeof resolved === "object" && !Array.isArray(resolved)
    ? resolved as Record<string, unknown>
    : null;
}

async function requireRecordingOperatorAction(formData?: FormData) {
  await requireOperatorAccess();
  return requireOperatorTenantActionContext(
    () => redirectRecording("The private data connection is unavailable.", formData),
    () => redirectRecording("Admin mode is required to process meeting notes.", formData),
  );
}

async function activeOwnerRecordingConnection({
  admin,
  tenantId,
  connectionId,
  provider,
  requireActive = true,
}: {
  admin: AdminClient;
  tenantId: string;
  connectionId: string;
  provider?: string;
  requireActive?: boolean;
}) {
  let query = admin
    .from("integration_connections")
    .select("id,user_id,provider,metadata,status")
    .eq("tenant_id", tenantId)
    .eq("id", connectionId);
  if (provider) query = query.eq("provider", provider);
  const { data: connection, error } = await query.maybeSingle();
  if (
    error
    || !connection
    || (requireActive && connection.status !== "active")
    || (!requireActive && connection.status === "disconnected")
  ) return null;
  const { data: owner, error: ownerError } = await admin
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", connection.user_id)
    .eq("role", "owner")
    .eq("status", "active")
    .maybeSingle();
  return ownerError || !owner ? null : connection;
}

async function singleActiveOwnerUserId(admin: AdminClient, tenantId: string) {
  const { data, error, count } = await admin
    .from("tenant_members")
    .select("user_id", { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .eq("status", "active")
    .limit(2);
  return !error && count === 1 && data?.length === 1 ? data[0].user_id : null;
}

export async function configureRecordingConnection(formData: FormData) {
  await requireOperatorAccess();
  const { admin, context } = await requireOperatorTenantActionContext(
    () => redirectRecording("The private data connection is unavailable."),
    () => redirectRecording("Admin mode is required to configure a meeting source."),
  );
  const provider = String(formData.get("provider") ?? "");
  const apiKey = String(formData.get("api_key") ?? "").trim();
  let webhookSecret = String(formData.get("webhook_secret") ?? "").trim();
  const accountEmail = String(formData.get("account_email") ?? "").trim().slice(0, 320);
  if (!formData.get("consent_attestation")) {
    redirectRecording("Attest that documented owner authorization is on file before connecting.");
  }
  if (!apiKey || !["fireflies", "fathom"].includes(provider)) {
    redirectRecording("A supported provider and API key are required.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) {
    redirectRecording("The recording account email is required to enforce owner-only imports.");
  }
  if (provider === "fireflies" && !webhookSecret) {
    redirectRecording("The Fireflies webhook signing secret is required.");
  }
  const ownerUserId = await singleActiveOwnerUserId(admin, context.tenantId);
  if (!ownerUserId) {
    redirectRecording("Exactly one active owner is required before connecting recordings.");
  }
  const claimToken = randomUUID();
  const { data: connectionId, error: prepareError } = await admin.rpc(
    "lbb_prepare_recording_connection",
    {
      p_tenant_id: context.tenantId,
      p_connection_id: randomUUID(),
      p_owner_user_id: ownerUserId,
      p_actor_user_id: context.userId,
      p_provider: provider,
      p_claim_token: claimToken,
    },
  );
  if (prepareError || typeof connectionId !== "string") {
    redirectRecording("That meeting source is already connected or being configured. Disconnect it before replacing it.");
  }
  let createdFathomWebhook: { id: string; secret: string } | null = null;
  if (provider === "fathom") {
    const origin = (process.env.NEXT_PUBLIC_SITE_URL
      ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "")).replace(/\/$/, "");
    if (!origin) redirectRecording("The production site URL is required to create a Fathom webhook.");
    try {
      createdFathomWebhook = await createFathomWebhook({
        apiKey,
        destinationUrl: `${origin}/api/integrations/recordings/fathom/${connectionId}`,
      });
      webhookSecret = createdFathomWebhook.secret;
    } catch {
      await admin.rpc("lbb_abandon_recording_connection_provisioning", {
        p_tenant_id: context.tenantId,
        p_connection_id: connectionId,
        p_actor_user_id: context.userId,
        p_claim_token: claimToken,
      });
      redirectRecording("Fathom could not verify the API key or create its private webhook.");
    }
  }
  const { error } = await admin.rpc("lbb_upsert_recording_connection", {
    p_tenant_id: context.tenantId,
    p_connection_id: connectionId,
    p_claim_token: claimToken,
    p_owner_user_id: ownerUserId,
    p_actor_user_id: context.userId,
    p_provider: provider,
    p_api_key: apiKey,
    p_webhook_secret: webhookSecret,
    p_external_account_email: accountEmail || null,
    p_upstream_webhook_id: createdFathomWebhook?.id ?? null,
    p_consent_version: consentVersion,
    p_scope: "my_recordings",
  });
  if (error) {
    if (createdFathomWebhook) {
      let upstreamDeleted = false;
      try {
        await deleteFathomWebhook({
          apiKey,
          webhookId: createdFathomWebhook.id,
        });
        upstreamDeleted = true;
      } catch {
        const { data: cleanupRecorded } = await admin.rpc(
          "lbb_mark_recording_provisioning_cleanup_pending",
          {
            p_tenant_id: context.tenantId,
            p_connection_id: connectionId,
            p_actor_user_id: context.userId,
            p_claim_token: claimToken,
            p_api_key: apiKey,
            p_upstream_webhook_id: createdFathomWebhook.id,
          },
        );
        if (!cleanupRecorded) {
          redirectRecording("Fathom setup failed and its webhook cleanup needs immediate operator attention.");
        }
      }
      if (upstreamDeleted) {
        await admin.rpc("lbb_abandon_recording_connection_provisioning", {
          p_tenant_id: context.tenantId,
          p_connection_id: connectionId,
          p_actor_user_id: context.userId,
          p_claim_token: claimToken,
        });
      }
    } else {
      await admin.rpc("lbb_abandon_recording_connection_provisioning", {
        p_tenant_id: context.tenantId,
        p_connection_id: connectionId,
        p_actor_user_id: context.userId,
        p_claim_token: claimToken,
      });
    }
    redirectRecording("The meeting source could not be connected.");
  }
  revalidatePath("/recordings");
  redirectRecording(provider === "fathom"
    ? "Fathom connected and its owner-only webhook was created automatically."
    : "Fireflies connected. Copy the signed webhook URL shown below into Fireflies.");
}

export async function disconnectRecordingConnection(formData: FormData) {
  const { admin, context } = await requireRecordingOperatorAction(formData);
  const connectionId = String(formData.get("connection_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) {
    redirectRecording("The meeting source could not be disconnected.");
  }
  const connection = await activeOwnerRecordingConnection({
    admin,
    tenantId: context.tenantId,
    connectionId,
    requireActive: false,
  });
  if (!connection) {
    redirectRecording("The meeting source could not be disconnected.");
  }
  let upstreamRevoked = connection.provider === "google_meet" || connection.provider === "notion";
  if (connection.provider === "fathom") {
    const { data: secretRows, error: secretError } = await admin.rpc(
      "lbb_recording_connection_secrets",
      { p_connection_id: connectionId },
    );
    const secrets = Array.isArray(secretRows) ? secretRows[0] : null;
    const webhookId = connection.metadata && typeof connection.metadata === "object"
      ? String((connection.metadata as Record<string, unknown>).upstream_webhook_id ?? "")
      : "";
    if (!secretError && secrets?.api_key && webhookId) {
      try {
        await deleteFathomWebhook({ apiKey: secrets.api_key, webhookId });
        upstreamRevoked = true;
      } catch {
        upstreamRevoked = false;
      }
    }
  }
  const { data, error } = await admin.rpc("lbb_disconnect_recording_connection", {
    p_tenant_id: context.tenantId,
    p_connection_id: connectionId,
    p_actor_user_id: context.userId,
    p_upstream_revoked: upstreamRevoked,
  });
  if (error || !data) redirectRecording("The meeting source could not be disconnected.");
  const cleanup = await purgeConnectionRawTranscripts({
    admin,
    tenantId: context.tenantId,
    connectionId,
  });
  revalidatePath("/recordings");
  redirectRecording(
    cleanup.cleanupPending
      ? "Local imports are disabled. Raw-object cleanup needs operator attention; derived notes remain, and upstream webhook removal is still pending."
      : upstreamRevoked
        ? "Local imports are disabled, the provider webhook was removed, and derived notes remain for your relationship history."
        : "Local imports are disabled and derived notes remain for your relationship history. Upstream webhook removal is still pending.",
  );
}

export async function confirmRecordingWebhookRemoved(formData: FormData) {
  await requireOperatorAccess();
  const { admin, context } = await requireOperatorTenantActionContext(
    () => redirectRecording("The private data connection is unavailable."),
    () => redirectRecording("Admin mode is required to confirm provider cleanup."),
  );
  const connectionId = String(formData.get("connection_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) {
    redirectRecording("The provider cleanup could not be confirmed.");
  }
  const { data, error } = await admin.rpc("lbb_confirm_recording_upstream_revoked", {
    p_tenant_id: context.tenantId,
    p_connection_id: connectionId,
    p_actor_user_id: context.userId,
  });
  if (error || !data) redirectRecording("The provider cleanup could not be confirmed.");
  revalidatePath("/recordings");
  redirectRecording("Provider webhook removal confirmed. This source can now be reconnected safely.");
}

export async function acceptRecordingNotes(formData: FormData) {
  const { admin, context } = await requireRecordingOperatorAction(formData);
  const transcriptId = String(formData.get("transcript_id") ?? "");
  const submittedUpdatedAt = String(formData.get("transcript_updated_at") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(transcriptId)) {
    redirectRecording("Those meeting notes could not be confirmed.", formData);
  }
  if (!submittedUpdatedAt || Number.isNaN(Date.parse(submittedUpdatedAt))) {
    redirectRecording("Those meeting notes changed or could not be verified. Refresh and try again.", formData);
  }
  const contactIds = meetingContactIdsFromForm(formData);
  if (contactIds.length === 0) {
    redirectRecording("Choose at least one person who attended this meeting.", formData);
  }
  try {
    const { data, error } = await admin.rpc("lbb_operator_confirm_meeting_contacts", {
      p_tenant_id: context.tenantId,
      p_transcript_id: transcriptId,
      p_actor_user_id: context.userId,
      p_contact_ids: contactIds,
      p_expected_transcript_updated_at: submittedUpdatedAt,
    });
    const result = rpcObject(data);
    if (error || result?.transcript_id !== transcriptId || result.processing_status !== "ready") {
      throw new Error("Operator meeting confirmation failed.");
    }
  } catch {
    redirectRecording("Those meeting notes could not be confirmed.", formData);
  }
  revalidatePath("/recordings");
  revalidatePath("/ask");
  for (const contactId of contactIds) revalidatePath(`/contacts/${contactId}`);
  redirectRecording("Meeting notes confirmed and added to relationship history.", formData);
}

export async function confirmRecordingPeople(formData: FormData) {
  const { admin, context } = await requireRecordingOperatorAction(formData);
  const transcriptId = String(formData.get("transcript_id") ?? "");
  const contactIds = meetingContactIdsFromForm(formData);
  const submittedUpdatedAt = String(formData.get("transcript_updated_at") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(transcriptId)) {
    redirectRecording("Those meeting attendees could not be confirmed.", formData);
  }
  if (!submittedUpdatedAt || Number.isNaN(Date.parse(submittedUpdatedAt))) {
    redirectRecording("Meeting attendees changed or could not be verified. Refresh and try again.", formData);
  }
  if (contactIds.length === 0) {
    redirectRecording("Choose at least one person who attended this meeting.", formData);
  }
  try {
    const { data, error } = await admin.rpc("lbb_operator_confirm_meeting_contacts", {
      p_tenant_id: context.tenantId,
      p_transcript_id: transcriptId,
      p_actor_user_id: context.userId,
      p_contact_ids: contactIds,
      p_expected_transcript_updated_at: submittedUpdatedAt,
    });
    const result = rpcObject(data);
    if (
      error
      || result?.transcript_id !== transcriptId
      || !["review", "ready"].includes(String(result.processing_status ?? ""))
    ) {
      throw new Error("Operator attendee confirmation failed.");
    }
  } catch {
    redirectRecording(
      "Meeting attendees changed or could not be verified. Refresh and try again.",
      formData,
    );
  }
  revalidatePath("/recordings");
  revalidatePath("/ask");
  for (const contactId of contactIds) revalidatePath(`/contacts/${contactId}`);
  redirectRecording("Meeting attendees confirmed.", formData);
}

export async function dismissRecordingNotes(formData: FormData) {
  const { admin, context } = await requireRecordingOperatorAction(formData);
  const transcriptId = String(formData.get("transcript_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(transcriptId)) {
    redirectRecording("Those meeting notes could not be dismissed.", formData);
  }
  const { data, error } = await admin.rpc("lbb_operator_dismiss_meeting_artifact", {
    p_tenant_id: context.tenantId,
    p_transcript_id: transcriptId,
    p_actor_user_id: context.userId,
  });
  const result = rpcObject(data);
  if (error || result?.transcript_id !== transcriptId || result.status !== "dismissed") {
    redirectRecording("Those meeting notes could not be dismissed.", formData);
  }
  revalidatePath("/recordings");
  redirectRecording("Meeting notes dismissed. They will not be used as relationship evidence.", formData);
}

export async function syncNotionMeetings(formData: FormData) {
  const { admin, context } = await requireRecordingOperatorAction(formData);
  const connectionId = String(formData.get("connection_id") ?? "");
  const connection = /^[0-9a-f-]{36}$/i.test(connectionId)
    ? await activeOwnerRecordingConnection({
        admin,
        tenantId: context.tenantId,
        connectionId,
        provider: "notion",
      })
    : null;
  if (!connection) {
    redirectRecording("Connect your Notion meeting notes before checking for updates.", formData);
  }

  let reconciliation: Awaited<ReturnType<typeof reconcileNotionArtifactReceipts>>;
  try {
    reconciliation = await reconcileNotionArtifactReceipts({
      admin,
      connectionId: connection.id,
      trigger: "manual",
    });
  } catch {
    redirectRecording("Notion could not be checked. Your existing meeting notes are unchanged.", formData);
  }
  if (reconciliation.enqueued > 0) {
    try {
      await processQueuedRecordingReceipts({ admin, limit: 20 });
    } catch {
      redirectRecording(
        "New Notion notes were queued. The private import will retry automatically.",
        formData,
      );
    }
  }
  revalidatePath("/recordings");
  redirectRecording(
    reconciliation.enqueued > 0
      ? `${reconciliation.enqueued} Notion meeting note${reconciliation.enqueued === 1 ? " was" : "s were"} found and private import was started.`
      : reconciliation.pending > 0
        ? `${reconciliation.pending} Notion meeting note${reconciliation.pending === 1 ? " is" : "s are"} still preparing. Check again after Notion finishes the notes.`
        : "Notion is up to date. No new ready meeting notes were found.",
    formData,
  );
}

export async function recoverNotionMeeting(formData: FormData) {
  const { admin, context } = await requireRecordingOperatorAction(formData);
  const meetingNoteId = parseNotionMeetingReference(formData.get("notion_meeting"));
  if (!meetingNoteId) {
    redirectRecording("Paste a valid Notion meeting-note link or ID.", formData);
  }
  const connectionId = String(formData.get("connection_id") ?? "");
  const connection = /^[0-9a-f-]{36}$/i.test(connectionId)
    ? await activeOwnerRecordingConnection({
        admin,
        tenantId: context.tenantId,
        connectionId,
        provider: "notion",
      })
    : null;
  if (!connection) {
    redirectRecording("Connect your Notion meeting notes before recovering a meeting.", formData);
  }
  let reconciliation: Awaited<ReturnType<typeof reconcileNotionArtifactReceipts>>;
  try {
    reconciliation = await reconcileNotionArtifactReceipts({
      admin,
      connectionId: connection.id,
      artifactId: meetingNoteId,
      trigger: "manual",
    });
  } catch {
    redirectRecording("That Notion meeting could not be checked. Confirm the link is shared with the connected workspace.", formData);
  }
  if (reconciliation.checked === 0) {
    redirectRecording("That Notion meeting note could not be found in the connected workspace.", formData);
  }
  if (reconciliation.pending > 0) {
    revalidatePath("/recordings");
    redirectRecording("That meeting is visible, but Notion is still preparing its notes.", formData);
  }
  if (reconciliation.enqueued === 0) {
    revalidatePath("/recordings");
    redirectRecording("That Notion meeting is already queued or imported.", formData);
  }
  try {
    await processQueuedRecordingReceipts({ admin, limit: 20 });
  } catch {
    redirectRecording("The meeting is ready and queued. Private import will retry automatically.", formData);
  }
  revalidatePath("/recordings");
  redirectRecording(
    "That meeting is ready and its private import was started.",
    formData,
  );
}

export async function routeRecordingFollowup(formData: FormData) {
  const parsed = parseRecordingFollowupDecisionForm(formData);
  if (!parsed.ok) redirectRecording(parsed.message, formData);
  const submittedUpdatedAt = String(formData.get("transcript_updated_at") ?? "").trim();
  if (!submittedUpdatedAt || Number.isNaN(Date.parse(submittedUpdatedAt))) {
    redirectRecording("That meeting changed or could not be verified. Refresh and try again.", formData);
  }
  const { admin, context } = await requireRecordingOperatorAction(formData);
  const { data, error } = await admin.rpc("lbb_operator_decide_recording_followup", {
    p_tenant_id: context.tenantId,
    p_followup_id: parsed.value.followupId,
    p_actor_user_id: context.userId,
    p_classification: parsed.value.classification,
    p_outcome: parsed.value.outcome,
    p_contact_id: parsed.value.contactId,
    p_meeting_contact_ids: parsed.value.meetingContactIds,
    p_due_on: parsed.value.dueOn,
    p_note: parsed.value.note,
    p_expected_transcript_updated_at: submittedUpdatedAt,
  });
  const result = rpcObject(data);
  if (error || !result || result.followup_id !== parsed.value.followupId) {
    redirectRecording(
      error?.message.toLowerCase().includes("contact")
        ? "Choose who this follow-up is with before saving it."
        : "That follow-up may already have been filed. Refresh the inbox and try again.",
      formData,
    );
  }
  revalidatePath("/recordings");
  revalidatePath("/movement");
  revalidatePath("/promises");
  if (parsed.value.contactId) revalidatePath(`/contacts/${parsed.value.contactId}`);
  for (const contactId of parsed.value.meetingContactIds) {
    revalidatePath(`/contacts/${contactId}`);
  }
  const messages = {
    approve: "Sent to the owner for review.",
    already_done: "Item marked already done.",
    decline: "Item declined.",
  } as const;
  redirectRecording(
    result.duplicate ? "That follow-up was already decided." : messages[parsed.value.outcome],
    formData,
  );
}
