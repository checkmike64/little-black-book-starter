import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TenantContext } from "@/lib/tenant-context";
import { shouldUseAdminTools } from "@/lib/admin-mode";
import {
  exactCalendarPreferenceRowsAreComplete,
  ignoredCalendarAttendeeEmails,
  calendarAttendeeEmailIsIgnored,
} from "@/lib/calendar-attendee-preferences";

export type RecordingConnectionRow = {
  id: string;
  user_id: string;
  provider: "fireflies" | "fathom" | "google_meet" | "notion";
  status: "active" | "needs_attention" | "disconnected";
  external_account_email: string | null;
  scopes: string[];
  last_synced_at: string | null;
  last_error: string | null;
  consent_version: string | null;
  authorization_attested_at: string | null;
  upstream_revoke_status: "not_applicable" | "active" | "cleanup_pending" | "revoked";
  metadata: Record<string, unknown>;
};

export type RecordingRow = {
  id: string;
  owner_user_id: string | null;
  title: string | null;
  source: string | null;
  external_artifact_id: string | null;
  occurred_at: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  distilled_summary: string | null;
  action_items: Array<{ text?: string; assignee?: string | null }>;
  processing_status: string;
  metadata: Record<string, unknown>;
  updated_at: string;
};

export type RecordingContactOption = {
  id: string;
  full_name: string;
  company_name: string | null;
  email: string | null;
};

