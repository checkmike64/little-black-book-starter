import { createHash } from "node:crypto";
import {
  cleanRecordingText,
  safeHttpUrl,
  uniqueEmails,
  RecordingArtifactPendingError,
  type NormalizedRecordingArtifact,
} from "./types.ts";

type FirefliesTranscript = {
  id?: string;
  title?: string;
  dateString?: string;
  duration?: number;
  transcript_url?: string;
  organizer_email?: string;
  participants?: string[];
  meeting_attendees?: Array<{ displayName?: string; email?: string }>;
  sentences?: Array<{
    speaker_name?: string;
    text?: string;
    start_time?: string;
    end_time?: string;
  }>;
  summary?: {
    overview?: string;
    short_summary?: string;
    action_items?: string;
    topics_discussed?: string[];
  };
};

const transcriptQuery = `query Transcript($transcriptId: String!) {
  transcript(id: $transcriptId) {
    id title dateString duration transcript_url organizer_email participants
    meeting_attendees { displayName email }
    sentences { speaker_name text start_time end_time }
    summary { overview short_summary action_items topics_discussed }
  }
}`;

const transcriptOwnershipQuery = `query TranscriptOwnership($transcriptId: String!) {
  transcript(id: $transcriptId) { id organizer_email }
}`;

const recentTranscriptsQuery = `query RecentTranscripts($fromDate: DateTime, $limit: Int) {
  transcripts(fromDate: $fromDate, limit: $limit, mine: true) { id organizer_email }
}`;

export async function listRecentFirefliesArtifactIds({
  apiKey,
  since,
  ownerEmail,
}: {
  apiKey: string;
  since: string;
  ownerEmail: string;
}) {
  const response = await fetch("https://api.fireflies.ai/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: recentTranscriptsQuery,
      variables: { fromDate: since, limit: 50 },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: { transcripts?: Array<{ id?: string; organizer_email?: string }> }; errors?: Array<{ message?: string }> }
    | null;
  if (!response.ok || payload?.errors?.length) {
    throw new Error(
      cleanRecordingText(payload?.errors?.[0]?.message, 300) ||
        `Fireflies returned ${response.status}.`,
    );
  }
  return Array.from(
    new Set(
      (payload?.data?.transcripts ?? [])
        .filter((transcript) =>
          cleanRecordingText(transcript.organizer_email, 320).toLowerCase()
            === ownerEmail.trim().toLowerCase(),
        )
        .map((transcript) => cleanRecordingText(transcript.id, 320))
        .filter(Boolean),
    ),
  ).slice(0, 50);
}

export async function fetchFirefliesArtifact({
  apiKey,
  meetingId,
  ownerEmail,
}: {
  apiKey: string;
  meetingId: string;
  ownerEmail: string;
}): Promise<NormalizedRecordingArtifact> {
  const ownershipResponse = await fetch("https://api.fireflies.ai/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: transcriptOwnershipQuery,
      variables: { transcriptId: meetingId },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const ownershipPayload = (await ownershipResponse.json().catch(() => null)) as
    | { data?: { transcript?: Pick<FirefliesTranscript, "id" | "organizer_email"> }; errors?: Array<{ message?: string }> }
    | null;
  const ownership = ownershipPayload?.data?.transcript;
  if (!ownershipResponse.ok || !ownership?.id) {
    throw new Error(
      cleanRecordingText(ownershipPayload?.errors?.[0]?.message, 300) ||
        `Fireflies returned ${ownershipResponse.status}.`,
    );
  }
  if (
    cleanRecordingText(ownership.organizer_email, 320).toLowerCase()
      !== ownerEmail.trim().toLowerCase()
  ) {
    throw new Error("Fireflies recording is not owned by the authorized account.");
  }

  const response = await fetch("https://api.fireflies.ai/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: transcriptQuery, variables: { transcriptId: meetingId } }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: { transcript?: FirefliesTranscript }; errors?: Array<{ message?: string }> }
    | null;
  const transcript = payload?.data?.transcript;
  if (!response.ok || !transcript?.id) {
    throw new Error(
      cleanRecordingText(payload?.errors?.[0]?.message, 300) ||
        `Fireflies returned ${response.status}.`,
    );
  }
  if (
    cleanRecordingText(transcript.organizer_email, 320).toLowerCase()
      !== ownerEmail.trim().toLowerCase()
  ) {
    throw new Error("Fireflies recording ownership changed during import.");
  }
  const transcriptText = (transcript.sentences ?? [])
    .map((sentence) => `${sentence.speaker_name ?? "Speaker"}: ${sentence.text ?? ""}`)
    .join("\n")
    .slice(0, 2_000_000);
  const summary = cleanRecordingText(
    transcript.summary?.short_summary || transcript.summary?.overview,
    7_500,
  );
  if (!summary) {
    throw new RecordingArtifactPendingError(
      "Fireflies has not produced a usable meeting summary yet.",
    );
  }
  const actionText = cleanRecordingText(transcript.summary?.action_items, 8_000);
  const participantEmails = uniqueEmails([
    ...(transcript.participants ?? []),
    ...(transcript.meeting_attendees ?? []).map((attendee) => attendee.email),
  ]);
  return {
    provider: "fireflies",
    externalArtifactId: transcript.id,
    title: cleanRecordingText(transcript.title, 240) || "Recorded meeting",
    occurredAt:
      cleanRecordingText(transcript.dateString, 80) || new Date().toISOString(),
    durationSeconds: Math.max(0, Math.round((transcript.duration ?? 0) * 60)),
    recordingUrl: safeHttpUrl(transcript.transcript_url, {
      allowedHosts: ["fireflies.ai"],
    }),
    participantEmails,
    participantNames: Array.from(
      new Set(
        (transcript.meeting_attendees ?? [])
          .map((attendee) => cleanRecordingText(attendee.displayName, 160))
          .filter(Boolean),
      ),
    ),
    distilledSummary: `Provider-generated summary for review: ${summary}`,
    actionItems: actionText
      ? [{ text: actionText, source: "provider_ai" as const }]
      : [],
    transcriptSha256: transcriptText
      ? createHash("sha256").update(transcriptText).digest("hex")
      : null,
    metadata: {
      provider_summary: true,
      topics: (transcript.summary?.topics_discussed ?? []).slice(0, 30),
      transcript_segment_count: transcript.sentences?.length ?? 0,
      raw_transcript_stored: false,
    },
  };
}
