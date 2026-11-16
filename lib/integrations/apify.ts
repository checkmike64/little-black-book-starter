import { timingSafeEqual } from "node:crypto";
import type { ContentScanConnectorSettings } from "../automation/content-scan-settings.ts";
import { normalizeExternalContentUrl } from "../engagement-source.ts";

const APIFY_API_ORIGIN = "https://api.apify.com";

export type ApifyRun = {
  id: string;
  actId?: string;
  actorTaskId?: string;
  userId?: string;
  status?: string;
  defaultDatasetId?: string;
  startedAt?: string;
  finishedAt?: string;
  usageTotalUsd?: number;
};

export type ApifyWebhookEvent = {
  eventType?: string;
  eventData?: {
    actorRunId?: string;
    actorTaskId?: string;
  };
  resource?: ApifyRun;
};

export type NormalizedApifyContent = {
  source_url: string;
  author_profile_url: string | null;
  title: string | null;
  content: string | null;
  published_at: string;
  platform: string;
  content_type: string;
  metrics: {
    likes: number;
    comments: number;
    shares: number;
  };
  source_payload: Record<string, unknown>;
};

export type ApifyContentRejectionReason =
  | "not_an_object"
  | "missing_or_invalid_post_url"
  | "missing_or_invalid_published_date"
  | "published_date_over_24h_in_future"
  | "missing_content_and_title";

export type ApifyContentNormalizationResult = {
  item: NormalizedApifyContent | null;
  rejection_reason: ApifyContentRejectionReason | null;
};

function serverValue(name: string) {
  return process.env[name]?.trim() ?? "";
}

export function apifyConfigured() {
  return Boolean(
    serverValue("APIFY_API_TOKEN") &&
      serverValue("APIFY_WEBHOOK_SECRET") &&
      serverValue("NEXT_PUBLIC_SITE_URL"),
  );
}

export function apifyWebhookAuthorized(request: Request) {
  const expected = serverValue("APIFY_WEBHOOK_SECRET");
  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function buildApifyTaskInput(
  connector: ContentScanConnectorSettings,
  sourceUrl: string,
) {
  return {
    [connector.input_field]:
      connector.input_format === "request_list"
        ? [{ url: sourceUrl }]
        : [sourceUrl],
    // Pay-per-event actors ignore the run's maxItems option, so the cap must
    // travel in the actor input or the run bills up to maxTotalChargeUsd.
    ...(connector.limit_field
      ? { [connector.limit_field]: connector.max_items_per_run }
      : {}),
  };
}

function webhookPayload() {
  return JSON.stringify([
    {
      eventTypes: [
        "ACTOR.RUN.SUCCEEDED",
        "ACTOR.RUN.FAILED",
        "ACTOR.RUN.ABORTED",
        "ACTOR.RUN.TIMED_OUT",
      ],
      requestUrl: `${serverValue("NEXT_PUBLIC_SITE_URL").replace(/\/+$/, "")}/api/integrations/apify/webhook`,
      payloadTemplate:
        '{"eventType":{{eventType}},"eventData":{{eventData}},"resource":{{resource}}}',
      headersTemplate: JSON.stringify({
        Authorization: `Bearer ${serverValue("APIFY_WEBHOOK_SECRET")}`,
      }),
    },
  ]);
}

function apifyHeaders() {
  const token = serverValue("APIFY_API_TOKEN");
  if (!token) throw new Error("Apify is not configured.");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "x-apify-integration-platform": "little-black-book",
  };
}

async function apifyJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | { data?: T; error?: { message?: string } }
    | null;
  if (!response.ok || !body?.data) {
    throw new Error(body?.error?.message || `Apify returned ${response.status}.`);
  }
  return body.data;
}

