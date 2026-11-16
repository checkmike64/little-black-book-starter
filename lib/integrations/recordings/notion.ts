import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  cleanRecordingText,
  RecordingArtifactPendingError,
  safeHttpUrl,
  type NormalizedRecordingArtifact,
} from "./types.ts";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const NOTION_AUTH_URL = "https://api.notion.com/v1/oauth/authorize";
const MAX_BLOCKS = 600;
const MAX_TRANSIENT_TEXT = 120_000;

type NotionRichText = { plain_text?: string };

type NotionBlock = {
  id?: string;
  type?: string;
  has_children?: boolean;
  [key: string]: unknown;
};

type NotionMeetingNote = NotionBlock & {
  id: string;
  type: "meeting_notes";
  created_time?: string;
  last_edited_time?: string;
  meeting_notes?: {
    title?: NotionRichText[];
    status?: string;
    children?: {
      summary_block_id?: string | null;
      notes_block_id?: string | null;
      transcript_block_id?: string | null;
    };
    calendar_event?: {
      start_time?: string | null;
      end_time?: string | null;
      attendees?: string[];
    };
    recording?: {
      start_time?: string | null;
      end_time?: string | null;
    };
  };
};

type NotionTokenResponse = {
  access_token?: string;
  refresh_token?: string | null;
  token_type?: string;
  bot_id?: string;
  workspace_id?: string;
  workspace_name?: string;
  owner?: {
    type?: string;
    user?: {
      id?: string;
      name?: string;
      person?: { email?: string; email_verified?: boolean };
    };
  };
  error?: string;
  code?: string;
  message?: string;
};

type BlockListResponse = {
  results?: NotionBlock[];
  has_more?: boolean;
  next_cursor?: string | null;
};

type MeetingNoteQueryResponse = {
  results?: NotionMeetingNote[];
  has_more?: boolean;
};

export type NotionArtifactObservation = {
  artifactId: string;
  readiness: "ready" | "pending";
  providerStatus: string;
  occurredAt: string;
  lastEditedAt: string | null;
};

export type NotionArtifactScan = {
  observations: NotionArtifactObservation[];
  readyArtifactIds: string[];
  pendingArtifactIds: string[];
  hasMore: boolean;
  observedAt: string;
};

export type NotionWebhookEvent = {
  id: string;
  timestamp: string;
  workspaceId: string;
  subscriptionId: string;
  integrationId: string;
  type: string;
  attemptNumber: number;
  entity: {
    id: string;
    type: string;
  };
};

export class NotionAuthorizationError extends Error {
  constructor(message = "Notion authorization needs to be renewed.") {
    super(message);
    this.name = "NotionAuthorizationError";
  }
}

function requiredOauthConfig() {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Notion OAuth is not configured for this install.");
  }
  return { clientId, clientSecret };
}

export function notionOauthConfigured() {
  return Boolean(
    process.env.NOTION_OAUTH_CLIENT_ID?.trim()
      && process.env.NOTION_OAUTH_CLIENT_SECRET?.trim(),
  );
}

export function notionRedirectUri(origin: string) {
  return process.env.NOTION_REDIRECT_URI?.trim()
    || `${origin.replace(/\/$/, "")}/api/integrations/notion/callback`;
}

export function createNotionOauthState() {
  return randomBytes(32).toString("base64url");
}

