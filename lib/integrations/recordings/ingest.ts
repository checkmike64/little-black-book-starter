import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  fetchFathomArtifact,
  listRecentFathomArtifactIds,
  markFathomOwnerAssigned,
} from "./fathom.ts";
import {
  fetchFirefliesArtifact,
  listRecentFirefliesArtifactIds,
} from "./fireflies.ts";
import {
  fetchNotionArtifact,
  observeNotionArtifact,
  NotionAuthorizationError,
  type NotionArtifactObservation,
  type NotionWebhookEvent,
  refreshNotionToken,
  scanRecentNotionArtifacts,
} from "./notion.ts";
import { createHash } from "node:crypto";
import type {
  NormalizedRecordingArtifact,
  RecordingConnectionSecret,
  RecordingProvider,
} from "./types.ts";
import { RecordingArtifactPendingError } from "./types.ts";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

type ClaimedRecordingReceipt = {
  id: string;
  tenant_id: string;
  connection_id: string;
  owner_user_id: string;
  provider: RecordingProvider;
  external_artifact_id: string;
  event_type: string;
  attempts: number;
  lock_token: string;
};

type FinishedReceipt = {
  status: "succeeded" | "failed" | "ignored";
  attempts: number;
  exhausted: boolean;
};

function safeFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "Recording import failed.";
  return message.replace(/[\r\n]+/g, " ").slice(0, 400);
}

async function finishRecordingReceipt({
  admin,
  receipt,
  status,
  error,
  ignoreOnExhaustion = false,
}: {
  admin: AdminClient;
  receipt: Pick<ClaimedRecordingReceipt, "id" | "lock_token">;
  status: "succeeded" | "retry" | "ignored";
  error?: unknown;
  ignoreOnExhaustion?: boolean;
}) {
  const { data, error: finishError } = await admin.rpc(
    "lbb_finish_recording_receipt",
    {
      p_receipt_id: receipt.id,
      p_lock_token: receipt.lock_token,
      p_status: status,
      p_error: error ? safeFailure(error) : null,
      p_ignore_on_exhaustion: ignoreOnExhaustion,
    },
  );
  if (finishError) throw new Error(`Recording receipt could not be finalized: ${finishError.message}`);
  return data as FinishedReceipt;
}

export async function failRecordingReceipt({
  admin,
  connection,
  receipt,
  error,
}: {
  admin: AdminClient;
  connection: RecordingConnectionSecret;
  receipt: ClaimedRecordingReceipt;
  error: unknown;
}) {
  const pending = error instanceof RecordingArtifactPendingError;
  const result = await finishRecordingReceipt({
    admin,
    receipt,
    status: "retry",
    error,
    ignoreOnExhaustion: pending,
  });
  const message = safeFailure(error);
  if (result.exhausted && !pending) {
    const { error: connectionError } = await admin
      .from("integration_connections")
      .update({ status: "needs_attention", last_error: message })
      .eq("tenant_id", connection.tenant_id)
      .eq("id", connection.connection_id)
      .eq("status", "active");
    if (connectionError) {
      throw new Error(`Recording connection health could not be updated: ${connectionError.message}`);
    }
  }
  console.error("recording_import_retry", {
    provider: connection.provider,
    connectionId: connection.connection_id,
    receiptId: receipt.id,
    attempts: result.attempts,
    exhausted: result.exhausted,
    pending,
    error: message,
  });
  return result;
}