export async function launchApifyTask({
  connector,
  sourceUrl,
}: {
  connector: ContentScanConnectorSettings;
  sourceUrl: string;
}) {
  if (!apifyConfigured()) throw new Error("Apify is not configured.");
  const query = new URLSearchParams({
    maxItems: String(connector.max_items_per_run),
    maxTotalChargeUsd: String(connector.max_charge_usd),
    webhooks: Buffer.from(webhookPayload()).toString("base64"),
  });
  const response = await fetch(
    `${APIFY_API_ORIGIN}/v2/actor-tasks/${encodeURIComponent(connector.task_id)}/runs?${query}`,
    {
      method: "POST",
      headers: apifyHeaders(),
      body: JSON.stringify(buildApifyTaskInput(connector, sourceUrl)),
      cache: "no-store",
    },
  );
  return apifyJson<ApifyRun>(response);
}

export async function fetchApifyDatasetItems(
  datasetId: string,
  limit: number,
) {
  const query = new URLSearchParams({
    clean: "true",
    limit: String(Math.min(Math.max(limit, 1), 100)),
  });
  const response = await fetch(
    `${APIFY_API_ORIGIN}/v2/datasets/${encodeURIComponent(datasetId)}/items?${query}`,
    {
      headers: apifyHeaders(),
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error(`Apify dataset returned ${response.status}.`);
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) throw new Error("Apify dataset was not a list.");
  return body.slice(0, 100);
}

/** Synchronous actor runs only need the API token (no webhook round trip). */
export function apifyTokenConfigured() {
  return Boolean(serverValue("APIFY_API_TOKEN"));
}

/**
 * Start a Store actor and wait for it to finish (up to `waitSecs`, max 60).
 * `maxTotalChargeUsd` caps pay-per-event actors; the run object reports the
 * actual `usageTotalUsd` once Apify has settled it.
 */
export async function runApifyActor({
  actorId,
  input,
  waitSecs = 60,
  timeoutSecs = 90,
  maxTotalChargeUsd,
  maxItems,
  itemLimit = 20,
}: {
  actorId: string;
  input: Record<string, unknown>;
  waitSecs?: number;
  timeoutSecs?: number;
  maxTotalChargeUsd: number;
  maxItems?: number;
  itemLimit?: number;
}) {
  if (!apifyTokenConfigured()) throw new Error("Apify is not configured.");
  const query = new URLSearchParams({
    waitForFinish: String(Math.min(Math.max(Math.round(waitSecs), 1), 60)),
    timeout: String(Math.min(Math.max(Math.round(timeoutSecs), 10), 300)),
    maxTotalChargeUsd: String(maxTotalChargeUsd),
  });
  if (maxItems) query.set("maxItems", String(maxItems));
  const response = await fetch(
    `${APIFY_API_ORIGIN}/v2/acts/${encodeURIComponent(actorId.replace("/", "~"))}/runs?${query}`,
    {
      method: "POST",
      headers: apifyHeaders(),
      body: JSON.stringify(input),
      cache: "no-store",
    },
  );
  let run = await apifyJson<ApifyRun>(response);
  // Under concurrency Apify may still be starting the run (READY) or running
  // it when the wait ends; give it a short grace period before giving up.
  const graceEnds = Date.now() + 30_000;
  while ((run.status === "READY" || run.status === "RUNNING") && Date.now() < graceEnds) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    run = await fetchApifyRun(run.id);
  }
  if (run.status !== "SUCCEEDED" || !run.defaultDatasetId) {
    return { run, items: [] as unknown[] };
  }
  const items = await fetchApifyDatasetItems(run.defaultDatasetId, itemLimit);
  return { run, items };
}

export async function fetchApifyRun(runId: string) {
  const response = await fetch(
    `${APIFY_API_ORIGIN}/v2/actor-runs/${encodeURIComponent(runId)}`,
    {
      headers: apifyHeaders(),
      cache: "no-store",
    },
  );
  return apifyJson<ApifyRun>(response);
}

function text(record: Record<string, unknown>, names: string[], max: number) {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim()) {
      return value.replace(/\s+/g, " ").trim().slice(0, max);
    }
  }
  return null;
}

