import Link from "next/link";
import { cookies } from "next/headers";
import { ExternalLink, Mic2, RefreshCw, ShieldCheck } from "lucide-react";
import {
  acceptRecordingNotes,
  configureRecordingConnection,
  confirmRecordingPeople,
  confirmRecordingWebhookRemoved,
  disconnectRecordingConnection,
  dismissRecordingNotes,
  recoverNotionMeeting,
  routeRecordingFollowup,
  syncNotionMeetings,
} from "@/app/(portal)/recordings/actions";
import { adminToolsCookieName, shouldUseAdminTools } from "@/lib/admin-mode";
import { calendarAttendeeNeedsBookDecision } from "@/lib/calendar-attendee-preferences";
import { requireOperatorAccess } from "@/lib/operator-access";
import { getRecordingsData } from "@/lib/recordings/data";
import {
  followupInferenceLabel,
  inferRecordingFollowup,
  meetingContactIdsForInference,
} from "@/lib/recordings/followup-inference";
import { recordingInboxView } from "@/lib/recordings/followup-routing";

const providerLabels = {
  fireflies: "Fireflies",
  fathom: "Fathom",
  notion: "Notion AI Meeting Notes",
} as const;

function providerLabel(value: string | null) {
  if (!value) return "Meeting";
  return providerLabels[value as keyof typeof providerLabels] ?? "Imported meeting notes";
}

