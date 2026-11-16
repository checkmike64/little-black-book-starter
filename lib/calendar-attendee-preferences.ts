export type CalendarAttendeePreference = {
  normalized_email: unknown;
  decision: unknown;
};

function normalizedEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function ignoredCalendarAttendeeEmails(
  preferences: CalendarAttendeePreference[],
) {
  return new Set(
    preferences
      .filter((preference) => preference.decision === "ignore")
      .map((preference) => normalizedEmail(preference.normalized_email))
      .filter(Boolean),
  );
}

export function exactCalendarPreferenceRowsAreComplete(
  count: unknown,
  rowCount: number,
) {
  return Number.isSafeInteger(count)
    && (count as number) >= 0
    && count === rowCount;
}

export function calendarAttendeeEmailIsIgnored(
  value: unknown,
  ignoredEmails: ReadonlySet<string>,
) {
  const email = normalizedEmail(value);
  return Boolean(email && ignoredEmails.has(email));
}

export function withCalendarAttendeePreferenceState<
  Row extends { normalized_email: unknown },
>(rows: Row[], ignoredEmails: ReadonlySet<string>) {
  return rows.map((row) => ({
    ...row,
    ignored_by_owner: calendarAttendeeEmailIsIgnored(
      row.normalized_email,
      ignoredEmails,
    ),
  }));
}

export function calendarAttendeeNeedsBookDecision(attendee: {
  ignored_by_owner: boolean;
  matched_contact_id: string | null;
  matched_want_to_know_id: string | null;
}) {
  return !attendee.ignored_by_owner
    && !attendee.matched_contact_id
    && !attendee.matched_want_to_know_id;
}