function count(record: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.round(value));
    }
  }
  return 0;
}

function nestedRecord(record: Record<string, unknown>, name: string) {
  const value = record[name];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nestedCount(
  record: Record<string, unknown>,
  parent: string,
  names: string[],
) {
  const nested = nestedRecord(record, parent);
  return nested ? count(nested, names) : 0;
}

function dateFromValue(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim();
    const relative = normalized.match(
      /^(?:about\s+)?(?:an?|one|\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i,
    );
    if (relative) {
      const rawAmount = normalized.match(/^(?:about\s+)?(an?|one|\d+)/i)?.[1];
      const amount = rawAmount && /^\d+$/.test(rawAmount) ? Number(rawAmount) : 1;
      const unitMilliseconds: Record<string, number> = {
        minute: 60_000,
        hour: 3_600_000,
        day: 86_400_000,
        week: 7 * 86_400_000,
        month: 30 * 86_400_000,
        year: 365 * 86_400_000,
      };
      return new Date(Date.now() - amount * unitMilliseconds[relative[1].toLowerCase()]);
    }
    if (/^today$/i.test(normalized)) return new Date();
    if (/^yesterday$/i.test(normalized)) {
      return new Date(Date.now() - 86_400_000);
    }
    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function publishedAt(record: Record<string, unknown>) {
  const directFields = [
    "publishedAt",
    "published_at",
    "postedAt",
    "datePublished",
    "time",
    "timestamp",
    "date",
    "createdAt",
    "created_at",
  ];
  let date: Date | null = null;
  for (const field of directFields) {
    date = dateFromValue(record[field]);
    if (date) break;
  }
  if (!date) {
    for (const parent of ["postedAt", "publishedAt", "datePublished"]) {
      const nested = nestedRecord(record, parent);
      if (!nested) continue;
      date = dateFromValue(nested.date) ?? dateFromValue(nested.timestamp);
      if (date) break;
    }
  }
  if (!date) return null;
  if (date.getTime() > Date.now() + 86_400_000) return null;
  return date.toISOString();
}

export function normalizeApifyDatasetItemResult(
  value: unknown,
  platform: string,
): ApifyContentNormalizationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { item: null, rejection_reason: "not_an_object" };
  }
  const record = value as Record<string, unknown>;
  const url = normalizeExternalContentUrl(
    text(
      record,
      [
        "postUrl",
        "post_url",
        "linkedinUrl",
        "twitterUrl",
        "url",
        "link",
        "permalink",
        "shortCodeUrl",
      ],
      2000,
    ) ?? "",
  );
  if (!url) {
    return { item: null, rejection_reason: "missing_or_invalid_post_url" };
  }
  const date = publishedAt(record);
  if (!date) {
    const nestedPostedAt = nestedRecord(record, "postedAt");
    const rawDate =
      text(
        record,
        [
          "publishedAt",
          "published_at",
          "postedAt",
          "datePublished",
          "time",
          "timestamp",
          "date",
          "createdAt",
          "created_at",
        ],
        100,
      ) ?? nestedPostedAt?.date ?? nestedPostedAt?.timestamp;
    const parsed = dateFromValue(rawDate);
    return {
      item: null,
      rejection_reason:
        parsed && parsed.getTime() > Date.now() + 86_400_000
          ? "published_date_over_24h_in_future"
          : "missing_or_invalid_published_date",
    };
  }

  const content = text(
    record,
    ["text", "content", "caption", "description", "body"],
    10_000,
  );
  const title = text(record, ["title", "headline", "name"], 500);
  if (!content && !title) {
    return { item: null, rejection_reason: "missing_content_and_title" };
  }
  const author = nestedRecord(record, "author");
  const aboutChannelInfo = nestedRecord(record, "aboutChannelInfo");
  const authorProfileUrl = normalizeExternalContentUrl(
    (platform === "youtube"
      ? text(record, ["input", "inputUrl", "fromYTUrl"], 2000) ??
        text(aboutChannelInfo ?? {}, ["inputChannelUrl"], 2000)
      : null) ??
      text(
        record,
        [
          "authorUrl",
          "author_url",
          "profileUrl",
          "profile_url",
          "ownerUrl",
          "owner_url",
          "channelUrl",
          "inputUrl",
        ],
        2000,
      ) ??
      text(
        author ?? {},
        ["linkedinUrl", "url", "twitterUrl", "profileUrl"],
        2000,
      ) ??
      "",
  );

  return {
    item: {
      source_url: url,
      author_profile_url: authorProfileUrl,
      title,
      content,
      published_at: date,
      platform,
      content_type:
        platform === "website"
          ? "article"
          : platform === "youtube"
            ? "video"
            : "social_post",
      metrics: {
        likes:
          count(record, ["likes", "likesCount", "likeCount"]) ||
          nestedCount(record, "engagement", ["likes", "likesCount", "likeCount"]),
        comments:
          count(record, ["comments", "commentsCount", "commentCount", "replyCount"]) ||
          nestedCount(record, "engagement", [
            "comments",
            "commentsCount",
            "commentCount",
          ]),
        shares:
          count(record, [
            "shares",
            "sharesCount",
            "shareCount",
            "retweetCount",
          ]) ||
          nestedCount(record, "engagement", ["shares", "sharesCount", "shareCount"]),
      },
      source_payload: {
        ingested_via: "apify",
        provider_item_id:
          text(record, ["id", "postId", "shortCode"], 200) ?? null,
        author:
          text(record, ["authorName", "ownerFullName", "username"], 300) ??
          text(
            author ?? {},
            ["name", "username", "userName", "publicIdentifier"],
            300,
          ) ??
          null,
      },
    },
    rejection_reason: null,
  };
}

export function normalizeApifyDatasetItem(
  value: unknown,
  platform: string,
): NormalizedApifyContent | null {
  return normalizeApifyDatasetItemResult(value, platform).item;
}

export function registeredSourceMatchesAuthor(
  sourceUrl: string,
  authorProfileUrl: string,
) {
  const source = normalizeExternalContentUrl(sourceUrl);
  const author = normalizeExternalContentUrl(authorProfileUrl);
  if (!source || !author) return false;
  const sourceParsed = new URL(source);
  const authorParsed = new URL(author);
  const sourceHost = sourceParsed.hostname.toLowerCase().replace(/^www\./, "");
  const authorHost = authorParsed.hostname.toLowerCase().replace(/^www\./, "");
  const xHosts = new Set(["x.com", "twitter.com"]);
  const hostsMatch =
    sourceHost === authorHost || (xHosts.has(sourceHost) && xHosts.has(authorHost));
  const normalizedPath = (url: URL) => {
    const path = url.pathname.toLowerCase().replace(/\/+$/, "");
    return /(^|\.)youtube\.com$/.test(url.hostname.toLowerCase())
      ? path.replace(/\/(?:videos|shorts|streams|featured)$/, "")
      : path;
  };
  return (
    hostsMatch &&
    normalizedPath(sourceParsed) === normalizedPath(authorParsed)
  );
}

export function apifyTerminalStatus(eventType: string | undefined) {
  if (eventType === "ACTOR.RUN.SUCCEEDED") return "succeeded" as const;
  if (eventType === "ACTOR.RUN.FAILED") return "failed" as const;
  if (eventType === "ACTOR.RUN.ABORTED") return "aborted" as const;
  if (eventType === "ACTOR.RUN.TIMED_OUT") return "timed_out" as const;
  return null;
}

export function apifyRunTerminalStatus(status: string | undefined) {
  if (status === "SUCCEEDED") return "succeeded" as const;
  if (status === "FAILED") return "failed" as const;
  if (status === "ABORTED") return "aborted" as const;
  if (status === "TIMED-OUT") return "timed_out" as const;
  return null;
}
