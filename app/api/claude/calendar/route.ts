import { createHash } from "node:crypto";
import {
  authorizeClaudeWrite,
  authenticateClaudeRequest,
  claudeWriteRequestKey,
  cleanText,
  isValidUuid,
  jsonError,
  privateJson,
  readClaudeJson,
  tenantIdFrom,
} from "@/app/api/claude/_shared";
import { normalizeCalendarEmail } from "@/lib/calendar-identity";

type BriefingInput = {
  whats_new?: unknown;
  their_asks?: unknown;
  our_notes?: unknown;
  opportunities?: unknown;
  recommended_follow_up?: unknown;
};

type AttendeeInput = {
  contact_id?: unknown;
  email?: unknown;
  display_name?: unknown;
  response_status?: unknown;
  is_organizer?: unknown;
  relationship_hint?: unknown;
};

type CalendarEventInput = {
  external_event_id?: unknown;
  title?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  status?: unknown;
  html_url?: unknown;
  organizer_email?: unknown;
  is_all_day?: unknown;
  briefing?: BriefingInput;
  attendees?: AttendeeInput[];
};

type CalendarSnapshotRequest = {
  tenant_id?: string;
  snapshot_id?: unknown;
  generated_at?: unknown;
  window_start?: unknown;
  window_end?: unknown;
  events?: CalendarEventInput[];
};

function validTimestamp(value: string) {
  return Boolean(value) && Number.isFinite(Date.parse(value));
}

function cleanUrl(value: unknown) {
  const text = cleanText(value, 2000);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function cleanList(value: unknown, maxItems = 5) {
  return Array.isArray(value)
    ? value
        .map((item) => cleanText(item, 500))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];
}

function cleanBriefing(value: BriefingInput | undefined) {
  return {
    whats_new: cleanList(value?.whats_new),
    their_asks: cleanList(value?.their_asks),
    our_notes: cleanList(value?.our_notes),
    opportunities: cleanList(value?.opportunities),
    recommended_follow_up:
      cleanText(value?.recommended_follow_up, 500) || null,
  };
}

function derivedEventId(event: CalendarEventInput) {
  const attendeeEmails = (event.attendees ?? [])
    .map((attendee) => normalizeCalendarEmail(cleanText(attendee.email, 320)))
    .filter(Boolean)
    .sort();
  return `claude:${createHash("sha256")
    .update(
      JSON.stringify({
        title: cleanText(event.title, 500).toLowerCase(),
        starts_at: cleanText(event.starts_at, 80),
        attendees: attendeeEmails,
      }),
    )
    .digest("hex")}`;
}

export async function POST(request: Request) {
  const { admin, error } = authenticateClaudeRequest(request, "write");
  if (error) return error;

  const parsed = await readClaudeJson<CalendarSnapshotRequest>(request, {
    maxBytes: 500_000,
  });
  if (parsed.error) return parsed.error;

  const body = parsed.body;
  const tenantId = tenantIdFrom(body.tenant_id);
  const snapshotId = cleanText(body.snapshot_id, 160);
  const generatedAt = cleanText(body.generated_at, 80);
  const windowStart = cleanText(body.window_start, 80);
  const windowEnd = cleanText(body.window_end, 80);
  const events = Array.isArray(body.events) ? body.events : [];

  if (!tenantId) return jsonError("Valid tenant_id is required.");
  if (!snapshotId) return jsonError("snapshot_id is required.");
  if (
    !validTimestamp(generatedAt) ||
    !validTimestamp(windowStart) ||
    !validTimestamp(windowEnd)
  ) {
    return jsonError("generated_at, window_start, and window_end must be ISO timestamps.");
  }
  const windowMs = Date.parse(windowEnd) - Date.parse(windowStart);
  if (windowMs < 0 || windowMs > 8 * 86_400_000) {
    return jsonError("The calendar snapshot window must be between zero and eight days.");
  }
  if (events.length > 50) return jsonError("A snapshot can contain at most 50 events.");

  const normalizedEvents = [];
  for (const event of events) {
    const startsAt = cleanText(event.starts_at, 80);
    const endsAt = cleanText(event.ends_at, 80);
    if (!validTimestamp(startsAt) || (endsAt && !validTimestamp(endsAt))) {
      return jsonError("Every event needs valid starts_at and ends_at timestamps.");
    }
    if (
      Date.parse(startsAt) < Date.parse(windowStart) ||
      Date.parse(startsAt) > Date.parse(windowEnd)
    ) {
      return jsonError("Every event must fall inside the declared snapshot window.");
    }
    const attendees = (event.attendees ?? []).slice(0, 50).flatMap((attendee) => {
      const email = normalizeCalendarEmail(cleanText(attendee.email, 320));
      if (!email) return [];
      return [{
        contact_id: isValidUuid(cleanText(attendee.contact_id, 80))
          ? cleanText(attendee.contact_id, 80)
          : null,
        normalized_email: email,
        display_name: cleanText(attendee.display_name, 300) || null,
        response_status: cleanText(attendee.response_status, 40) || null,
        is_organizer: attendee.is_organizer === true,
        relationship_hint: cleanText(attendee.relationship_hint, 500) || null,
      }];
    });
    const suppliedId = cleanText(event.external_event_id, 500);
    normalizedEvents.push({
      external_event_id: suppliedId || derivedEventId(event),
      title: cleanText(event.title, 500) || null,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      status: cleanText(event.status, 40) || "confirmed",
      html_url: cleanUrl(event.html_url),
      organizer_email:
        normalizeCalendarEmail(cleanText(event.organizer_email, 320)) ?? null,
      is_all_day: event.is_all_day === true,
      briefing: cleanBriefing(event.briefing),
      attendees,
    });
  }

  const policyError = await authorizeClaudeWrite({
    admin,
    tenantId,
    writeClass: "mechanical",
    requestKey: claudeWriteRequestKey("calendar-snapshot", [snapshotId]),
  });
  if (policyError) return policyError;

  const { data, error: rpcError } = await admin.rpc(
    "lbb_record_claude_calendar_snapshot",
    {
      p_tenant_id: tenantId,
      p_snapshot_id: snapshotId,
      p_payload_hash: createHash("sha256")
        .update(JSON.stringify({ windowStart, windowEnd, events: normalizedEvents }))
        .digest("hex"),
      p_generated_at: new Date(generatedAt).toISOString(),
      p_window_start: new Date(windowStart).toISOString(),
      p_window_end: new Date(windowEnd).toISOString(),
      p_events: normalizedEvents,
    },
  );
  if (rpcError) return jsonError(rpcError.message, 500);

  return privateJson(data ?? { event_count: 0, attendee_count: 0 }, {
    status: 201,
  });
}
