export const recordingInboxViews = ["to_process", "processed"] as const;

export type RecordingInboxView = (typeof recordingInboxViews)[number];

export const recordingFollowupRoutes = [
  "action",
  "owner_promise",
  "contact_promise",
  "context",
  "dismiss",
] as const;

export type RecordingFollowupRoute = (typeof recordingFollowupRoutes)[number];

export type RecordingFollowupRouteInput = {
  followupId: string;
  route: RecordingFollowupRoute;
  contactId: string | null;
  dueOn: string | null;
  note: string | null;
};

export const recordingFollowupClassifications = [
  "action",
  "owner_promise",
  "contact_promise",
] as const;

export const recordingFollowupOutcomes = [
  "approve",
  "already_done",
  "decline",
] as const;

export type RecordingFollowupClassification =
  (typeof recordingFollowupClassifications)[number];
export type RecordingFollowupOutcome = (typeof recordingFollowupOutcomes)[number];

export type RecordingFollowupDecisionInput = {
  followupId: string;
  classification: RecordingFollowupClassification;
  outcome: RecordingFollowupOutcome;
  contactId: string | null;
  meetingContactIds: string[];
  dueOn: string | null;
  note: string | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const compactUuidPattern = /^[0-9a-f]{32}$/i;

function dateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function compactToUuid(value: string) {
  const compact = value.toLowerCase();
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join("-");
}

export function meetingContactIdsFromForm(formData: FormData) {
  return Array.from(new Set(
    [
      ...formData.getAll("meeting_contact_ids"),
      ...formData.getAll("contact_ids"),
    ]
      .map((value) => String(value).trim().toLowerCase())
      .filter((value) => uuidPattern.test(value)),
  )).slice(0, 100);
}

export function recordingInboxView(value: unknown): RecordingInboxView {
  if (value === "review" || value === "followups") return "to_process";
  if (value === "filed") return "processed";
  return recordingInboxViews.includes(value as RecordingInboxView)
    ? value as RecordingInboxView
    : "to_process";
}

export function parseRecordingFollowupRouteForm(
  formData: FormData,
): { ok: true; value: RecordingFollowupRouteInput } | { ok: false; message: string } {
  const followupId = String(formData.get("followup_id") ?? "").trim();
  const route = String(formData.get("route") ?? "").trim() as RecordingFollowupRoute;
  const submittedContactId = String(formData.get("contact_id") ?? "").trim();
  const submittedDueOn = String(formData.get("due_on") ?? "").trim();
  const note = String(formData.get("note") ?? "").replace(/\s+/g, " ").trim().slice(0, 1_000);

  if (!uuidPattern.test(followupId)) {
    return { ok: false, message: "That meeting follow-up could not be identified." };
  }
  if (!recordingFollowupRoutes.includes(route)) {
    return { ok: false, message: "Choose how to file this meeting follow-up." };
  }
  if (submittedContactId && !uuidPattern.test(submittedContactId)) {
    return { ok: false, message: "Choose a valid person for this follow-up." };
  }
  const dueOn = submittedDueOn ? dateOnly(submittedDueOn) : null;
  if (submittedDueOn && !dueOn) {
    return { ok: false, message: "Choose a valid follow-up date." };
  }
  if (
    (route === "owner_promise" || route === "contact_promise")
    && !submittedContactId
  ) {
    return { ok: false, message: "Choose who this promise is with." };
  }

  return {
    ok: true,
    value: {
      followupId,
      route,
      contactId:
        route === "dismiss" ? null : submittedContactId || null,
      dueOn:
        route === "action" || route === "owner_promise" || route === "contact_promise"
          ? dueOn
          : null,
      note: note || null,
    },
  };
}

export function parseRecordingFollowupDecisionForm(
  formData: FormData,
): { ok: true; value: RecordingFollowupDecisionInput } | { ok: false; message: string } {
  const followupId = String(formData.get("followup_id") ?? "").trim();
  const classification = String(formData.get("classification") ?? "").trim() as
    RecordingFollowupClassification;
  const outcome = String(formData.get("outcome") ?? "").trim() as RecordingFollowupOutcome;
  const submittedContactId = String(formData.get("contact_id") ?? "").trim();
  const submittedDueOn = String(formData.get("due_on") ?? "").trim();
  const note = String(formData.get("note") ?? "").replace(/\s+/g, " ").trim().slice(0, 1_000);
  const meetingContactIds = meetingContactIdsFromForm(formData);

  if (!uuidPattern.test(followupId)) {
    return { ok: false, message: "That meeting follow-up could not be identified." };
  }
  if (outcome === "approve" && !recordingFollowupClassifications.includes(classification)) {
    return { ok: false, message: "Choose who will handle this follow-up." };
  }
  if (!recordingFollowupOutcomes.includes(outcome)) {
    return { ok: false, message: "Choose what should happen to this follow-up." };
  }
  if (submittedContactId && !uuidPattern.test(submittedContactId)) {
    return { ok: false, message: "Choose a valid person for this follow-up." };
  }
  const dueOn = submittedDueOn ? dateOnly(submittedDueOn) : null;
  if (submittedDueOn && !dueOn) {
    return { ok: false, message: "Choose a valid follow-up date." };
  }
  if (outcome === "approve" && !submittedContactId) {
    return { ok: false, message: "Choose who this follow-up is with." };
  }
  if (meetingContactIds.length === 0) {
    return { ok: false, message: "Choose at least one person who attended this meeting." };
  }

  return {
    ok: true,
    value: {
      followupId,
      classification: recordingFollowupClassifications.includes(classification)
        ? classification
        : "action",
      outcome,
      contactId: outcome === "decline" ? null : submittedContactId || null,
      meetingContactIds,
      dueOn: outcome === "approve" ? dueOn : null,
      note: note || null,
    },
  };
}

export function parseNotionMeetingReference(value: unknown) {
  const submitted = typeof value === "string" ? value.trim().slice(0, 1_000) : "";
  if (!submitted) return null;
  if (uuidPattern.test(submitted)) return submitted.toLowerCase();
  if (compactUuidPattern.test(submitted)) return compactToUuid(submitted);

  try {
    const url = new URL(submitted);
    if (
      url.protocol !== "https:"
      || !(
        url.hostname === "notion.so"
        || url.hostname.endsWith(".notion.so")
        || url.hostname === "notion.com"
        || url.hostname.endsWith(".notion.com")
      )
    ) return null;
    const candidates = decodeURIComponent(url.pathname).match(/[0-9a-f]{32}/gi) ?? [];
    const candidate = candidates.at(-1);
    return candidate ? compactToUuid(candidate) : null;
  } catch {
    return null;
  }
}
