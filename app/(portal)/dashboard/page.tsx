import Link from "next/link";
import { buildKeepInTouchQueue } from "@/lib/keep-in-touch";
import { RefreshCw } from "lucide-react";
import {
  decideCalendarAttendee,
  requestClaudeRefresh,
} from "@/app/(portal)/dashboard/actions";
import { PendingSubmitButton } from "@/app/(portal)/pending-submit-button";
import {
  getTodayData,
  type CalendarEventRow,
  type InteractionRow,
} from "@/lib/dashboard/data";
import { getTenantContext } from "@/lib/tenant-context";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { ownerWantToKnowPurposes } from "@/lib/want-to-know-purposes";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function eventContacts(event: CalendarEventRow) {
  const seen = new Set<string>();
  return (event.calendar_attendees ?? [])
    .map((attendee) => attendee.contacts)
    .filter((contact): contact is NonNullable<typeof contact> => {
      if (!contact || seen.has(contact.id)) return false;
      seen.add(contact.id);
      return true;
    });
}

function interactionContacts(interaction: InteractionRow) {
  const seen = new Set<string>();
  return (interaction.interaction_contacts ?? [])
    .map((item) => item.contacts)
    .filter((contact): contact is NonNullable<typeof contact> => {
      const id = contact?.id ?? contact?.full_name;
      if (!contact || !id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function readableDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function compactText(value: string | null | undefined, maxLength = 220) {
  if (!value) return null;
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= maxLength) return clean;
  const clipped = clean.slice(0, maxLength + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > maxLength * 0.7 ? lastSpace : maxLength).trim()}…`;
}

function MeetingValue({ meeting }: { meeting: CalendarEventRow }) {
  const briefing = meeting.metadata?.briefing;
  const rows = [
    { label: "Bring", items: briefing?.opportunities ?? [] },
    { label: "Help with", items: briefing?.their_asks ?? [] },
    { label: "Acknowledge", items: briefing?.whats_new ?? [] },
  ].filter((row) => row.items.length > 0);

  if (rows.length === 0) {
    return <p className="meeting-value-empty">No preparation notes are stored yet.</p>;
  }

  return (
    <dl className="meeting-value-list">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.items.slice(0, 3).join(" · ")}</dd>
        </div>
      ))}
    </dl>
  );
}

function UpcomingMeeting({
  meeting,
  timeZone,
}: {
  meeting: CalendarEventRow;
  timeZone: string;
}) {
  const contacts = eventContacts(meeting);
  const name =
    contacts.map((contact) => contact.full_name).join(", ") ||
    meeting.title ||
    "Upcoming meeting";
  const primaryContact = contacts[0] ?? null;
  const prepQuery = `${name}: what useful context is stored for this meeting? Use only relationship history, current asks, promises, and verified profile facts.`;

  return (
    <article className="meeting-card today-meeting-card">
      <div className="meeting-card-head">
        <div>
          <span className="meeting-time">
            {readableDateTime(meeting.starts_at, timeZone)}
          </span>
          <h3>{name}</h3>
          {meeting.title && meeting.title !== name ? <p>{meeting.title}</p> : null}
        </div>
        {primaryContact?.trust_level ? (
          <span className="pill gold">{primaryContact.trust_level}</span>
        ) : null}
      </div>

      <div className="meeting-value-block">
        <span className="meeting-value-label">Preparation</span>
        <MeetingValue meeting={meeting} />
      </div>

      <div className="actions">
        <Link className="button hot" href={`/ask?q=${encodeURIComponent(prepQuery)}`}>
          Ask the Book
        </Link>
        {primaryContact ? (
          <Link className="button ghost" href={`/contacts/${primaryContact.id}`}>
            Open person
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = searchParams ? await searchParams : {};
  const message = firstParam(params.message);
  const tenantContext = await getTenantContext();
  const settings = normalizeTenantSettings(tenantContext?.settings);
  const {
    keepInTouchContacts,
    keepInTouchError,
    calendarEvents,
    error,
    pendingCalendarAttendees,
    recentInteractions,
    setupMode,
  } = await getTodayData();

  const timeZone = settings.activity.time_zone;
  const now = new Date();
  const keepInTouch = buildKeepInTouchQueue(keepInTouchContacts, settings.keep_in_touch, timeZone, now);
  const nowMs = now.getTime();
  const next48Hours = nowMs + 48 * 60 * 60 * 1000;
  const recentCutoff = nowMs - 72 * 60 * 60 * 1000;
  const upcomingMeetings = calendarEvents.filter((event) => {
    const startsAt = Date.parse(event.starts_at);
    return startsAt >= nowMs && startsAt <= next48Hours;
  });
  const recentlyMet = pendingCalendarAttendees
    .filter((attendee) => {
      const startsAt = Date.parse(attendee.event_starts_at);
      return startsAt >= recentCutoff && startsAt < nowMs;
    })
    .sort(
      (a, b) => Date.parse(b.event_starts_at) - Date.parse(a.event_starts_at),
    );
  const wantToKnowPurposes = ownerWantToKnowPurposes(settings.prospecting.buckets);

  return (
    <div className="minimal-page today-minimal">
      <header className="minimal-page-header">
        <div className="minimal-title-line">
          <h1>Today</h1>
          <time dateTime={now.toISOString()}>
            {new Intl.DateTimeFormat("en", {
              weekday: "long",
              month: "long",
              day: "numeric",
              timeZone,
            }).format(now)}
          </time>
        </div>
        <div className="actions">
          <Link className="button hot" href="/ask">Ask the Book</Link>
          <form action={requestClaudeRefresh}>
            <PendingSubmitButton
              className="button ghost"
              pendingLabel="Queuing…"
            >
              <RefreshCw aria-hidden="true" size={15} />
              Refresh
            </PendingSubmitButton>
          </form>
        </div>
      </header>

      <section aria-labelledby="keep-in-touch-title">
        <h2 id="keep-in-touch-title">Keep in touch</h2>
        <p className="muted">People due for a conversation, based on their tier or personal cadence.</p>
        {keepInTouchError ? <div className="notice" role="alert">Some contacts could not be loaded. Refresh to check the complete keep-in-touch list.</div> : null}
        <div className="owner-person-list">
          {keepInTouch.map(item => (
            <article className="owner-person-card" key={item.contact.id}>
              <div className="owner-person-identity">
                <div><h3>{item.contact.full_name ?? "Unnamed contact"}</h3><p>{item.reason}</p></div>
                <span className="pill gold">{item.cadenceLabel}</span>
              </div>
              <div className="actions">
                <Link className="button hot" href={`/contacts/${item.contact.id}?view=activity#log-touchpoint`}>Log conversation</Link>
                <Link className="button ghost" href={`/contacts/${item.contact.id}`}>Open person</Link>
                <Link className="button quiet" href={`/ask?q=${encodeURIComponent(`Draft a personal check-in for ${item.contact.full_name ?? "this person"} (contact ${item.contact.id}) using only verified relationship context. Do not send it.`)}`}>Draft check-in</Link>
              </div>
            </article>
          ))}
        </div>
        {!keepInTouchError && keepInTouch.length === 0 ? <p className="quiet-empty">{setupMode ? "Assign tiers or touch cadences after setup to see reminders here." : "You’re up to date. Your next reminders will appear here when due."}</p> : null}
      </section>

      {setupMode ? (
        <div className="notice" role="status">Your private Book is still being prepared.</div>
      ) : null}
      {message ? <div className="notice" role="status">{message}</div> : null}
      {error ? <div className="notice" role="alert">{error}</div> : null}

      {recentlyMet.length > 0 ? (
        <section className="minimal-section" aria-labelledby="recently-met-title">
          <div className="minimal-section-head">
            <h2 id="recently-met-title">People to place</h2>
          </div>
          <div className="minimal-list">
            {recentlyMet.map((attendee) => (
              <article className="minimal-list-row placement-row" key={attendee.id}>
                <div>
                  <span className="minimal-row-label">
                    {readableDateTime(attendee.event_starts_at, timeZone)} · {attendee.event_title ?? "Recent conversation"}
                  </span>
                  <h3>{attendee.display_name || attendee.normalized_email}</h3>
                  <p>{attendee.metadata?.relationship_hint || attendee.normalized_email}</p>
                </div>
                <div className="actions">
                  <form action={decideCalendarAttendee}>
                    <input name="attendee_id" type="hidden" value={attendee.id} />
                    <button className="button hot" name="decision" type="submit" value="book">Add to Book</button>
                  </form>
                  <form action={decideCalendarAttendee} className="placement-purpose-form">
                    <input name="attendee_id" type="hidden" value={attendee.id} />
                    <label>
                      <span className="visually-hidden">Why do you want to know this person?</span>
                      <select aria-label="Want to Know purpose" name="purpose" required>
                        <option value="">Choose purpose</option>
                        {wantToKnowPurposes.map((purpose) => (
                          <option key={purpose.label} value={purpose.label}>{purpose.label}</option>
                        ))}
                      </select>
                    </label>
                    <button className="button ghost" name="decision" type="submit" value="want_to_know">Want to Know</button>
                  </form>
                  <form action={decideCalendarAttendee}>
                    <input name="attendee_id" type="hidden" value={attendee.id} />
                    <button className="button quiet" name="decision" type="submit" value="ignore">Not for the Book</button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {upcomingMeetings.length > 0 ? (
        <section className="minimal-section" aria-labelledby="upcoming-title">
          <div className="minimal-section-head"><h2 id="upcoming-title">Coming up</h2></div>
          <div className="owner-person-list meeting-list today-meeting-timeline">
            {upcomingMeetings.map((meeting) => (
              <UpcomingMeeting key={meeting.id} meeting={meeting} timeZone={timeZone} />
            ))}
          </div>
        </section>
      ) : null}

      {recentInteractions.length > 0 ? (
        <details className="minimal-disclosure">
          <summary>Recent activity</summary>
          <div className="today-activity-list">
            {recentInteractions.map((interaction) => {
              const contacts = interactionContacts(interaction);
              const detail = compactText(interaction.summary);
              return (
                <article className="today-activity-item" key={interaction.id}>
                  <span>{readableDateTime(interaction.occurred_at, timeZone)}</span>
                  <div>
                    <h3>{interaction.title ?? interaction.interaction_type.replaceAll("_", " ")}</h3>
                    <p>{contacts.map((contact) => contact.full_name).filter(Boolean).join(", ") || "No person linked"}</p>
                    {detail ? <p>{detail}</p> : null}
                  </div>
                  {contacts[0]?.id ? (
                    <Link className="button quiet small" href={`/contacts/${contacts[0].id}`}>Open person</Link>
                  ) : null}
                </article>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}
