import Link from "next/link";
import {
  changeCardIdentity,
  recordingActionPresentation,
  type ChangeCardInput,
} from "@/lib/change-card-presentation";
import { getPendingChanges, type PendingChangeRow } from "@/lib/changes/data";
import { replacementStatus } from "@/lib/pending-change-review";
import { proposedFieldRows } from "@/lib/pending-change-inspection";
import {
  isNewPersonChangeType,
  isOwnerActionableChange,
} from "@/lib/pending-change-types";
import { isRetiredAlternateEmailChange } from "@/lib/pending-change-field-policy";
import {
  ownerChangedPeopleCount,
  profileChangeGroups,
} from "@/lib/change-review-groups";

type ChangeLaneKey = "identity" | "follow_up" | "profile";

function changeLane(row: PendingChangeRow) {
  if (row.resolved_existing_contact_id) return "profile" as const;
  if (isNewPersonChangeType(row.change_type)) return "identity" as const;
  if (row.source === "recording_operator" && row.change_type === "recording_action") {
    return "follow_up" as const;
  }
  return "profile" as const;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readableMeetingDate(value: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

function meetingEvidence(row: PendingChangeRow) {
  const evidence = record(row.payload.evidence);
  const meeting = {
    ...record(row.payload.meeting),
    ...record(row.payload.meeting_baseline),
    ...record(evidence.meeting),
  };
  const title =
    text(meeting.meeting_title)
    ?? text(meeting.title)
    ?? text(evidence.meeting_title)
    ?? text(row.payload.meeting_title);
  const date = readableMeetingDate(
    text(meeting.meeting_occurred_at)
    ?? text(meeting.occurred_at)
    ?? text(meeting.meeting_date)
    ?? text(evidence.meeting_occurred_at)
    ?? text(evidence.occurred_at)
    ?? text(row.payload.meeting_occurred_at),
  );

  return title || date
    ? [title ?? "Meeting", date].filter(Boolean).join(" · ")
    : null;
}

const ownerFieldLabels: Record<string, string> = {
  company_name: "Company",
  company_description: "Company description",
  role_title: "Role / title",
  location: "Location",
  time_zone: "Time zone",
  phone: "Phone",
  website: "Website",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  x_twitter: "X",
  youtube: "YouTube",
  podcast_url: "Podcast",
  current_asks: "Current asks",
  wants_help_with: "Wants help with",
  services_offered: "Services",
  ideal_referral: "Ideal referral",
};

function displayFieldLabel(key: string, label: string) {
  if (ownerFieldLabels[key]) return ownerFieldLabels[key];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function ContactChangeCard({ row }: { row: PendingChangeRow }) {
  const presentation = row as ChangeCardInput;
  const identity = changeCardIdentity(presentation);
  const fields = proposedFieldRows({ before: row.contact, change: row });
  const recordingAction = recordingActionPresentation(presentation);
  const sourceMeeting = meetingEvidence(row);
  const lane = changeLane(row);
  const returnTo = `/changes?view=${lane}`;
  const fieldLabels = fields.map((field) => displayFieldLabel(field.key, field.label));
  const fieldSummary = fieldLabels.length > 0
    ? `${fieldLabels.slice(0, 3).join(", ")}${fieldLabels.length > 3 ? ` and ${fieldLabels.length - 3} more` : ""}`
    : row.summary;
  const kind = lane === "identity"
    ? "New person"
    : lane === "follow_up"
      ? "Meeting follow-up"
      : row.resolved_existing_contact_id
        ? "Existing person found"
        : "Profile update";
  const retiredAlternateEmail = isRetiredAlternateEmailChange(row);

  return (
    <article className="minimal-list-row change-list-row">
      <div className="person-change-head">
        <div>
          <h2>{identity.name}</h2>
          <p>{[kind, identity.company].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      <div className="change-list-summary">
        <p>
          {retiredAlternateEmail
            ? "Remove an old alternate-email suggestion"
            : recordingAction
              ? recordingAction.title
              : fieldSummary}
        </p>
        {recordingAction?.dueOn || sourceMeeting ? (
          <small>{[recordingAction?.dueOn ? `Due ${recordingAction.dueOn}` : null, sourceMeeting].filter(Boolean).join(" · ")}</small>
        ) : null}
      </div>

      <Link
        className="button ghost small"
        href={`/changes/${row.id}?return_to=${encodeURIComponent(returnTo)}`}
      >
        Review
      </Link>
    </article>
  );
}

function ContactChangeGroupCard({ rows }: { rows: PendingChangeRow[] }) {
  const first = rows[0];
  const identity = changeCardIdentity(first as ChangeCardInput);
  const fields = rows.flatMap((row) => proposedFieldRows({
    before: row.contact,
    change: row,
  })).filter((field) => field.supported);
  const fieldLabels = [...new Set(
    fields.map((field) => displayFieldLabel(field.key, field.label)),
  )];
  const summary = fieldLabels.length > 0
    ? `${fieldLabels.slice(0, 4).join(", ")}${fieldLabels.length > 4 ? ` and ${fieldLabels.length - 4} more` : ""}`
    : `${rows.length} proposed profile updates`;

  return (
    <article className="minimal-list-row change-list-row">
      <div className="person-change-head">
        <div>
          <h2>{identity.name}</h2>
          <p>{["Profile update", identity.company].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      <div className="change-list-summary">
        <p>{summary}</p>
        <small>
          {fieldLabels.length} profile field{fieldLabels.length === 1 ? "" : "s"} in one review
        </small>
      </div>
      <Link
        className="button ghost small"
        href={`/changes/${first.id}?return_to=${encodeURIComponent("/changes?view=profile")}`}
      >
        Review together
      </Link>
    </article>
  );
}

export default async function ChangesPage({
  searchParams,
}: {
  searchParams?: Promise<{ message?: string; view?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const { rows, setupMode, loadError } = await getPendingChanges();
  const activeRows = rows.filter(
    (row) =>
      replacementStatus(row) !== "replaced"
      && isOwnerActionableChange(row)
      && (isNewPersonChangeType(row.change_type) || Boolean(row.contact)),
  );
  const lanes: Array<{ key: ChangeLaneKey; title: string; rows: PendingChangeRow[] }> = [
    {
      key: "identity",
      title: "New people",
      rows: activeRows.filter((row) => changeLane(row) === "identity"),
    },
    {
      key: "follow_up",
      title: "Meeting follow-up",
      rows: activeRows.filter((row) => changeLane(row) === "follow_up"),
    },
    {
      key: "profile",
      title: "Profile updates",
      rows: activeRows.filter((row) => changeLane(row) === "profile"),
    },
  ];
  const profileGroups = profileChangeGroups(
    lanes.find((lane) => lane.key === "profile")?.rows ?? [],
  );
  const laneReviewCounts: Record<ChangeLaneKey, number> = {
    identity: lanes.find((lane) => lane.key === "identity")?.rows.length ?? 0,
    follow_up: lanes.find((lane) => lane.key === "follow_up")?.rows.length ?? 0,
    profile: profileGroups.length,
  };
  const lanePeopleCounts: Record<ChangeLaneKey, number> = Object.fromEntries(
    lanes.map((lane) => [lane.key, ownerChangedPeopleCount(lane.rows)]),
  ) as Record<ChangeLaneKey, number>;
  const reviewCount = laneReviewCounts.identity
    + laneReviewCounts.follow_up
    + laneReviewCounts.profile;
  const peopleCount = ownerChangedPeopleCount(activeRows);
  const availableLanes = lanes.filter((lane) => laneReviewCounts[lane.key] > 0);
  const requestedView = params.view as ChangeLaneKey | undefined;
  const activeLane = lanes.find((lane) => lane.key === requestedView) ?? availableLanes[0];
  const hasStatus = setupMode || loadError || Boolean(params.message);

  return (
    <div className="minimal-page changes-minimal">
      <header className="minimal-page-header">
        <div className="minimal-title-line">
          <h1>Changes</h1>
          <span>
            {peopleCount} {peopleCount === 1 ? "person" : "people"} to review
          </span>
        </div>
      </header>

      {hasStatus ? (
        <div className="changes-status-stack">
          {setupMode ? (
            <div className="notice">Your private Book is still being prepared.</div>
          ) : null}
          {loadError ? (
            <div className="notice" role="status">
              Changes could not be verified. Nothing has been approved or dismissed.
            </div>
          ) : null}
          {params.message ? <div className="notice">{params.message}</div> : null}
        </div>
      ) : null}

      {!loadError && reviewCount > 0 ? (
        <section className="minimal-section change-lane">
          <nav className="changes-view-tabs" aria-label="Change type">
            {lanes.map((lane) => (
              <Link
                aria-current={activeLane?.key === lane.key ? "page" : undefined}
                href={`/changes?view=${lane.key}`}
                key={lane.key}
              >
                {lane.title}{" "}
                <span>
                  {lanePeopleCounts[lane.key]} {lanePeopleCounts[lane.key] === 1 ? "person" : "people"}
                </span>
              </Link>
            ))}
          </nav>
          {activeLane ? (
            laneReviewCounts[activeLane.key] > 0 ? (
              <div className="minimal-list person-change-list">
                {activeLane.key === "profile"
                  ? profileGroups.map((group) => (
                    <ContactChangeGroupCard key={group.key} rows={group.rows} />
                  ))
                  : activeLane.rows.map((row) => (
                    <ContactChangeCard key={row.id} row={row} />
                  ))}
              </div>
            ) : (
              <div className="empty-state changes-empty-state">
                <b>No {activeLane.title.toLowerCase()} waiting.</b>
                <p>You can stay in this view while you work through changes.</p>
              </div>
            )
          ) : null}
        </section>
      ) : !loadError ? (
        <div className="empty-state changes-empty-state">
          <b>Everything is current.</b>
          <p>New updates will appear here.</p>
        </div>
      ) : null}
    </div>
  );
}