export function notionAuthorizationUrl({
  redirectUri,
  state,
}: {
  redirectUri: string;
  state: string;
}) {
  const { clientId } = requiredOauthConfig();
  const params = new URLSearchParams({
    owner: "user",
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  return `${NOTION_AUTH_URL}?${params.toString()}`;
}

async function notionOauthRequest(payload: Record<string, string>) {
  const { clientId, clientSecret } = requiredOauthConfig();
  const response = await fetch(`${NOTION_API}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const result = (await response.json()) as NotionTokenResponse;
  if (!response.ok || !result.access_token) {
    throw new Error(cleanRecordingText(
      result.message || result.error || result.code || "Notion authorization failed.",
      320,
    ));
  }
  return result;
}

export function exchangeNotionCode({
  code,
  redirectUri,
}: {
  code: string;
  redirectUri: string;
}) {
  return notionOauthRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
}

export function refreshNotionToken(refreshToken: string) {
  return notionOauthRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

async function notionRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const payload = (await response.json()) as T & { message?: string; code?: string };
  if (response.status === 401 || response.status === 403) {
    throw new NotionAuthorizationError();
  }
  if (!response.ok) {
    throw new Error(cleanRecordingText(
      payload.message || payload.code || "Notion meeting notes could not be loaded.",
      320,
    ));
  }
  return payload;
}

function richText(value: unknown) {
  if (!Array.isArray(value)) return "";
  return cleanRecordingText(
    value.map((item) => {
      if (!item || typeof item !== "object") return "";
      return String((item as NotionRichText).plain_text ?? "");
    }).join(" "),
    8_000,
  );
}

function blockText(block: NotionBlock) {
  const type = cleanRecordingText(block.type, 80);
  if (!type) return "";
  const body = block[type];
  if (!body || typeof body !== "object") return "";
  const value = body as { rich_text?: NotionRichText[]; caption?: NotionRichText[] };
  return richText(value.rich_text ?? value.caption);
}

function validIso(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}

function normalizedMeetingNoteObservation(
  note: NotionMeetingNote,
): NotionArtifactObservation | null {
  if (note.type !== "meeting_notes") return null;
  const artifactId = cleanRecordingText(note.id, 320);
  if (!artifactId) return null;
  const providerStatus = cleanRecordingText(note.meeting_notes?.status, 120)
    || "unknown";
  return {
    artifactId,
    readiness: providerStatus === "notes_ready" ? "ready" : "pending",
    providerStatus,
    occurredAt: meetingOccurredAt(note),
    lastEditedAt: validIso(note.last_edited_time),
  };
}

async function retrieveBlock(accessToken: string, blockId: string) {
  return notionRequest<NotionMeetingNote>(accessToken, `/blocks/${encodeURIComponent(blockId)}`);
}

async function retrieveDirectBlockChildren(accessToken: string, parentBlockId: string) {
  const collected: NotionBlock[] = [];
  let cursor: string | null = null;
  let complete = true;
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("start_cursor", cursor);
    const page = await notionRequest<BlockListResponse>(
      accessToken,
      `/blocks/${encodeURIComponent(parentBlockId)}/children?${params.toString()}`,
    );
    collected.push(...(page.results ?? []).slice(0, MAX_BLOCKS - collected.length));
    const hasMore = Boolean(page.has_more && page.next_cursor);
    if (hasMore && collected.length >= MAX_BLOCKS) complete = false;
    cursor = hasMore && complete ? page.next_cursor as string : null;
  } while (cursor);
  return { children: collected, complete };
}

async function retrieveBlockTree(accessToken: string, rootBlockId?: string | null) {
  if (!rootBlockId) return [] as NotionBlock[];
  const collected: NotionBlock[] = [];
  const queue = [rootBlockId];
  while (queue.length && collected.length < MAX_BLOCKS) {
    const parentId = queue.shift() as string;
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ page_size: "100" });
      if (cursor) params.set("start_cursor", cursor);
      const page = await notionRequest<BlockListResponse>(
        accessToken,
        `/blocks/${encodeURIComponent(parentId)}/children?${params.toString()}`,
      );
      for (const block of page.results ?? []) {
        if (collected.length >= MAX_BLOCKS) break;
        collected.push(block);
        if (block.has_children && block.id) queue.push(block.id);
      }
      cursor = page.has_more && page.next_cursor ? page.next_cursor : null;
    } while (cursor && collected.length < MAX_BLOCKS);
  }
  return collected;
}

function blocksToText(blocks: NotionBlock[], limit: number) {
  return blocks
    .map(blockText)
    .filter(Boolean)
    .join("\n")
    .slice(0, limit)
    .trim();
}

function notionActionItems(blocks: NotionBlock[]) {
  return blocks
    .filter((block) => block.type === "to_do")
    .map(blockText)
    .filter(Boolean)
    .slice(0, 30)
    .map((text) => ({
      text: text.slice(0, 1_200),
      source: "provider_ai" as const,
    }));
}

function meetingTitle(note: NotionMeetingNote) {
  return richText(note.meeting_notes?.title) || "Notion AI meeting notes";
}

function meetingOccurredAt(note: NotionMeetingNote) {
  return validIso(note.meeting_notes?.calendar_event?.start_time)
    ?? validIso(note.meeting_notes?.recording?.start_time)
    ?? validIso(note.created_time)
    ?? new Date().toISOString();
}

function durationSeconds(note: NotionMeetingNote) {
  const start = validIso(note.meeting_notes?.recording?.start_time)
    ?? validIso(note.meeting_notes?.calendar_event?.start_time);
  const end = validIso(note.meeting_notes?.recording?.end_time)
    ?? validIso(note.meeting_notes?.calendar_event?.end_time);
  if (!start || !end) return 0;
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1_000));
}

export async function scanRecentNotionArtifacts({
  accessToken,
  since,
}: {
  accessToken: string;
  since: string;
}): Promise<NotionArtifactScan> {
  const response = await notionRequest<MeetingNoteQueryResponse>(
    accessToken,
    "/blocks/meeting_notes/query",
    {
      method: "POST",
      body: JSON.stringify({
        sort: [{ property: "last_edited_time", direction: "descending" }],
        limit: 50,
      }),
    },
  );
  const cutoff = Date.parse(since);
  if (Number.isNaN(cutoff)) throw new Error("The Notion scan cursor is invalid.");
  const observations = Array.from(
    new Map((response.results ?? [])
      .map(normalizedMeetingNoteObservation)
      .filter((observation): observation is NotionArtifactObservation => Boolean(observation))
      .filter((observation) => {
        const lastEdited = observation.lastEditedAt
          ? Date.parse(observation.lastEditedAt)
          : Number.NEGATIVE_INFINITY;
        return Math.max(lastEdited, Date.parse(observation.occurredAt)) >= cutoff;
      })
      .map((observation) => [observation.artifactId, observation])).values(),
  );
  return {
    observations,
    readyArtifactIds: observations
      .filter((observation) => observation.readiness === "ready")
      .map((observation) => observation.artifactId),
    pendingArtifactIds: observations
      .filter((observation) => observation.readiness === "pending")
      .map((observation) => observation.artifactId),
    hasMore: Boolean(response.has_more),
    observedAt: new Date().toISOString(),
  };
}

export async function listRecentNotionArtifactIds(args: {
  accessToken: string;
  since: string;
}) {
  return (await scanRecentNotionArtifacts(args)).readyArtifactIds;
}

export async function observeNotionArtifact({
  accessToken,
  meetingNoteId,
}: {
  accessToken: string;
  meetingNoteId: string;
}) {
  const note = await retrieveBlock(accessToken, meetingNoteId);
  const directObservation = normalizedMeetingNoteObservation(note);
  if (directObservation) return directObservation;

  // Notion's copied meeting URL identifies the containing page, while the API
  // exposes the meeting itself as a direct meeting_notes child block.
  const directChildren = await retrieveDirectBlockChildren(accessToken, meetingNoteId);
  if (!directChildren.complete) return null;
  const childObservations = directChildren.children
    .map((child) => normalizedMeetingNoteObservation(child as NotionMeetingNote))
    .filter((observation): observation is NotionArtifactObservation => Boolean(observation));
  return childObservations.length === 1 ? childObservations[0] : null;
}

function safeSecretEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyNotionWebhookSignature({
  rawBody,
  signature,
  secret,
}: {
  rawBody: string;
  signature: string | null;
  secret: string;
}) {
  const normalizedSignature = signature?.trim().toLowerCase() ?? "";
  if (!secret || !/^sha256=[0-9a-f]{64}$/.test(normalizedSignature)) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return safeSecretEqual(normalizedSignature, expected);
}

export function verifyNotionWebhookSetupSecret({
  provided,
  secret,
}: {
  provided: string | null;
  secret: string;
}) {
  return Boolean(provided && secret && safeSecretEqual(provided, secret));
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseNotionWebhookPayload(rawBody: string):
  | { kind: "verification"; verificationToken: string }
  | { kind: "event"; event: NotionWebhookEvent }
  | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const payload = objectValue(parsed);
  if (!payload) return null;
  const verificationToken = cleanRecordingText(payload.verification_token, 320);
  if (verificationToken) return { kind: "verification", verificationToken };

  const entity = objectValue(payload.entity);
  const id = cleanRecordingText(payload.id, 320);
  const timestamp = validIso(payload.timestamp);
  const workspaceId = cleanRecordingText(payload.workspace_id, 160);
  const subscriptionId = cleanRecordingText(payload.subscription_id, 160);
  const integrationId = cleanRecordingText(payload.integration_id, 160);
  const type = cleanRecordingText(payload.type, 120);
  const entityId = cleanRecordingText(entity?.id, 320);
  const entityType = cleanRecordingText(entity?.type, 80);
  const attemptNumber = typeof payload.attempt_number === "number"
    && Number.isSafeInteger(payload.attempt_number)
    && payload.attempt_number >= 1
    ? payload.attempt_number
    : 1;
  if (
    !id || !timestamp || !workspaceId || !subscriptionId || !integrationId
    || !type || !entityId || !entityType
  ) return null;
  return {
    kind: "event",
    event: {
      id,
      timestamp,
      workspaceId,
      subscriptionId,
      integrationId,
      type,
      attemptNumber,
      entity: { id: entityId, type: entityType },
    },
  };
}

export async function fetchNotionArtifact({
  accessToken,
  meetingNoteId,
}: {
  accessToken: string;
  meetingNoteId: string;
}): Promise<NormalizedRecordingArtifact> {
  const note = await retrieveBlock(accessToken, meetingNoteId);
  if (note.type !== "meeting_notes" || note.id !== meetingNoteId) {
    throw new Error("Notion meeting note identity could not be verified.");
  }
  if (note.meeting_notes?.status !== "notes_ready") {
    throw new RecordingArtifactPendingError("Notion meeting notes are not ready yet.");
  }
  const childIds = note.meeting_notes.children;
  const [summaryBlocks, notesBlocks, transcriptBlocks] = await Promise.all([
    retrieveBlockTree(accessToken, childIds?.summary_block_id),
    retrieveBlockTree(accessToken, childIds?.notes_block_id),
    retrieveBlockTree(accessToken, childIds?.transcript_block_id),
  ]);
  const summaryText = blocksToText(summaryBlocks, 7_500);
  const notesText = blocksToText(notesBlocks, 7_500);
  const distilledSummary = summaryText || notesText;
  if (!distilledSummary) {
    throw new RecordingArtifactPendingError("Notion meeting notes do not have a summary yet.");
  }
  const transcriptText = blocksToText(transcriptBlocks, MAX_TRANSIENT_TEXT);
  const occurredAt = meetingOccurredAt(note);
  const blockUrl = safeHttpUrl(
    `https://www.notion.so/${meetingNoteId.replace(/-/g, "")}`,
    { allowedHosts: ["notion.so"] },
  );
  return {
    provider: "notion",
    externalArtifactId: meetingNoteId,
    title: meetingTitle(note).slice(0, 240),
    occurredAt,
    durationSeconds: durationSeconds(note),
    recordingUrl: blockUrl,
    participantEmails: [],
    participantNames: [],
    distilledSummary,
    actionItems: notionActionItems([...summaryBlocks, ...notesBlocks]),
    transcriptSha256: transcriptText
      ? createHash("sha256").update(transcriptText).digest("hex")
      : null,
    metadata: {
      notion_api_version: NOTION_VERSION,
      meeting_note_status: note.meeting_notes.status,
      calendar_attendee_id_count: note.meeting_notes.calendar_event?.attendees?.length ?? 0,
      summary_block_present: Boolean(childIds?.summary_block_id),
      notes_block_present: Boolean(childIds?.notes_block_id),
      transcript_block_present: Boolean(childIds?.transcript_block_id),
      raw_transcript_stored: false,
      transcript_read_transiently: Boolean(transcriptText),
    },
  };
}

export function notionOwnerIdentity(token: NotionTokenResponse) {
  const email = cleanRecordingText(token.owner?.user?.person?.email, 320).toLowerCase();
  return {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    userId: cleanRecordingText(token.owner?.user?.id, 160) || null,
    workspaceId: cleanRecordingText(token.workspace_id, 160) || null,
    workspaceName: cleanRecordingText(token.workspace_name, 240) || null,
  };
}
