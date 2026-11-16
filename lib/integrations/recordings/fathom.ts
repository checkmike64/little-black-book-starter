import { createHash } from "node:crypto";
import {
  cleanRecordingText,
  safeHttpUrl,
  uniqueEmails,
  RecordingArtifactPendingError,
  type NormalizedRecordingArtifact,
} from "./types.ts";

type FathomPayload = {
  recording_id?: string | number;
  id?: string | number;
  title?: string;
  meeting_title?: string;
  url?: string;
  share_url?: string;
  created_at?: string;
  recording_start_time?: string;
  recording_end_time?: string;
  recorded_by?: { name?: string; email?: string };
  calendar_invitees?: Array<{ email?: string; name?: string }>;
  transcript?: Array<{
    speaker?: { display_name?: string } | string;
    text?: string;
    timestamp?: string;
  }>;
  default_summary?: { markdown_formatted?: string; template_name?: string } | string;
  action_items?: Array<{
    description?: string;
    text?: string;
    assignee?: { name?: string; email?: string } | string;
    recording_timestamp?: string;
  }>;
};

export function normalizeFathomRecordingId(value: unknown) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return /^[1-9]\d*$/.test(cleaned) ? cleaned : null;
}

export function normalizeFathomArtifact(payload: FathomPayload): NormalizedRecordingArtifact {
  const externalArtifactId =
    normalizeFathomRecordingId(payload.recording_id) ||
    normalizeFathomRecordingId(payload.id);
  if (!externalArtifactId) throw new Error("Fathom recording ID is missing.");
  const rawTranscript = (payload.transcript ?? [])
    .map((entry) => {
      const speaker =
        typeof entry.speaker === "string"
          ? entry.speaker
          : entry.speaker?.display_name ?? "Speaker";
      return `${speaker}: ${entry.text ?? ""}`;
    })
    .join("\n")
    .slice(0, 2_000_000);
  const summarySource =
    typeof payload.default_summary === "string"
      ? payload.default_summary
      : payload.default_summary?.markdown_formatted;
  const summary = cleanRecordingText(summarySource, 7_500);
  if (!summary) {
    throw new RecordingArtifactPendingError(
      "Fathom has not supplied a usable meeting summary yet.",
    );
  }
  const start = new Date(
    cleanRecordingText(payload.recording_start_time || payload.created_at, 80),
  );
  const end = new Date(cleanRecordingText(payload.recording_end_time, 80));
  const durationSeconds =
    Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
      ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000))
      : 0;

  return {
    provider: "fathom",
    externalArtifactId,
    title:
      cleanRecordingText(payload.meeting_title || payload.title, 240) ||
      "Recorded meeting",
    occurredAt: Number.isFinite(start.getTime())
      ? start.toISOString()
      : new Date().toISOString(),
    durationSeconds,
    recordingUrl: safeHttpUrl(payload.url, {
      allowedHosts: ["fathom.video"],
      forbiddenPathPrefixes: ["/share/"],
    }),
    participantEmails: uniqueEmails(
      (payload.calendar_invitees ?? []).map((invitee) => invitee.email),
    ),
    participantNames: Array.from(
      new Set(
        (payload.calendar_invitees ?? [])
          .map((invitee) => cleanRecordingText(invitee.name, 160))
          .filter(Boolean),
      ),
    ),
    distilledSummary: `Provider-generated summary for review: ${summary}`,
    actionItems: (payload.action_items ?? []).flatMap((item) => {
      const text = cleanRecordingText(item.description || item.text, 1_200);
      if (!text) return [];
      const assignee =
        typeof item.assignee === "string" ? item.assignee : item.assignee?.name;
      const assigneeEmail =
        typeof item.assignee === "string"
          ? null
          : uniqueEmails([item.assignee?.email])[0] ?? null;
      return [
        {
          text,
          assignee: cleanRecordingText(assignee, 160) || null,
          assignee_email: assigneeEmail,
          owner_assigned: false,
          timestamp: cleanRecordingText(item.recording_timestamp, 80) || null,
          source: "provider_ai" as const,
        },
      ];
    }),
    transcriptSha256: rawTranscript
      ? createHash("sha256").update(rawTranscript).digest("hex")
      : null,
    metadata: {
      provider_summary: true,
      transcript_segment_count: payload.transcript?.length ?? 0,
      raw_transcript_stored: false,
    },
  };
}

function isFathomOwnerMeeting(payload: FathomPayload, ownerEmail: string) {
  return cleanRecordingText(payload.recorded_by?.email, 320).toLowerCase()
    === ownerEmail.trim().toLowerCase();
}

type FathomMeetingPage = {
  items?: FathomPayload[];
  next_cursor?: string | null;
};

export async function listRecentFathomArtifactIds({
  apiKey,
  since,
  ownerEmail,
}: {
  apiKey: string;
  since: string;
  ownerEmail: string;
}) {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 5 && ids.length < 50; page += 1) {
    const url = new URL("https://api.fathom.ai/external/v1/meetings");
    url.searchParams.set("created_after", since);
    url.searchParams.append("recorded_by[]", ownerEmail);
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
      headers: { "X-Api-Key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const payload = (await response.json().catch(() => null)) as FathomMeetingPage | null;
    if (!response.ok) throw new Error(`Fathom returned ${response.status}.`);
    for (const item of payload?.items ?? []) {
      const id = normalizeFathomRecordingId(item.recording_id);
      if (id && isFathomOwnerMeeting(item, ownerEmail) && !ids.includes(id)) ids.push(id);
      if (ids.length >= 50) break;
    }
    cursor = cleanRecordingText(payload?.next_cursor, 1000) || null;
    if (!cursor) break;
  }
  return ids;
}

export async function fetchFathomArtifact({
  apiKey,
  recordingId,
  ownerEmail,
}: {
  apiKey: string;
  recordingId: string | number;
  ownerEmail: string;
}): Promise<NormalizedRecordingArtifact> {
  const targetId = normalizeFathomRecordingId(recordingId);
  if (!targetId) throw new Error("Fathom recording ID is invalid.");
  let cursor: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const url = new URL("https://api.fathom.ai/external/v1/meetings");
    url.searchParams.set("include_summary", "true");
    url.searchParams.set("include_transcript", "true");
    url.searchParams.set("include_action_items", "true");
    url.searchParams.append("recorded_by[]", ownerEmail);
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
      headers: { "X-Api-Key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const payload = (await response.json().catch(() => null)) as FathomMeetingPage | null;
    if (!response.ok) throw new Error(`Fathom returned ${response.status}.`);
    const meeting = (payload?.items ?? []).find(
      (item) => normalizeFathomRecordingId(item.recording_id) === targetId,
    );
    if (meeting && isFathomOwnerMeeting(meeting, ownerEmail)) {
      return normalizeFathomArtifact(meeting);
    }
    cursor = cleanRecordingText(payload?.next_cursor, 1000) || null;
    if (!cursor) break;
  }
  throw new RecordingArtifactPendingError(
    "Fathom has not made this recording available through the API yet.",
  );
}

export function markFathomOwnerAssigned(
  artifact: NormalizedRecordingArtifact,
  externalAccountEmail: string | null,
) {
  if (artifact.provider !== "fathom") return artifact;
  const ownerEmail = externalAccountEmail?.trim().toLowerCase() ?? "";
  return {
    ...artifact,
    actionItems: artifact.actionItems.map((item) => ({
      ...item,
      owner_assigned: Boolean(
        ownerEmail && item.assignee_email?.trim().toLowerCase() === ownerEmail,
      ),
    })),
  };
}