function readableDate(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function duration(minutes: number | null) {
  if (!minutes) return "";
  return `${Math.max(1, Math.round(minutes / 60))} min`;
}

function followupRouteLabel(value: string | null) {
  if (value === "action") return "Filed";
  if (value === "owner_promise") return "I promised";
  if (value === "contact_promise") return "They promised";
  if (value === "context") return "Context";
  if (value === "already_done") return "Already done";
  if (value === "dismiss") return "Dismissed";
  return "Filed";
}

export default async function RecordingsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const operatorContext = await requireOperatorAccess();
  const params = searchParams ? await searchParams : {};
  const message = Array.isArray(params.message) ? params.message[0] : params.message;
  const view = recordingInboxView(Array.isArray(params.view) ? params.view[0] : params.view);
  const cookieStore = await cookies();
  const {
    context,
    connections,
    recordings,
    contactOptions,
    contactOptionsIncomplete,
    followups,
    followupsLoadError,
    calendarAttendees,
    calendarAttendeesLoadError,
    syncStates,
    syncStateLoadError,
    notionWebhookToken,
    notionWebhookTokenLoadError,
    queueHealth,
    operatorIsStoredOwner,
    loadError,
  } = await getRecordingsData({
    context: operatorContext,
    adminCookieValue: cookieStore.get(adminToolsCookieName)?.value,
  });
  const adminMode = shouldUseAdminTools({
    cookieValue: cookieStore.get(adminToolsCookieName)?.value,
    role: context?.role,
  });
  const siteHost = process.env.NEXT_PUBLIC_SITE_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "");
  const siteOrigin = siteHost.replace(/\/$/, "");
  const notionWebhookSetupSecret = process.env.NOTION_WEBHOOK_SETUP_SECRET?.trim() ?? "";
  const followupsByTranscript = new Map<string, typeof followups>();
  for (const followup of followups) {
    const rows = followupsByTranscript.get(followup.transcript_id) ?? [];
    rows.push(followup);
    followupsByTranscript.set(followup.transcript_id, rows);
  }
  const calendarAttendeesByEvent = new Map<string, typeof calendarAttendees>();
  for (const attendee of calendarAttendees) {
    const rows = calendarAttendeesByEvent.get(attendee.event_id) ?? [];
    rows.push(attendee);
    calendarAttendeesByEvent.set(attendee.event_id, rows);
  }
  const activeContactIds = new Set(contactOptions.map((contact) => contact.id));
  const contactById = new Map(contactOptions.map((contact) => [contact.id, contact]));
  function inboxViewFor(recording: (typeof recordings)[number]) {
    const hasUnresolvedItems = (followupsByTranscript.get(recording.id) ?? []).some(
      (followup) => followup.status === "proposed" || followup.status === "pending",
    );
    const confirmedContactIds = Array.isArray(recording.metadata?.confirmed_contact_ids)
      ? recording.metadata.confirmed_contact_ids.filter(
          (id): id is string => typeof id === "string" && activeContactIds.has(id),
        )
      : [];
    const needsPeopleRepair =
      recording.processing_status === "ready"
      && (contactOptionsIncomplete || confirmedContactIds.length === 0);
    return recording.processing_status === "review" || hasUnresolvedItems || needsPeopleRepair
      ? "to_process" as const
      : "processed" as const;
  }
  const inboxCounts = {
    to_process: recordings.filter((recording) => inboxViewFor(recording) === "to_process").length,
    processed: recordings.filter((recording) => inboxViewFor(recording) === "processed").length,
  };
  const visibleRecordings = followupsLoadError
    ? []
    : recordings.filter((recording) => inboxViewFor(recording) === view);
  const returnTo = `/recordings?view=${view}`;

  return (
    <>
      <div className="crumb">Client Admin</div>
      <div className="recordings-heading">
        <div>
          <h1 className="portal-title">Recording administration</h1>
          <p className="lede">
            Review meeting-source connections, import health, and processing status.
          </p>
        </div>
        <div className="recording-privacy-seal">
          <ShieldCheck aria-hidden="true" />
          <span><b>No audio or video copied</b>Distilled notes only by default</span>
        </div>
      </div>
      {message ? <div className="notice" role="status">{message}</div> : null}
      {loadError ? (
        <div className="notice">Meeting sources could not be refreshed. Existing notes are unchanged.</div>
      ) : null}

      <section aria-labelledby="meeting-sources-heading">
        <div className="section-heading-row">
          <div>
            <h2 id="meeting-sources-heading">Meeting sources</h2>
            <p className="muted">One private timeline, regardless of which recorder produced the notes.</p>
          </div>
        </div>
        <div className="recording-source-grid">
          {(["notion", "fireflies", "fathom"] as const).map((provider) => {
            const connection = connections.find((item) => item.provider === provider);
            const connected = connection?.status === "active";
            const notionSync = provider === "notion" && connection
              ? syncStates.find((item) => item.connection_id === connection.id)
              : null;
            const operatorCanSyncNotion = provider === "notion" && connected;
            return (
              <article className="card recording-source-card" key={provider}>
                <div className="recording-source-title">
                  <Mic2 aria-hidden="true" />
                  <div><h3>{providerLabels[provider]}</h3><p>{connection?.external_account_email ?? "Not connected"}</p></div>
                  <span className={connected ? "status-ok" : connection?.status === "needs_attention" ? "status-warn" : "status-neutral"}>
                    {connected ? "Connected" : connection?.status === "needs_attention" ? "Needs attention" : "Available"}
                  </span>
                </div>
                <dl className="recording-source-facts">
                  <div>
                    <dt>{provider === "notion" ? "Last successful check" : "Imported through"}</dt>
                    <dd>{readableDate(provider === "notion" ? notionSync?.last_succeeded_at ?? null : connection?.last_synced_at ?? null)}</dd>
                  </div>
                  <div><dt>Authorized scope</dt><dd>{connection?.scopes?.[0] === "team_recordings" ? "Team recordings" : connection?.scopes?.[0] === "manual_notes" ? "Manual notes" : "My recordings"}</dd></div>
                  {provider === "notion" ? (
                    <>
                      <div><dt>Last checked</dt><dd>{syncStateLoadError ? "Unknown" : readableDate(notionSync?.last_checked_at ?? null)}</dd></div>
                      <div><dt>Ready / still preparing</dt><dd>{syncStateLoadError || !notionSync ? "Unknown" : `${notionSync.ready_count ?? "?"} / ${notionSync.pending_count ?? "?"}`}</dd></div>
                      <div><dt>Last import</dt><dd>{syncStateLoadError ? "Unknown" : readableDate(notionSync?.last_imported_at ?? null)}</dd></div>
                    </>
                  ) : null}
                </dl>
                {connection?.last_error ? <p className="source-warning">{connection.last_error}</p> : null}
                {provider === "notion" && notionSync?.last_error ? <p className="source-warning">{notionSync.last_error}</p> : null}
                {provider === "notion" && notionSync?.metadata?.result_set_truncated === true ? (
                  <p className="source-warning">Notion returned more than 50 recent notes. Use Missing a meeting for an item that is not shown.</p>
                ) : null}
                {connection?.upstream_revoke_status === "cleanup_pending" ? <p className="source-warning">Local access is off. The provider webhook still needs to be removed.</p> : null}
                {adminMode && provider === "fireflies" && connection?.upstream_revoke_status === "cleanup_pending" ? (
                  <form action={confirmRecordingWebhookRemoved}>
                    <input name="connection_id" type="hidden" value={connection.id} />
                    <button className="button quiet" type="submit">I removed the Fireflies webhook</button>
                  </form>
                ) : null}
                {adminMode && connection && siteOrigin && (provider === "fireflies" || provider === "fathom") ? (
                  <label className="recording-webhook-url">
                    <span>Provider webhook URL</span>
                    <input
                      readOnly
                      value={`${siteOrigin}/api/integrations/recordings/${provider}/${connection.id}`}
                    />
                  </label>
                ) : null}
                {provider === "notion" && !connected && context && operatorIsStoredOwner ? (
                  <div className="recording-item-actions">
                    <Link className="button" href="/api/integrations/notion/connect">Connect Notion</Link>
                    <span className="source-note">Imports only meeting notes where your connected Notion user is an attendee.</span>
                  </div>
                ) : provider === "notion" && !connected && context ? (
                  <p className="source-note">
                    The client owner must sign in once to authorize Notion. The operator cannot own the client integration.
                  </p>
                ) : null}
                {operatorCanSyncNotion && connection ? (
                  <div className="recording-notion-controls">
                    <form action={syncNotionMeetings}>
                      <input name="connection_id" type="hidden" value={connection.id} />
                      <input name="return_to" type="hidden" value={returnTo} />
                      <button className="button quiet" type="submit">
                        <RefreshCw aria-hidden="true" />
                        Check now
                      </button>
                    </form>
                    <details className="disconnect-panel">
                      <summary>Missing a meeting?</summary>
                      <p>Paste the Notion meeting-note link to queue that one item for private review.</p>
                      <form action={recoverNotionMeeting} className="recording-recovery-form">
                        <input name="connection_id" type="hidden" value={connection.id} />
                        <input name="return_to" type="hidden" value={returnTo} />
                        <label className="field">
                          <span>Notion meeting link or ID</span>
                          <input name="notion_meeting" placeholder="https://www.notion.so/..." required />
                        </label>
                        <button className="button quiet" type="submit">Queue meeting</button>
                      </form>
                    </details>
                  </div>
                ) : null}
                {connection && connection.status !== "disconnected" ? (
                  <details className="disconnect-panel">
                    <summary>Disconnect</summary>
                    <p>Stops local imports and deletes the stored authorization. Existing distilled notes remain. If Fathom webhook removal must be retried, its encrypted API credential is retained only for that cleanup and deleted as soon as cleanup succeeds.</p>
                    <form action={disconnectRecordingConnection}>
                      <input name="connection_id" type="hidden" value={connection.id} />
                      <button className="button quiet" type="submit">Disconnect source</button>
                    </form>
                  </details>
                ) : provider === "notion" ? (
                  <p className="source-note">Notion summaries and action items remain proposals until the recording owner confirms them.</p>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {adminMode ? (
        <details className="card recording-admin-panel">
          <summary>Operator setup · activate the Notion webhook</summary>
          <p className="muted">Create one subscription in the Notion connection settings for page created and page content updated events. The five-minute safety check remains active.</p>
          {siteOrigin && notionWebhookSetupSecret ? (
            <label className="recording-webhook-url">
              <span>One-time Notion webhook URL</span>
              <input
                readOnly
                value={`${siteOrigin}/api/integrations/notion/webhook?setup_secret=${encodeURIComponent(notionWebhookSetupSecret)}`}
              />
            </label>
          ) : (
            <p className="source-warning">Set the production site URL and one-time Notion webhook setup secret before creating the subscription.</p>
          )}
          {!notionWebhookSetupSecret ? (
            <p className="muted">The webhook setup window is closed. Its signing token remains encrypted in Supabase Vault and is not displayed.</p>
          ) : notionWebhookTokenLoadError ? (
            <p className="source-warning">The webhook verification token could not be checked.</p>
          ) : notionWebhookToken ? (
            <label className="recording-webhook-url">
              <span>Verification token · paste into Notion</span>
              <input readOnly value={notionWebhookToken} />
            </label>
          ) : (
            <p className="muted">After Notion sends its verification request, reload this page to copy the captured token into Notion&apos;s Verify dialog.</p>
          )}
          {notionWebhookSetupSecret ? (
            <p className="source-note">After verification succeeds, rotate or remove the one-time setup secret. The signing token remains encrypted in Supabase Vault.</p>
          ) : null}
        </details>
      ) : null}

      {adminMode ? (
        <details className="card recording-admin-panel">
          <summary>Operator setup · connect Fireflies or Fathom</summary>
          <p className="muted">Credentials are encrypted in Supabase Vault and never shown again. Fathom&apos;s owner-only webhook is created automatically; Fireflies uses the signing secret from its webhook setup.</p>
          <form action={configureRecordingConnection} className="settings-form">
            <div className="form-grid two">
              <label className="field"><span>Provider</span><select name="provider" required><option value="fireflies">Fireflies</option><option value="fathom">Fathom</option></select></label>
              <label className="field"><span>Recording owner email</span><input autoComplete="off" name="account_email" required type="email" /><small>Only meetings recorded by this account are eligible for import.</small></label>
              <label className="field"><span>Provider API key</span><input autoComplete="new-password" name="api_key" required type="password" /></label>
              <label className="field"><span>Fireflies webhook secret (Fireflies only)</span><input autoComplete="new-password" name="webhook_secret" type="password" /></label>
              <label className="field"><span>Recording scope</span><input readOnly value="Owner recordings only" /></label>
            </div>
            <label className="toggle-row compact"><input name="consent_attestation" required type="checkbox" /><span><b>I attest that documented owner authorization is on file</b><small>This records the operator&apos;s attestation, its policy version, and the authorized owner. It does not claim the owner clicked this form.</small></span></label>
            <button className="button" type="submit">Save meeting source</button>
          </form>
        </details>
      ) : null}

      {adminMode ? (
        <details className="card recording-admin-panel">
          <summary>Operator health · delivery and retries</summary>
          <p className="muted">Signed events are durably queued before acknowledgement. Failed provider fetches retry with backoff; no raw webhook body is stored.</p>
          {queueHealth.length ? (
            <div className="recording-health-list">
              {queueHealth.map((receipt) => (
                <div key={receipt.id}>
                  <b>{providerLabel(receipt.provider)}</b>
                  <span>{receipt.status} · attempt {receipt.attempts} · {readableDate(receipt.received_at)}</span>
                  {receipt.last_error ? <small>{receipt.last_error}</small> : null}
                </div>
              ))}
            </div>
          ) : <p className="muted">No recording delivery receipts yet.</p>}
        </details>
      ) : null}

      <section className="recording-timeline" aria-labelledby="recording-timeline-heading">
        <div className="section-heading-row">
          <div>
            <h2 id="recording-timeline-heading">Meeting Inbox</h2>
            <p className="muted">Approve, mark done, or decline each item. The meeting is processed when nothing is left to decide.</p>
          </div>
        </div>
        <nav className="segmented" aria-label="Meeting inbox views">
          {([
            ["to_process", "To Process"],
            ["processed", "Processed"],
          ] as const).map(([value, label]) => (
            <Link
              aria-current={view === value ? "page" : undefined}
              href={`/recordings?view=${value}`}
              key={value}
            >
              {label} · {followupsLoadError ? "?" : inboxCounts[value]}
            </Link>
          ))}
        </nav>
        {contactOptionsIncomplete && view === "to_process" ? (
          <div className="notice">The full Book contact list could not be verified. Promise routing stays unavailable until the list is complete.</div>
        ) : null}
        {calendarAttendeesLoadError && view === "to_process" ? (
          <div className="notice">Automatic attendee matching is unavailable. Choose the person manually before approving an item.</div>
        ) : null}
        {followupsLoadError ? (
          <div className="empty"><Mic2 aria-hidden="true" /><h3>Inbox status unavailable</h3><p>Meeting notes are unchanged. Refresh after the follow-up ledger is available.</p></div>
        ) : visibleRecordings.length === 0 ? (
          <div className="empty">
            <Mic2 aria-hidden="true" />
            <h3>{view === "to_process" ? "No meetings to process" : "No processed meetings yet"}</h3>
            <p>{view === "to_process" ? "New meeting notes will appear here automatically." : "Processed meetings stay archived here for reference."}</p>
          </div>
        ) : (
          <div className="recording-list">
            {visibleRecordings.map((recording) => {
              const meetingFollowups = followupsByTranscript.get(recording.id) ?? [];
              const calendarEventId = typeof recording.metadata?.calendar_match_event_id === "string"
                ? recording.metadata.calendar_match_event_id
                : null;
              const meetingCalendarAttendees = calendarEventId
                ? calendarAttendeesByEvent.get(calendarEventId) ?? []
                : [];
              const recordingOwnerEmail = connections.find(
                (connection) => connection.user_id === recording.owner_user_id,
              )?.external_account_email?.toLowerCase() ?? null;
              const meetingPeople = meetingCalendarAttendees.filter(
                (attendee) => attendee.normalized_email.toLowerCase() !== recordingOwnerEmail,
              );
              const unmatchedMeetingAttendees = meetingPeople.filter(
                calendarAttendeeNeedsBookDecision,
              );
              const undecidedFollowups = meetingFollowups.filter(
                (followup) => followup.status === "proposed" || followup.status === "pending",
              );
              const proposedIds = Array.isArray(recording.metadata?.proposed_contact_ids)
                ? recording.metadata.proposed_contact_ids.filter((id): id is string => typeof id === "string")
                : [];
              const confirmedIds = Array.isArray(recording.metadata?.confirmed_contact_ids)
                ? recording.metadata.confirmed_contact_ids.filter((id): id is string => typeof id === "string")
                : [];
              const liveMatchedIds = meetingPeople
                .map((attendee) => attendee.matched_contact_id)
                .filter((id): id is string => typeof id === "string");
              const attendeeIds = Array.from(new Set([
                ...proposedIds,
                ...confirmedIds,
                ...liveMatchedIds,
              ]));
              const orderedContacts = [...contactOptions].sort((left, right) => {
                const inferredOrder = Number(attendeeIds.includes(right.id)) - Number(attendeeIds.includes(left.id));
                return inferredOrder || left.full_name.localeCompare(right.full_name);
              });
              const validatedConfirmedIds = Array.from(new Set(
                confirmedIds.filter((id) => activeContactIds.has(id)),
              ));
              const unambiguousLiveMatchedIds =
                !calendarAttendeesLoadError
                && meetingPeople.length > 0
                && meetingPeople.every(
                  (attendee) => attendee.matched_contact_id && activeContactIds.has(attendee.matched_contact_id),
                )
                  ? Array.from(new Set(liveMatchedIds))
                  : [];
              const meetingHistoryIds = validatedConfirmedIds.length > 0
                ? validatedConfirmedIds
                : unambiguousLiveMatchedIds;
              const inferenceMeetingContactIds = meetingContactIdsForInference({
                calendarAttendees: calendarEventId
                  ? meetingCalendarAttendees.map((attendee) => ({
                      normalizedEmail: attendee.normalized_email,
                      matchedContactId: attendee.matched_contact_id,
                    }))
                  : null,
                calendarAttendeesComplete: !calendarAttendeesLoadError,
                ownerEmail: recordingOwnerEmail,
                validatedConfirmedContactIds: validatedConfirmedIds,
              });
              const meetingHistoryContacts = meetingHistoryIds
                .map((id) => contactById.get(id))
                .filter((contact): contact is (typeof contactOptions)[number] => Boolean(contact));
              const suggestedMeetingContactIds = attendeeIds.filter((id) => activeContactIds.has(id));
              const oneClickLiveContact = unambiguousLiveMatchedIds.length === 1
                ? contactById.get(unambiguousLiveMatchedIds[0]) ?? null
                : null;
              const needsMeetingContactChoice =
                recording.processing_status === "ready"
                  ? validatedConfirmedIds.length === 0
                  : recording.processing_status === "review" && meetingHistoryContacts.length === 0;
              const meetingContactChoiceBlocked =
                contactOptionsIncomplete
                || Boolean(calendarEventId && calendarAttendeesLoadError)
                || contactOptions.length === 0;
              const meetingReturnTo = `${returnTo}#meeting-${recording.id}`;
              return (
                <article className="card recording-item" id={`meeting-${recording.id}`} key={recording.id}>
                  <div className="recording-item-meta"><span>{providerLabel(recording.source)}</span><time>{readableDate(recording.occurred_at)}</time><span>{duration(recording.duration_seconds)}</span></div>
                  <h3>{recording.title ?? "Recorded meeting"}</h3>
                  {meetingHistoryContacts.length > 0 ? (
                    <div className="recording-meeting-people" aria-label="People linked to this meeting">
                      <span>With</span>
                      <div>
                        {meetingHistoryContacts.map((contact) => (
                          <Link href={`/contacts/${contact.id}`} key={contact.id}>
                            {contact.full_name}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {needsMeetingContactChoice ? (
                    <section className="recording-contact-prompt" aria-label="Confirm people in this meeting">
                      <div className="recording-contact-choice">
                        <div>
                          <h4>
                            {oneClickLiveContact
                              ? "Confirm who this was with"
                              : "Who was in this meeting?"}
                          </h4>
                          <p>
                            {oneClickLiveContact
                              ? `Save ${oneClickLiveContact.full_name} once so these notes stay with the right person.`
                              : "Choose the people who should be linked to these notes."}
                          </p>
                        </div>
                        {!meetingContactChoiceBlocked ? (
                          <form action={confirmRecordingPeople} className="recording-people-confirmation-form">
                            <input name="transcript_id" type="hidden" value={recording.id} />
                            <input name="transcript_updated_at" type="hidden" value={recording.updated_at} />
                            <input name="return_to" type="hidden" value={meetingReturnTo} />
                            {oneClickLiveContact ? (
                              <input
                                name="meeting_contact_ids"
                                type="hidden"
                                value={oneClickLiveContact.id}
                              />
                            ) : (
                              <label className="field recording-meeting-person-select">
                                <span>People</span>
                                <select
                                  defaultValue={suggestedMeetingContactIds}
                                  multiple
                                  name="meeting_contact_ids"
                                  required
                                  size={Math.min(4, Math.max(2, orderedContacts.length))}
                                >
                                  {orderedContacts.map((contact) => (
                                    <option key={contact.id} value={contact.id}>
                                      {contact.full_name}{contact.company_name ? ` · ${contact.company_name}` : ""}{attendeeIds.includes(contact.id) ? " · suggested" : ""}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                            <button className="button small" type="submit">Save people</button>
                          </form>
                        ) : (
                          <p className="notice" role="status">
                            Add or match the people below before processing this meeting.
                          </p>
                        )}
                      </div>
                    </section>
                  ) : null}
                  {meetingFollowups.length && !needsMeetingContactChoice ? (
                    <section
                      aria-labelledby={`proposed-items-${recording.id}`}
                      className="recording-decision-stack"
                    >
                      <div className="recording-decision-heading">
                        <div>
                          <span className="eyebrow">Decide first</span>
                          <h4 id={`proposed-items-${recording.id}`}>
                            {view === "to_process" ? "Decisions" : "Processed items"}
                          </h4>
                        </div>
                        {view === "to_process" ? (
                          <span className="pill">{undecidedFollowups.length} left</span>
                        ) : null}
                      </div>
                      <div className="recording-followup-list">
                      {meetingFollowups.map((followup) => {
                        if (followup.status === "proposed" || followup.status === "pending") {
                          const inference = inferRecordingFollowup({
                            followupText: followup.followup_text,
                            assignee: followup.assignee,
                            assigneeEmail: followup.assignee_email,
                            ownerAssigned: followup.owner_assigned,
                            ownerEmail: recordingOwnerEmail,
                            meetingContactIds: inferenceMeetingContactIds,
                            contacts: contactOptions,
                            contactsIncomplete: contactOptionsIncomplete || calendarAttendeesLoadError,
                          });
                          const approveDisabled = contactOptionsIncomplete;
                          return (
                          <form action={routeRecordingFollowup} className="recording-followup-form simplified" key={followup.id}>
                          <input name="followup_id" type="hidden" value={followup.id} />
                          <input name="transcript_updated_at" type="hidden" value={recording.updated_at} />
                          <input name="return_to" type="hidden" value={meetingReturnTo} />
                          {meetingHistoryIds.map((contactId) => (
                            <input key={contactId} name="meeting_contact_ids" type="hidden" value={contactId} />
                          ))}
                          <div className="recording-followup-copy">
                            <b>{followup.followup_text}</b>
                            <span className={inference.needsInput ? "followup-inference needs-input" : "followup-inference"}>
                              {followupInferenceLabel(inference)}
                            </span>
                          </div>
                          <details className="recording-followup-correction" open={inference.needsInput}>
                            <summary>Change</summary>
                            <div className="recording-followup-fields">
                              <label className="field">
                                <span>Who made this promise?</span>
                                <select
                                  name="classification"
                                  defaultValue={inference.classification === "action" ? "" : inference.classification}
                                >
                                  <option value="">Choose who made the promise</option>
                                  <option value="owner_promise">I will do it</option>
                                  <option value="contact_promise">They will do it</option>
                                </select>
                              </label>
                              {!inference.contactId ? (
                                <label className="field">
                                  <span>This promise is with</span>
                                  <select
                                    disabled={contactOptionsIncomplete}
                                    name="contact_id"
                                    defaultValue=""
                                  >
                                    <option value="">Choose a person</option>
                                    {orderedContacts.map((contact) => (
                                      <option key={contact.id} value={contact.id}>
                                        {contact.full_name}{contact.company_name ? ` · ${contact.company_name}` : ""}{attendeeIds.includes(contact.id) ? " · attendee" : ""}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              ) : (
                                <input name="contact_id" type="hidden" value={inference.contactId ?? ""} />
                              )}
                              <label className="field">
                                <span>Due date</span>
                                <input name="due_on" type="date" />
                              </label>
                              <label className="field recording-followup-note">
                                <span>Note (optional)</span>
                                <input name="note" maxLength={1000} />
                              </label>
                            </div>
                          </details>
                          <div className="recording-followup-routes simplified" aria-label="Decide this follow-up">
                            <button className="button small" disabled={approveDisabled} name="outcome" type="submit" value="approve">Approve</button>
                            <button className="button ghost small" name="outcome" type="submit" value="already_done">Already done</button>
                            <button className="button quiet small" name="outcome" type="submit" value="decline">Decline</button>
                          </div>
                          </form>
                        );
                        }
                        return (
                          <div className="recording-followup-receipt" key={followup.id}>
                          <span>
                            <b>{followup.followup_text}</b>
                            <small>
                              {followup.resolved_at ? `Processed ${readableDate(followup.resolved_at)}` : "Processed"}
                            </small>
                          </span>
                          <span className="pill">
                            {followup.status === "completed"
                                ? "Already done"
                                : followupRouteLabel(followup.route)}
                          </span>
                          </div>
                        );
                      })}
                      </div>
                    </section>
                  ) : recording.processing_status === "review" && followupsLoadError ? (
                    <div className="notice">Proposed items could not be verified. Decisions stay unavailable until the list reloads.</div>
                  ) : null}
                  {unmatchedMeetingAttendees.length ? (
                    <section className="recording-contact-prompt" aria-label="People not yet in the Book">
                      <div className="recording-contact-choice">
                        <div>
                          <span className="eyebrow">People not yet in the Book</span>
                          <h4>Owner decision needed</h4>
                          <p>
                            {unmatchedMeetingAttendees
                              .map((attendee) => attendee.display_name?.trim() || attendee.normalized_email)
                              .join(" · ")}
                          </p>
                        </div>
                        <Link className="button quiet small" href="/contacts/new">
                          Open client intake
                        </Link>
                        <p className="muted">
                          The owner can add each person or choose Not for the Book from Today.
                        </p>
                      </div>
                    </section>
                  ) : calendarAttendeesLoadError && calendarEventId ? (
                    <div className="notice">Attendee matching could not be verified. No contact will be added until it reloads safely.</div>
                  ) : null}
                  <section className="recording-notes" aria-labelledby={`meeting-notes-${recording.id}`}>
                    <span className="eyebrow">Reference</span>
                    <h4 id={`meeting-notes-${recording.id}`}>Meeting notes</h4>
                    <p>{recording.distilled_summary ?? "Notes are still processing."}</p>
                  </section>
                  <div className="recording-item-actions">
                    {recording.recording_url ? <a className="button quiet" href={recording.recording_url} rel="noreferrer" target="_blank">Open in provider <ExternalLink aria-hidden="true" /></a> : null}
                    {recording.processing_status === "ready" ? <Link className="button quiet" href={`/ask?q=${encodeURIComponent(`What follow-ups came from ${recording.title ?? "this meeting"}?`)}`}>Ask the Book</Link> : null}
                  </div>
                  {recording.processing_status === "review" && meetingFollowups.length === 0 ? (
                    <form action={acceptRecordingNotes} className="recording-review-form">
                      <input name="transcript_id" type="hidden" value={recording.id} />
                      <input name="transcript_updated_at" type="hidden" value={recording.updated_at} />
                      <input name="return_to" type="hidden" value={meetingReturnTo} />
                      {meetingHistoryIds.map((contactId) => (
                        <input key={contactId} name="contact_ids" type="hidden" value={contactId} />
                      ))}
                      <strong>No decisions were suggested</strong>
                      <p className="muted">Process the meeting to keep its notes in relationship history, or decline the meeting.</p>
                      <div className="recording-item-actions">
                        <button
                          className="button"
                          disabled={needsMeetingContactChoice}
                          type="submit"
                        >
                          Process meeting
                        </button>
                        <button className="button quiet" formAction={dismissRecordingNotes} type="submit">Decline meeting</button>
                      </div>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
