import { pendingChangePayloadBody } from "./pending-change-inspection.ts";
import { isNewPersonChangeType } from "./pending-change-types.ts";

export type ChangeCardInput = {
  contact_id?: string | null;
  change_type: string;
  payload: Record<string, unknown>;
  summary: string;
  source?: string | null;
  contact?: {
    full_name: string;
    company_name: string | null;
  } | null;
};

const fieldLabels: Record<string, string> = {
  company_name: "company",
  current_asks: "current ask",
  how_we_met: "how you met",
  ideal_referral: "ideal referral",
  one_line_summary: "summary",
  relationship_strength: "relationship strength",
  relationship_type: "relationship type",
  role_title: "job title",
  trust_level: "trust level",
  why_stay_in_touch: "reason to stay in touch",
};

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function recordingActionPresentation(change: ChangeCardInput) {
  if (change.source !== "recording_operator" || change.change_type !== "recording_action") {
    return null;
  }
  const action = record(change.payload.action);
  const meeting = record(change.payload.meeting);
  const evidence = record(change.payload.evidence);
  const title = text(action?.title);
  if (!title) return null;
  return {
    title,
    dueOn: text(action?.due_on),
    note: text(action?.note),
    meetingTitle: text(meeting?.title),
    meetingOccurredAt: text(meeting?.occurred_at),
    meetingSource: text(meeting?.source),
    evidenceSummary: text(evidence?.evidence_summary),
  };
}

function formatValue(value: unknown) {
  if (Array.isArray(value)) {
    const values = value.map(String).map((item) => item.trim()).filter(Boolean);
    return values.length > 0 ? values.join(", ") : "Not provided";
  }
  if (value === null || value === undefined || value === "") return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function proposalBody(change: ChangeCardInput) {
  return pendingChangePayloadBody(change);
}

function quoted(value: unknown) {
  return `“${formatValue(value)}”`;
}

function proposalIdentity(change: ChangeCardInput) {
  const body = proposalBody(change);
  const name =
    change.contact?.full_name ??
    text(body.full_name) ??
    text(body.name) ??
    "New person";
  const company = change.contact?.company_name ?? text(body.company_name) ?? text(body.company);

  return { name, company };
}

export function changeCardIdentity(change: ChangeCardInput) {
  return proposalIdentity(change);
}

export function changeCardGroupKey(change: ChangeCardInput) {
  if (change.contact_id) return `contact:${change.contact_id}`;
  if (change.contact?.full_name) return `contact:${change.contact.full_name}`;
  const identity = proposalIdentity(change);
  return `person:${identity.name}:${identity.company ?? ""}`;
}

export function changeRecommendationLines(change: ChangeCardInput) {
  const recordingAction = recordingActionPresentation(change);
  if (recordingAction) {
    return [
      `Add this to Next Moves: ${quoted(recordingAction.title)}`,
      ...(recordingAction.dueOn ? [`Due ${recordingAction.dueOn}.`] : []),
      ...(recordingAction.note ? [`Operator note: ${quoted(recordingAction.note)}`] : []),
    ];
  }
  const body = proposalBody(change);

  if (isNewPersonChangeType(change.change_type)) {
    return [`Add ${proposalIdentity(change).name} to your Book.`];
  }

  if (change.change_type === "want_to_know_candidate") {
    const bucket = text(body.bucket);
    return [
      bucket
        ? `Add ${proposalIdentity(change).name} to ${bucket} in Want to Know.`
        : `Add ${proposalIdentity(change).name} to Want to Know.`,
    ];
  }

  const lines = Object.entries(body).map(([field, value]) => {
    if (field === "relationship_type") {
      return `Set the relationship type to ${formatValue(value)}.`;
    }
    if (field === "why_stay_in_touch") {
      return `Save this reason to stay in touch: ${quoted(value)}`;
    }
    if (field === "role_title") {
      return `Update the job title to ${formatValue(value)}.`;
    }
    if (field === "company_name") {
      return `Update the company to ${formatValue(value)}.`;
    }
    if (field === "one_line_summary") {
      return `Update the summary to ${quoted(value)}`;
    }

    const label = fieldLabels[field] ?? field.replaceAll("_", " ");
    return `Update the ${label} to ${formatValue(value)}.`;
  });

  return lines.length > 0 ? lines : [change.summary];
}

export function changeApprovalLabel(change: ChangeCardInput) {
  if (recordingActionPresentation(change)) return "Approve action";
  const body = proposalBody(change);
  const entries = Object.entries(body);

  if (isNewPersonChangeType(change.change_type)) return "Add to Book";
  if (change.change_type === "want_to_know_candidate") return "Add to Want to Know";
  if (entries.length !== 1) return "Approve changes";

  const [field, value] = entries[0];
  if (field === "relationship_type") {
    const formatted = formatValue(value);
    return formatted.length <= 28 ? `Approve ${formatted}` : "Approve relationship";
  }
  if (field === "trust_level") return `Set trust to ${formatValue(value)}`;
  if (field === "relationship_strength") {
    return `Set strength to ${formatValue(value)}`;
  }
  if (field === "role_title") return "Approve title";
  if (field === "company_name") return "Approve company";
  if (field === "why_stay_in_touch") return "Save reason";
  return "Approve";
}

export function changeRationale(change: ChangeCardInput) {
  const recordingAction = recordingActionPresentation(change);
  if (recordingAction) {
    const source = [
      recordingAction.meetingTitle,
      recordingAction.meetingOccurredAt,
      recordingAction.meetingSource,
    ].filter(Boolean).join(" · ");
    return {
      summary: recordingAction.evidenceSummary
        ?? "This action was classified from the meeting follow-up shown above.",
      source: source || "Meeting notes",
      confidence: null,
    };
  }
  const evidence = record(change.payload.evidence);
  const verification = record(change.payload.verification);
  const summary =
    text(evidence?.verification_summary) ??
    text(verification?.summary) ??
    text(change.payload.rationale) ??
    text(change.payload.reason);
  const source = text(evidence?.source_ref) ?? text(change.source);
  const confidence = text(change.payload.confidence);

  return {
    summary: summary ?? "This recommendation is waiting for your judgment before it changes the Book.",
    source,
    confidence,
  };
}
