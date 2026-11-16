export const recordingProviders = ["fireflies", "fathom", "google_meet", "notion"] as const;

export type RecordingProvider = (typeof recordingProviders)[number];

export type NormalizedRecordingArtifact = {
  provider: RecordingProvider;
  externalArtifactId: string;
  title: string;
  occurredAt: string;
  durationSeconds: number;
  recordingUrl: string | null;
  participantEmails: string[];
  participantNames: string[];
  distilledSummary: string;
  actionItems: Array<{
    text: string;
    assignee?: string | null;
    assignee_email?: string | null;
    owner_assigned?: boolean;
    timestamp?: string | null;
    source: "provider_ai" | "provider_transcript";
  }>;
  transcriptSha256: string | null;
  metadata: Record<string, unknown>;
};

export type RecordingConnectionSecret = {
  connection_id: string;
  tenant_id: string;
  owner_user_id: string;
  provider: RecordingProvider;
  connection_status: "active" | "needs_attention" | "disconnected";
  api_key: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  webhook_secret: string | null;
  scopes: string[];
  external_account_email: string | null;
};

export function cleanRecordingText(value: unknown, limit: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function safeHttpUrl(
  value: unknown,
  options: { allowedHosts?: string[]; forbiddenPathPrefixes?: string[] } = {},
) {
  const cleaned = cleanRecordingText(value, 1000);
  if (!cleaned) return null;
  try {
    const url = new URL(cleaned);
    if (url.protocol !== "https:") return null;
    if (
      options.allowedHosts?.length &&
      !options.allowedHosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    ) {
      return null;
    }
    if (
      options.forbiddenPathPrefixes?.some((prefix) =>
        url.pathname.toLowerCase().startsWith(prefix.toLowerCase()),
      )
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export class RecordingArtifactPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingArtifactPendingError";
  }
}

export function uniqueEmails(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .map((value) => cleanRecordingText(value, 320).toLowerCase())
        .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)),
    ),
  ).slice(0, 100);
}
