export type ContactInteractionActivity = {
  id: string;
  occurred_at: string;
  interaction_type: string;
  title: string | null;
  summary: string | null;
  source: string;
  source_ref: string | null;
};

export type ContactCalendarActivity = {
  id: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  status: string | null;
  html_url: string | null;
  external_event_id: string;
};

export type ContactActivityItem = {
  id: string;
  occurredAt: string;
  activityType: string;
  title: string;
  summary: string | null;
  source:
    | "interaction"
    | "calendar"
    | "profile_context"
    | "promise"
    | "introduction";
  sourceUrl: string | null;
};

function explicitActivityDate(value: string) {
  const match = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (!match) return null;
  const parsed = Date.parse(`${match[1]}T12:00:00Z`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizedTitle(value: string | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function likelySameMeeting(
  interaction: ContactInteractionActivity,
  event: ContactCalendarActivity,
) {
  if (
    interaction.source_ref &&
    [event.id, event.external_event_id].includes(interaction.source_ref)
  ) {
    return true;
  }
  if (!/^(call|meeting)$/i.test(interaction.interaction_type)) return false;
  const interactionAt = Date.parse(interaction.occurred_at);
  const eventAt = Date.parse(event.starts_at);
  const titlesMatch =
    normalizedTitle(interaction.title).length > 0 &&
    normalizedTitle(interaction.title) === normalizedTitle(event.title);
  return (
    titlesMatch &&
    Number.isFinite(interactionAt) &&
    Number.isFinite(eventAt) &&
    Math.abs(interactionAt - eventAt) <= 3 * 60 * 60 * 1000
  );
}

export function buildContactActivityTimeline({
  calendarEvents,
  interactions,
  lastSpoke,
  legacyNoteEvidence = false,
  now = new Date(),
  recentActivity,
}: {
  calendarEvents: ContactCalendarActivity[];
  interactions: ContactInteractionActivity[];
  lastSpoke: string | null;
  legacyNoteEvidence?: boolean;
  now?: Date;
  recentActivity: string | null;
}) {
  const items: ContactActivityItem[] = interactions.map((interaction) => ({
    id: `interaction:${interaction.id}`,
    occurredAt: interaction.occurred_at,
    activityType: interaction.interaction_type,
    title:
      interaction.title ?? interaction.interaction_type.replaceAll("_", " "),
    summary: interaction.summary,
    source: "interaction",
    sourceUrl: null,
  }));

  const completedCalendarEvents = calendarEvents.filter((event) => {
    const startsAt = Date.parse(event.starts_at);
    return (
      Number.isFinite(startsAt) &&
      startsAt <= now.getTime() + 5 * 60 * 1000 &&
      event.status !== "cancelled"
    );
  });

  for (const event of completedCalendarEvents) {
    const alreadyRepresented = interactions.some((interaction) =>
      likelySameMeeting(interaction, event),
    );
    if (alreadyRepresented) continue;

    items.push({
      id: `calendar:${event.id}`,
      occurredAt: event.starts_at,
      activityType: "calendar",
      title: event.title?.trim() || "Meeting",
      summary: "Matched from the authorized calendar.",
      source: "calendar",
      sourceUrl: event.html_url,
    });
  }

  const importedContext = recentActivity?.trim() ?? "";
  const importedContextIsNormalized = interactions.some(
    (interaction) =>
      Boolean(interaction.summary) &&
      normalizedTitle(interaction.summary) === normalizedTitle(importedContext),
  );

  if (importedContext && !importedContextIsNormalized) {
    const occurredAt =
      explicitActivityDate(importedContext) ??
      (lastSpoke ? `${lastSpoke.slice(0, 10)}T12:00:00Z` : null);
    if (occurredAt) {
      items.push({
        id: "profile-context",
        occurredAt,
        activityType: "unverified",
        title: "Imported relationship note",
        summary: importedContext,
        source: "profile_context",
        sourceUrl: null,
      });
    }
  }

  if (items.length === 0 && legacyNoteEvidence && lastSpoke) {
    items.push({
      id: "profile-note-evidence",
      occurredAt: `${lastSpoke.slice(0, 10)}T12:00:00Z`,
      activityType: "unverified",
      title: "Saved call context",
      summary:
        "A recording or conversation is referenced in profile notes. Log or import the dated touch to make it verified activity.",
      source: "profile_context",
      sourceUrl: null,
    });
  }

  return items.sort(
    (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
  );
}