export async function recordingConnectionSecret(
  connectionId: string,
  existingAdmin?: AdminClient,
  provider?: RecordingProvider,
) {
  const admin = existingAdmin ?? createSupabaseAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.rpc(
    provider === "notion"
      ? "lbb_notion_recording_connection_secrets"
      : "lbb_recording_connection_secrets",
    {
    p_connection_id: connectionId,
    },
  );
  if (error) throw new Error(`Recording connection could not be loaded: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as
    | RecordingConnectionSecret
    | null;
  if (!row || row.connection_status !== "active") return null;
  return { admin, connection: row };
}

export async function recordWebhookReceipt({
  admin,
  connection,
  externalEventId,
  externalArtifactId,
  eventType,
  payloadSha256,
}: {
  admin: AdminClient;
  connection: RecordingConnectionSecret;
  externalEventId: string;
  externalArtifactId: string;
  eventType: string;
  payloadSha256: string;
}) {
  const { data, error } = await admin.rpc("lbb_enqueue_recording_receipt", {
    p_tenant_id: connection.tenant_id,
    p_connection_id: connection.connection_id,
    p_owner_user_id: connection.owner_user_id,
    p_provider: connection.provider,
    p_external_event_id: externalEventId.slice(0, 320),
    p_external_artifact_id: externalArtifactId.slice(0, 320),
    p_event_type: eventType.slice(0, 120),
    p_payload_sha256: payloadSha256,
  });
  if (error) throw new Error(`Recording receipt could not be saved: ${error.message}`);
  const receipt = data as { id?: string; duplicate?: boolean } | null;
  if (!receipt?.id) throw new Error("Recording receipt could not be resolved.");
  return { id: receipt.id, duplicate: Boolean(receipt.duplicate) };
}

export async function acceptNotionWebhookEvent({
  admin,
  event,
  rawBody,
}: {
  admin: AdminClient;
  event: NotionWebhookEvent;
  rawBody: string;
}) {
  const { data, error } = await admin
    .from("integration_connections")
    .select("id")
    .eq("provider", "notion")
    .eq("status", "active")
    .eq("metadata->>workspace_id", event.workspaceId);
  if (error) throw new Error(`Notion webhook connections could not be resolved: ${error.message}`);

  const payloadSha256 = createHash("sha256").update(rawBody).digest("hex");
  const receipts: Array<{ id: string; duplicate: boolean }> = [];
  for (const row of data ?? []) {
    const resolved = await recordingConnectionSecret(String(row.id), admin, "notion");
    if (!resolved) continue;
    receipts.push(await recordWebhookReceipt({
      admin,
      connection: resolved.connection,
      externalEventId: event.id,
      externalArtifactId: event.entity.id,
      eventType: `notion.webhook:${event.entity.type}:${event.type}`,
      payloadSha256,
    }));
  }
  return {
    matchedConnections: (data ?? []).length,
    accepted: receipts.filter((receipt) => !receipt.duplicate).length,
    duplicates: receipts.filter((receipt) => receipt.duplicate).length,
  };
}

type NotionSyncTrigger = "scheduled" | "manual" | "webhook";

async function persistNotionSyncTelemetry({
  admin,
  connection,
  trigger,
  observations,
  enqueued,
  duplicates,
  hasMore,
  error,
}: {
  admin: AdminClient;
  connection: RecordingConnectionSecret;
  trigger: NotionSyncTrigger;
  observations: NotionArtifactObservation[];
  enqueued: number;
  duplicates: number;
  hasMore: boolean;
  error?: unknown;
}) {
  const observedAt = new Date().toISOString();
  const { data: row, error: readError } = await admin
    .from("integration_connections")
    .select("metadata")
    .eq("tenant_id", connection.tenant_id)
    .eq("id", connection.connection_id)
    .eq("provider", "notion")
    .maybeSingle();
  if (readError) throw new Error(`Notion sync telemetry could not be loaded: ${readError.message}`);
  const existingMetadata = row?.metadata && typeof row.metadata === "object"
    && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  const latestObservation = observations
    .map((observation) => observation.lastEditedAt ?? observation.occurredAt)
    .filter((value) => !Number.isNaN(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? observedAt;
  const failure = error ? safeFailure(error) : null;
  const { error: syncError } = await admin.rpc("lbb_record_notion_sync_result", {
    p_tenant_id: connection.tenant_id,
    p_connection_id: connection.connection_id,
    p_owner_user_id: connection.owner_user_id,
    p_trigger_source: trigger,
    p_checked_count: observations.length,
    p_ready_count: observations.filter((item) => item.readiness === "ready").length,
    p_pending_count: observations.filter((item) => item.readiness === "pending").length,
    p_enqueued_count: enqueued,
    p_last_event_at: trigger === "webhook" ? observedAt : null,
    p_last_imported_at: null,
    p_succeeded: !failure,
    p_error: failure,
  });
  if (syncError) throw new Error(`Notion sync state could not be saved: ${syncError.message}`);
  const { error: syncMetadataError } = await admin
    .from("recording_sync_state")
    .update({
      metadata: {
        duplicate_count: duplicates,
        result_set_truncated: hasMore,
        raw_provider_payload_stored: false,
      },
    })
    .eq("tenant_id", connection.tenant_id)
    .eq("connection_id", connection.connection_id);
  if (syncMetadataError) {
    throw new Error(`Notion sync metadata could not be saved: ${syncMetadataError.message}`);
  }
  const { error: updateError } = await admin
    .from("integration_connections")
    .update({
      sync_cursor: latestObservation,
      last_synced_at: observedAt,
      last_error: failure,
      metadata: {
        ...existingMetadata,
        notion_sync: {
          observed_at: observedAt,
          trigger,
          ready_count: observations.filter((item) => item.readiness === "ready").length,
          pending_count: observations.filter((item) => item.readiness === "pending").length,
          enqueued_count: enqueued,
          duplicate_count: duplicates,
          result_set_truncated: hasMore,
          ok: !failure,
        },
      },
    })
    .eq("tenant_id", connection.tenant_id)
    .eq("id", connection.connection_id)
    .eq("provider", "notion")
    .eq("status", "active");
  if (updateError) throw new Error(`Notion sync telemetry could not be saved: ${updateError.message}`);
}

async function notionObservations({
  admin,
  connection,
  since,
  artifactId,
}: {
  admin: AdminClient;
  connection: RecordingConnectionSecret;
  since: string;
  artifactId?: string;
}) {
  if (!connection.access_token) throw new Error("Notion authorization is unavailable.");
  const load = async (accessToken: string) => {
    if (artifactId) {
      const observation = await observeNotionArtifact({ accessToken, meetingNoteId: artifactId });
      return {
        observations: observation ? [observation] : [],
        hasMore: false,
      };
    }
    const scan = await scanRecentNotionArtifacts({ accessToken, since });
    return { observations: scan.observations, hasMore: scan.hasMore };
  };
  try {
    return await load(connection.access_token);
  } catch (caught) {
    if (!(caught instanceof NotionAuthorizationError) || !connection.refresh_token) throw caught;
    const refreshed = await refreshNotionToken(connection.refresh_token);
    const { error } = await admin.rpc("lbb_rotate_notion_recording_tokens", {
      p_connection_id: connection.connection_id,
      p_access_token: refreshed.access_token,
      p_refresh_token: refreshed.refresh_token ?? connection.refresh_token,
    });
    if (error) throw new Error("Notion authorization could not be refreshed.");
    return load(refreshed.access_token as string);
  }
}

export async function reconcileNotionArtifactReceipts({
  admin,
  connectionId,
  since = new Date(Date.now() - 3 * 86_400_000).toISOString(),
  artifactId,
  trigger = "manual",
  sourceEventId,
}: {
  admin: AdminClient;
  connectionId: string;
  since?: string;
  artifactId?: string;
  trigger?: NotionSyncTrigger;
  sourceEventId?: string;
}) {
  const resolved = await recordingConnectionSecret(connectionId, admin, "notion");
  if (!resolved) throw new Error("The Notion recording connection is not active.");
  let observations: NotionArtifactObservation[] = [];
  let hasMore = false;
  let enqueued = 0;
  let duplicates = 0;
  try {
    const result = await notionObservations({
      admin,
      connection: resolved.connection,
      since,
      artifactId,
    });
    observations = result.observations;
    hasMore = result.hasMore;
    for (const observation of observations) {
      if (observation.readiness !== "ready") continue;
      const sourceKey = sourceEventId
        ? createHash("sha256").update(sourceEventId).digest("hex").slice(0, 24)
        : trigger === "manual"
          ? createHash("sha256")
              .update(observation.lastEditedAt ?? observation.occurredAt)
              .digest("hex")
              .slice(0, 24)
          : "scheduled";
      const eventRef = trigger === "scheduled" && !sourceEventId
        ? `reconcile:notion:${observation.artifactId}`
        : `reconcile:notion:${sourceKey}:${observation.artifactId}`;
      const receipt = await recordWebhookReceipt({
        admin,
        connection: resolved.connection,
        externalEventId: eventRef,
        externalArtifactId: observation.artifactId,
        eventType: "daily.reconcile",
        payloadSha256: createHash("sha256").update(eventRef).digest("hex"),
      });
      if (receipt.duplicate) duplicates += 1;
      else enqueued += 1;
    }
    await persistNotionSyncTelemetry({
      admin,
      connection: resolved.connection,
      trigger,
      observations,
      enqueued,
      duplicates,
      hasMore,
    });
    return {
      checked: observations.length,
      ready: observations.filter((item) => item.readiness === "ready").length,
      pending: observations.filter((item) => item.readiness === "pending").length,
      enqueued,
      duplicates,
      hasMore,
      observations,
    };
  } catch (caught) {
    await persistNotionSyncTelemetry({
      admin,
      connection: resolved.connection,
      trigger,
      observations,
      enqueued,
      duplicates,
      hasMore,
      error: caught,
    });
    throw caught;
  }
}

async function matchedContactIds({
  admin,
  tenantId,
  emails,
}: {
  admin: AdminClient;
  tenantId: string;
  emails: string[];
}) {
  if (emails.length === 0) return [];
  const { data, error } = await admin
    .from("contacts")
    .select("id,email")
    .eq("tenant_id", tenantId)
    .is("archived_at", null)
    .in("email", emails);
  if (error) throw new Error("Meeting participants could not be matched safely.");
  return Array.from(new Set((data ?? []).map((contact) => contact.id as string)));
}

function normalizedTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(left: string, right: string) {
  const a = new Set(normalizedTitle(left).split(" ").filter((word) => word.length > 2));
  const b = new Set(normalizedTitle(right).split(" ").filter((word) => word.length > 2));
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((word) => b.has(word)).length;
  return overlap / Math.max(a.size, b.size);
}

async function calendarMatchedContactIds({
  admin,
  tenantId,
  ownerUserId,
  title,
  occurredAt,
}: {
  admin: AdminClient;
  tenantId: string;
  ownerUserId: string;
  title: string;
  occurredAt: string;
}) {
  const occurredMs = Date.parse(occurredAt);
  if (Number.isNaN(occurredMs)) return { ids: [] as string[], eventId: null };
  const { data: events, error } = await admin
    .from("calendar_events")
    .select("id,title,starts_at")
    .eq("tenant_id", tenantId)
    .eq("owner_user_id", ownerUserId)
    .gte("starts_at", new Date(occurredMs - 2 * 60 * 60 * 1_000).toISOString())
    .lte("starts_at", new Date(occurredMs + 2 * 60 * 60 * 1_000).toISOString())
    .limit(12);
  if (error) throw new Error("Meeting context could not be matched safely.");
  const ranked = (events ?? []).map((event) => {
    const timeDeltaMinutes = Math.abs(Date.parse(event.starts_at as string) - occurredMs) / 60_000;
    const similarity = titleSimilarity(title, String(event.title ?? ""));
    const score = similarity * 100 - timeDeltaMinutes / 4;
    return { event, score, similarity, timeDeltaMinutes };
  }).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  const reliable = Boolean(
    best
      && best.timeDeltaMinutes <= 90
      && (best.similarity >= 0.45 || best.timeDeltaMinutes <= 12)
      && (!runnerUp || best.score - runnerUp.score >= 8),
  );
  if (!best || !reliable) return { ids: [] as string[], eventId: null };
  const { data: attendees, error: attendeeError } = await admin
    .from("calendar_attendees")
    .select("matched_contact_id,is_organizer")
    .eq("tenant_id", tenantId)
    .eq("owner_user_id", ownerUserId)
    .eq("event_id", best.event.id)
    .not("matched_contact_id", "is", null);
  if (attendeeError) throw new Error("Meeting attendees could not be matched safely.");
  return {
    ids: Array.from(new Set((attendees ?? [])
      .filter((attendee) => !attendee.is_organizer)
      .map((attendee) => attendee.matched_contact_id as string)
      .filter(Boolean))),
    eventId: best.event.id as string,
  };
}

export async function processRecordingArtifact({
  admin,
  connection,
  artifact,
}: {
  admin: AdminClient;
  connection: RecordingConnectionSecret;
  artifact: NormalizedRecordingArtifact;
}) {
  if (artifact.provider !== connection.provider) {
    throw new Error("Recording provider does not match the connection.");
  }
  const [{ data: tenant, error: tenantError }, emailContactIds, calendarMatch] = await Promise.all([
    admin.from("tenants").select("settings").eq("id", connection.tenant_id).single(),
    matchedContactIds({
      admin,
      tenantId: connection.tenant_id,
      emails: artifact.participantEmails,
    }),
    calendarMatchedContactIds({
      admin,
      tenantId: connection.tenant_id,
      ownerUserId: connection.owner_user_id,
      title: artifact.title,
      occurredAt: artifact.occurredAt,
    }),
  ]);
  if (tenantError) throw new Error(`Tenant settings could not be loaded: ${tenantError.message}`);
  const settings = normalizeTenantSettings(tenant?.settings);
  const rawDays = Math.min(30, Math.max(0, settings.retention?.raw_transcript_days ?? 0));
  const retentionUntil = rawDays
    ? new Date(Date.now() + rawDays * 86_400_000).toISOString().slice(0, 10)
    : null;
  const contactIds = Array.from(new Set([...emailContactIds, ...calendarMatch.ids]));
  const { data, error } = await admin.rpc("lbb_record_meeting_artifact", {
    p_tenant_id: connection.tenant_id,
    p_connection_id: connection.connection_id,
    p_owner_user_id: connection.owner_user_id,
    p_provider: artifact.provider,
    p_external_artifact_id: artifact.externalArtifactId,
    p_title: artifact.title,
    p_occurred_at: artifact.occurredAt,
    p_duration_seconds: artifact.durationSeconds,
    p_recording_url: artifact.recordingUrl,
    p_distilled_summary: artifact.distilledSummary,
    p_transcript_sha256: artifact.transcriptSha256,
    p_retention_until: retentionUntil,
    p_contact_ids: contactIds,
    p_action_items: artifact.actionItems,
    p_metadata: {
      ...artifact.metadata,
      participant_names: artifact.participantNames,
      participant_email_count: artifact.participantEmails.length,
      matched_contact_count: contactIds.length,
      calendar_match_event_id: calendarMatch.eventId,
      contact_match_basis: calendarMatch.eventId
        ? "provider_participants_and_calendar"
        : "provider_participants",
      evidence_grade: "proposal",
    },
  });
  if (error) throw new Error(error.message);
  return data as { id?: string; duplicate?: boolean } | null;
}

async function artifactForReceipt({
  connection,
  receipt,
}: {
  connection: RecordingConnectionSecret;
  receipt: ClaimedRecordingReceipt;
}) {
  if (!connection.external_account_email) {
    throw new Error("The authorized recording owner email is unavailable.");
  }
  if (receipt.provider === "notion") {
    if (!connection.access_token) {
      throw new Error("Notion authorization is unavailable.");
    }
    try {
      return await fetchNotionArtifact({
        accessToken: connection.access_token,
        meetingNoteId: receipt.external_artifact_id,
      });
    } catch (caught) {
      if (!(caught instanceof NotionAuthorizationError) || !connection.refresh_token) throw caught;
      const refreshed = await refreshNotionToken(connection.refresh_token);
      const { error } = await createSupabaseAdminClient()?.rpc(
        "lbb_rotate_notion_recording_tokens",
        {
          p_connection_id: connection.connection_id,
          p_access_token: refreshed.access_token,
          p_refresh_token: refreshed.refresh_token ?? connection.refresh_token,
        },
      ) ?? { error: new Error("The private data connection is unavailable.") };
      if (error) throw new Error("Notion authorization could not be refreshed.");
      return fetchNotionArtifact({
        accessToken: refreshed.access_token as string,
        meetingNoteId: receipt.external_artifact_id,
      });
    }
  }
  if (!connection.api_key) throw new Error("Recording provider API key is unavailable.");
  if (receipt.provider === "fireflies") {
    return fetchFirefliesArtifact({
      apiKey: connection.api_key,
      meetingId: receipt.external_artifact_id,
      ownerEmail: connection.external_account_email,
    });
  }
  if (receipt.provider === "fathom") {
    return fetchFathomArtifact({
      apiKey: connection.api_key,
      recordingId: receipt.external_artifact_id,
      ownerEmail: connection.external_account_email,
    });
  }
  throw new Error("Automated artifact fetching is not enabled for this source.");
}

export async function processQueuedRecordingReceipts({
  admin,
  limit = 20,
}: {
  admin: AdminClient;
  limit?: number;
}) {
  const { data, error } = await admin.rpc("lbb_claim_recording_receipts", {
    p_limit: Math.min(100, Math.max(1, limit)),
    p_lease_seconds: 600,
  });
  if (error) throw new Error(`Recording queue could not be claimed: ${error.message}`);
  const receipts = (data ?? []) as ClaimedRecordingReceipt[];
  const outcomes: Array<{
    id: string;
    tenant_id: string;
    provider: RecordingProvider;
    ok: boolean;
    status: string;
    error?: string;
  }> = [];
  for (const receipt of receipts) {
    let resolved: Awaited<ReturnType<typeof recordingConnectionSecret>> = null;
    try {
      resolved = await recordingConnectionSecret(receipt.connection_id, admin, receipt.provider);
      if (!resolved) {
        await finishRecordingReceipt({
          admin,
          receipt,
          status: "ignored",
          error: new Error("Recording connection is no longer active."),
        });
        outcomes.push({
          id: receipt.id,
          tenant_id: receipt.tenant_id,
          provider: receipt.provider,
          ok: true,
          status: "ignored",
        });
        continue;
      }
      if (
        receipt.provider === "notion"
        && receipt.event_type.startsWith("notion.webhook:")
      ) {
        const entityType = receipt.event_type.split(":", 3)[1];
        await reconcileNotionArtifactReceipts({
          admin,
          connectionId: receipt.connection_id,
          artifactId: entityType === "block" ? receipt.external_artifact_id : undefined,
          trigger: "webhook",
          sourceEventId: receipt.id,
        });
        await finishRecordingReceipt({ admin, receipt, status: "succeeded" });
        outcomes.push({
          id: receipt.id,
          tenant_id: receipt.tenant_id,
          provider: receipt.provider,
          ok: true,
          status: "succeeded",
        });
        continue;
      }
      const fetchedArtifact = await artifactForReceipt({ connection: resolved.connection, receipt });
      const artifact = markFathomOwnerAssigned(
        fetchedArtifact,
        resolved.connection.external_account_email,
      );
      await processRecordingArtifact({ admin, connection: resolved.connection, artifact });
      if (receipt.provider === "notion") {
        const { error: importedAtError } = await admin
          .from("recording_sync_state")
          .update({ last_imported_at: new Date().toISOString() })
          .eq("tenant_id", resolved.connection.tenant_id)
          .eq("connection_id", resolved.connection.connection_id);
        if (importedAtError) {
          throw new Error(`Notion import telemetry could not be saved: ${importedAtError.message}`);
        }
      }
      await finishRecordingReceipt({ admin, receipt, status: "succeeded" });
      outcomes.push({
        id: receipt.id,
        tenant_id: receipt.tenant_id,
        provider: receipt.provider,
        ok: true,
        status: "succeeded",
      });
    } catch (caught) {
      const message = safeFailure(caught);
      if (resolved) {
        const result = await failRecordingReceipt({
          admin,
          connection: resolved.connection,
          receipt,
          error: caught,
        });
        outcomes.push({
          id: receipt.id,
          tenant_id: receipt.tenant_id,
          provider: receipt.provider,
          ok: false,
          status: result.status,
          error: message,
        });
      } else {
        await finishRecordingReceipt({
          admin,
          receipt,
          status: "retry",
          error: caught,
        });
        outcomes.push({
          id: receipt.id,
          tenant_id: receipt.tenant_id,
          provider: receipt.provider,
          ok: false,
          status: "failed",
          error: message,
        });
      }
    }
  }
  return {
    claimed: receipts.length,
    succeeded: outcomes.filter((outcome) => outcome.status === "succeeded").length,
    ignored: outcomes.filter((outcome) => outcome.status === "ignored").length,
    retrying: outcomes.filter((outcome) => !outcome.ok).length,
    outcomes,
  };
}

export async function reconcileRecordingProviderReceipts({
  admin,
  since = new Date(Date.now() - 3 * 86_400_000).toISOString(),
  providers = ["fireflies", "fathom", "notion"],
}: {
  admin: AdminClient;
  since?: string;
  providers?: RecordingProvider[];
}) {
  const { data, error } = await admin
    .from("integration_connections")
    .select("id, tenant_id, provider")
    .in("provider", providers)
    .eq("status", "active");
  if (error) throw new Error(`Recording connections could not be reconciled: ${error.message}`);
  let checked = 0;
  let enqueued = 0;
  let failed = 0;
  const outcomes: Array<{
    tenant_id: string;
    connection_id: string;
    checked: number;
    enqueued: number;
    ok: boolean;
  }> = [];
  for (const row of data ?? []) {
    try {
      const provider = row.provider as RecordingProvider;
      if (provider === "notion") {
        const result = await reconcileNotionArtifactReceipts({
          admin,
          connectionId: row.id as string,
          since,
          trigger: "scheduled",
        });
        checked += result.checked;
        enqueued += result.enqueued;
        outcomes.push({
          tenant_id: row.tenant_id as string,
          connection_id: row.id as string,
          checked: result.checked,
          enqueued: result.enqueued,
          ok: true,
        });
        continue;
      }
      const resolved = await recordingConnectionSecret(row.id as string, admin, provider);
      if (!resolved?.connection.external_account_email) {
        throw new Error("The authorized recording owner email is unavailable.");
      }
      if (!resolved.connection.api_key) {
        throw new Error("Recording provider API key is unavailable.");
      }
      const artifactIds = provider === "fireflies"
        ? await listRecentFirefliesArtifactIds({
            apiKey: resolved.connection.api_key,
            since,
            ownerEmail: resolved.connection.external_account_email,
          })
        : await listRecentFathomArtifactIds({
            apiKey: resolved.connection.api_key,
            since,
            ownerEmail: resolved.connection.external_account_email,
          });
      checked += artifactIds.length;
      let connectionEnqueued = 0;
      for (const artifactId of artifactIds) {
        const eventRef = `reconcile:${row.provider}:${artifactId}`;
        const receipt = await recordWebhookReceipt({
          admin,
          connection: resolved.connection,
          externalEventId: eventRef,
          externalArtifactId: artifactId,
          eventType: "daily.reconcile",
          payloadSha256: createHash("sha256").update(eventRef).digest("hex"),
        });
        if (!receipt.duplicate) {
          enqueued += 1;
          connectionEnqueued += 1;
        }
      }
      outcomes.push({
        tenant_id: row.tenant_id as string,
        connection_id: row.id as string,
        checked: artifactIds.length,
        enqueued: connectionEnqueued,
        ok: true,
      });
    } catch (caught) {
      failed += 1;
      outcomes.push({
        tenant_id: row.tenant_id as string,
        connection_id: row.id as string,
        checked: 0,
        enqueued: 0,
        ok: false,
      });
      console.error("recording_reconciliation_failed", {
        connectionId: row.id,
        provider: row.provider,
        error: safeFailure(caught),
      });
    }
  }
  return { connections: (data ?? []).length, checked, enqueued, failed, outcomes };
}

export function isRecordingProvider(value: string): value is RecordingProvider {
  return value === "fireflies"
    || value === "fathom"
    || value === "google_meet"
    || value === "notion";
}