export type RecordingFollowupRow = {
  id: string;
  transcript_id: string;
  source_item_index: number;
  followup_text: string;
  assignee: string | null;
  assignee_email: string | null;
  owner_assigned: boolean;
  status: "proposed" | "pending" | "routed" | "completed" | "dismissed";
  route: "action" | "owner_promise" | "contact_promise" | "context" | "already_done" | "dismiss" | null;
  contact_id: string | null;
  due_on: string | null;
  resolution_note: string | null;
  target_table: string | null;
  target_id: string | null;
  resolved_at: string | null;
  source: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type RecordingCalendarAttendeeRow = {
  id: string;
  event_id: string;
  owner_user_id: string;
  display_name: string | null;
  normalized_email: string;
  is_organizer: boolean;
  matched_contact_id: string | null;
  matched_want_to_know_id: string | null;
  ignored_by_owner: boolean;
};

export type RecordingSyncStateRow = {
  connection_id: string;
  provider: string;
  last_checked_at: string | null;
  last_succeeded_at: string | null;
  last_event_at: string | null;
  last_imported_at: string | null;
  checked_count: number | null;
  ready_count: number | null;
  pending_count: number | null;
  enqueued_count: number | null;
  trigger_source: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
};

export type RecordingQueueHealth = {
  id: string;
  connection_id: string;
  provider: string;
  status: string;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  received_at: string;
};

export async function getRecordingsData({
  context,
  adminCookieValue,
}: {
  context: TenantContext | null;
  adminCookieValue?: string | null;
}) {
  if (!context || context.role !== "operator") {
    return {
      context,
      connections: [],
      recordings: [],
      contactOptions: [],
      contactOptionsIncomplete: true,
      followups: [],
      followupsLoadError: true,
      calendarAttendees: [],
      calendarAttendeesLoadError: true,
      syncStates: [],
      syncStateLoadError: true,
      notionWebhookToken: null,
      notionWebhookTokenLoadError: true,
      queueHealth: [],
      operatorIsStoredOwner: false,
      loadError: true,
    };
  }
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      context,
      connections: [],
      recordings: [],
      contactOptions: [],
      contactOptionsIncomplete: true,
      followups: [],
      followupsLoadError: true,
      calendarAttendees: [],
      calendarAttendeesLoadError: true,
      syncStates: [],
      syncStateLoadError: true,
      notionWebhookToken: null,
      notionWebhookTokenLoadError: true,
      queueHealth: [],
      operatorIsStoredOwner: false,
      loadError: true,
    };
  }
  const connectionsQuery = admin
      .from("integration_connections")
      .select(
        "id,user_id,provider,status,external_account_email,scopes,last_synced_at,last_error,consent_version,authorization_attested_at,upstream_revoke_status,metadata",
      )
      .eq("tenant_id", context.tenantId)
      .in("provider", ["fireflies", "fathom", "google_meet", "notion"])
      .order("created_at", { ascending: true });
  const recordingsQuery = admin
      .from("transcripts")
      .select(
        "id,owner_user_id,title,source,external_artifact_id,occurred_at,duration_seconds,recording_url,distilled_summary,action_items,processing_status,metadata,updated_at",
      )
      .eq("tenant_id", context.tenantId)
      .in("source", ["fireflies", "fathom", "google_meet", "notion"])
      .order("occurred_at", { ascending: false })
      .limit(100);
  const followupsQuery = admin
    .from("recording_followups")
    .select(
      "id,transcript_id,source_item_index,followup_text,assignee,assignee_email,owner_assigned,status,route,contact_id,due_on,resolution_note,target_table,target_id,resolved_at,source,metadata,created_at",
    )
    .eq("tenant_id", context.tenantId)
    .order("created_at", { ascending: true })
    .limit(3_000);
  const [
    connectionsResult,
    recordingsResult,
    contactsResult,
    followupsResult,
    syncStatesResult,
    operatorMembershipResult,
  ] = await Promise.all([
    connectionsQuery,
    recordingsQuery,
    admin
      .from("contacts")
      .select("id,full_name,company_name,email", { count: "exact" })
      .eq("tenant_id", context.tenantId)
      .is("archived_at", null)
      .order("full_name", { ascending: true })
      .limit(500),
    followupsQuery,
    admin
      .from("recording_sync_state")
      .select(
        "connection_id,provider,last_checked_at,last_succeeded_at,last_event_at,last_imported_at,checked_count,ready_count,pending_count,enqueued_count,trigger_source,last_error,metadata",
      )
      .eq("tenant_id", context.tenantId),
    admin
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", context.tenantId)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  const recordings = (recordingsResult.data ?? []) as RecordingRow[];
  const connections = (connectionsResult.data ?? []) as RecordingConnectionRow[];
  const primarySyncStates = (syncStatesResult.data ?? []) as RecordingSyncStateRow[];
  const syncStateByConnection = new Map(
    primarySyncStates.map((state) => [state.connection_id, state]),
  );
  if (!syncStatesResult.error) {
    for (const connection of connections) {
      if (connection.provider !== "notion" || syncStateByConnection.has(connection.id)) continue;
      const notionSync = connection.metadata?.notion_sync;
      if (!notionSync || typeof notionSync !== "object" || Array.isArray(notionSync)) continue;
      const legacy = notionSync as Record<string, unknown>;
      const observedAt = typeof legacy.observed_at === "string" ? legacy.observed_at : null;
      const count = (value: unknown) => typeof value === "number" ? value : null;
      syncStateByConnection.set(connection.id, {
        connection_id: connection.id,
        provider: "notion",
        last_checked_at: observedAt,
        last_succeeded_at: legacy.ok === true ? observedAt : null,
        last_event_at: null,
        last_imported_at: connection.last_synced_at,
        checked_count:
          count(legacy.ready_count) !== null && count(legacy.pending_count) !== null
            ? (count(legacy.ready_count) as number) + (count(legacy.pending_count) as number)
            : null,
        ready_count: count(legacy.ready_count),
        pending_count: count(legacy.pending_count),
        enqueued_count: count(legacy.enqueued_count),
        trigger_source: typeof legacy.trigger === "string" ? legacy.trigger : null,
        last_error: legacy.ok === false ? connection.last_error : null,
        metadata: {
          result_set_truncated: legacy.result_set_truncated === true,
        },
      });
    }
  }
  const adminMode = shouldUseAdminTools({
    cookieValue: adminCookieValue,
    role: context.role,
  });
  const queueResult = adminMode
    ? await admin
        .from("recording_ingest_receipts")
        .select("id,connection_id,provider,status,attempts,next_attempt_at,last_error,received_at")
        .eq("tenant_id", context.tenantId)
        .order("received_at", { ascending: false })
        .limit(20)
    : { data: [], error: null };
  const notionWebhookSetupWindowOpen = Boolean(
    process.env.NOTION_WEBHOOK_SETUP_SECRET?.trim(),
  );
  const notionWebhookTokenResult = adminMode && notionWebhookSetupWindowOpen
    ? await admin.rpc("lbb_notion_webhook_token")
    : { data: null, error: null };
  const calendarEventIds = Array.from(new Set(
    recordings
      .map((recording) => recording.metadata?.calendar_match_event_id)
      .filter((value): value is string => (
        typeof value === "string"
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      )),
  ));
  const recordingOwnerUserIds = Array.from(new Set(
    recordings
      .map((recording) => recording.owner_user_id)
      .filter((value): value is string => Boolean(value)),
  ));
  const calendarAttendeesResult = calendarEventIds.length
    ? await admin
        .from("calendar_attendees")
        .select(
          "id,event_id,owner_user_id,display_name,normalized_email,is_organizer,matched_contact_id,matched_want_to_know_id",
          { count: "exact" },
        )
        .eq("tenant_id", context.tenantId)
        .in("event_id", calendarEventIds)
        .order("display_name", { ascending: true })
        .limit(500)
    : { data: [], error: null, count: 0 };
  const calendarAttendeePreferencesResult = calendarEventIds.length && recordingOwnerUserIds.length
    ? await admin
        .from("calendar_attendee_preferences")
        .select("user_id,normalized_email,decision", { count: "exact" })
        .eq("tenant_id", context.tenantId)
        .in("user_id", recordingOwnerUserIds)
        .eq("decision", "ignore")
        .limit(500)
    : { data: [], error: null, count: 0 };
  const calendarAttendeePreferencesIncomplete =
    Boolean(calendarAttendeePreferencesResult.error)
    || !exactCalendarPreferenceRowsAreComplete(
      calendarAttendeePreferencesResult.count,
      calendarAttendeePreferencesResult.data?.length ?? 0,
    );
  const calendarAttendeesIncomplete =
    Boolean(calendarAttendeesResult.error)
    || !exactCalendarPreferenceRowsAreComplete(
      calendarAttendeesResult.count,
      calendarAttendeesResult.data?.length ?? 0,
    );
  const ignoredAttendeeEmailsByOwner = new Map<string, ReadonlySet<string>>();
  for (const ownerUserId of recordingOwnerUserIds) {
    ignoredAttendeeEmailsByOwner.set(
      ownerUserId,
      ignoredCalendarAttendeeEmails(
        (calendarAttendeePreferencesResult.data ?? []).filter(
          (preference) => preference.user_id === ownerUserId,
        ),
      ),
    );
  }
  const calendarAttendees = calendarAttendeePreferencesIncomplete
    ? []
    : ((calendarAttendeesResult.data ?? []) as Omit<
        RecordingCalendarAttendeeRow,
        "ignored_by_owner"
      >[]).map((attendee) => ({
        ...attendee,
        ignored_by_owner: calendarAttendeeEmailIsIgnored(
          attendee.normalized_email,
          ignoredAttendeeEmailsByOwner.get(attendee.owner_user_id) ?? new Set<string>(),
        ),
      }));
  return {
    context,
    connections,
    recordings,
    contactOptions: (contactsResult.data ?? []) as RecordingContactOption[],
    contactOptionsIncomplete:
      Boolean(contactsResult.error)
      || (contactsResult.count ?? 0) > (contactsResult.data?.length ?? 0),
    followups: (followupsResult.data ?? []) as RecordingFollowupRow[],
    followupsLoadError: Boolean(followupsResult.error),
    calendarAttendees,
    calendarAttendeesLoadError:
      calendarAttendeesIncomplete
      || calendarAttendeePreferencesIncomplete
      || recordingOwnerUserIds.length === 0,
    syncStates: [...syncStateByConnection.values()],
    syncStateLoadError: Boolean(syncStatesResult.error),
    notionWebhookToken:
      typeof notionWebhookTokenResult.data === "string"
        ? notionWebhookTokenResult.data
        : null,
    notionWebhookTokenLoadError: Boolean(notionWebhookTokenResult.error),
    queueHealth: (queueResult.data ?? []) as RecordingQueueHealth[],
    operatorIsStoredOwner: operatorMembershipResult.data?.role === "owner",
    loadError: Boolean(
      connectionsResult.error
      || recordingsResult.error
      || contactsResult.error
      || followupsResult.error
      || syncStatesResult.error
      || calendarAttendeesResult.error
      || calendarAttendeePreferencesResult.error
      || calendarAttendeePreferencesIncomplete
      || queueResult.error
      || operatorMembershipResult.error
    ),
  };
}
