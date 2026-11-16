import {
  authorizeClaudeWrite,
  authenticateClaudeRequest,
  claudeWriteRequestKey,
  cleanText,
  isValidUuid,
  jsonError,
  privateJson,
  readClaudeJson,
  tenantIdFrom,
} from "@/app/api/claude/_shared";
import { resolveContentBatchPosition } from "@/lib/claude-content-batch";
import { normalizeExternalContentUrl } from "@/lib/engagement-source";

type ContentInput = {
  contact_id?: string;
  want_to_know_id?: string;
  target_name?: string;
  platform?: string;
  content_type?: string;
  source_url?: string;
  title?: string;
  content?: string;
  classification?: string;
  relevance?: string;
  published_at?: string;
  observed_at?: string;
  likes?: number;
  comments?: number;
  is_repost?: boolean;
};

type ContentRequest = {
  tenant_id?: string;
  run_id?: string;
  batch_index?: number;
  batch_count?: number;
  retrieved_count?: number;
  items?: ContentInput[];
};

type ClaudeAdmin = NonNullable<
  ReturnType<typeof authenticateClaudeRequest>["admin"]
>;

type ContentDeliveryEvent = {
  outcome: "succeeded" | "failed";
  stage: string;
  runId: string | null;
  batchIndex: number | null;
  batchCount: number | null;
  retrievedCount: number | null;
  received: number;
  accepted: number;
  inserted: number;
  duplicate: number;
  rejected: number;
  error?: string;
};

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function logContentDelivery(event: ContentDeliveryEvent) {
  const payload = {
    endpoint: "/api/claude/content",
    ...event,
  };
  if (event.outcome === "failed" && event.stage !== "authentication") {
    console.error("claude_content_delivery", payload);
  } else {
    console.info("claude_content_delivery", payload);
  }
}

async function recordContentDelivery({
  admin,
  tenantId,
  event,
}: {
  admin: ClaudeAdmin;
  tenantId: string;
  event: ContentDeliveryEvent;
}) {
  const metadata = {
    endpoint: "/api/claude/content",
    outcome: event.outcome,
    stage: event.stage,
    run_id: event.runId,
    batch_index: event.batchIndex,
    batch_count: event.batchCount,
    retrieved_count: event.retrievedCount,
    received: event.received,
    accepted: event.accepted,
    inserted: event.inserted,
    duplicate: event.duplicate,
    rejected: event.rejected,
    error: event.error ?? null,
  };
  const [auditResult, usageResult] = await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: tenantId,
      actor_type: "claude",
      action:
        event.outcome === "succeeded"
          ? "content.batch_ingested"
          : "content.batch_failed",
      table_name: "content_items",
      metadata,
    }),
    admin.from("usage_events").insert({
      tenant_id: tenantId,
      actor_type: "claude",
      event_type:
        event.outcome === "succeeded"
          ? "content_batch_ingested"
          : "content_batch_failed",
      quantity: event.outcome === "succeeded" ? event.accepted : 1,
      unit: event.outcome === "succeeded" ? "content_item" : "request",
      metadata,
    }),
  ]);

  if (auditResult.error || usageResult.error) {
    console.error("claude_content_delivery_heartbeat_failed", {
      endpoint: "/api/claude/content",
      runId: event.runId,
      auditError: auditResult.error?.message ?? null,
      usageError: usageResult.error?.message ?? null,
    });
    return false;
  }
  return true;
}

export async function POST(request: Request) {
  const { admin, error } = authenticateClaudeRequest(request, "write");
  if (error) {
    logContentDelivery({
      outcome: "failed",
      stage: "authentication",
      runId: null,
      batchIndex: null,
      batchCount: null,
      retrievedCount: null,
      received: 0,
      accepted: 0,
      inserted: 0,
      duplicate: 0,
      rejected: 0,
      error: "Unauthorized Claude content delivery.",
    });
    return error;
  }

  const parsed = await readClaudeJson<ContentRequest>(request, {
    maxBytes: 1_000_000,
  });
  if (parsed.error) {
    logContentDelivery({
      outcome: "failed",
      stage: "request_body",
      runId: null,
      batchIndex: null,
      batchCount: null,
      retrievedCount: null,
      received: 0,
      accepted: 0,
      inserted: 0,
      duplicate: 0,
      rejected: 0,
      error: "Claude content JSON could not be accepted.",
    });
    return parsed.error;
  }

  const tenantId = tenantIdFrom(parsed.body.tenant_id);
  const runId = cleanText(parsed.body.run_id, 160);
  const batchPosition = resolveContentBatchPosition({
    batchIndex: parsed.body.batch_index,
    batchCount: parsed.body.batch_count,
  });
  const { batchIndex, batchCount } = batchPosition;
  const retrievedCount =
    typeof parsed.body.retrieved_count === "number" &&
    Number.isInteger(parsed.body.retrieved_count) &&
    parsed.body.retrieved_count > 0
      ? Math.min(parsed.body.retrieved_count, 1_000_000)
      : null;
  const items = Array.isArray(parsed.body.items)
    ? parsed.body.items.slice(0, 100)
    : [];

  const fail = async (
    message: string,
    status = 400,
    stage = "validation",
    details?: Record<string, unknown>,
  ) => {
    const event: ContentDeliveryEvent = {
      outcome: "failed",
      stage,
      runId: runId || null,
      batchIndex,
      batchCount,
      retrievedCount,
      received: items.length,
      accepted: 0,
      inserted: 0,
      duplicate: 0,
      rejected: items.length,
      error: cleanText(message, 500),
    };
    logContentDelivery(event);
    if (tenantId) {
      await recordContentDelivery({ admin, tenantId, event });
    }
    return details
      ? privateJson({ error: message, ...details }, { status })
      : jsonError(message, status);
  };

  if (!tenantId) return fail("Valid tenant_id is required.");
  if (!runId) {
    return fail("run_id is required and must stay stable for retries of the same daily research run.");
  }
  if (batchPosition.error) return fail(batchPosition.error);
  if (items.length === 0) return fail("At least one content item is required.");

  const contactIds = new Set<string>();
  const prospectIds = new Set<string>();
  for (const item of items) {
    if (isValidUuid(cleanText(item.contact_id, 80))) {
      contactIds.add(cleanText(item.contact_id, 80));
    }
    if (isValidUuid(cleanText(item.want_to_know_id, 80))) {
      prospectIds.add(cleanText(item.want_to_know_id, 80));
    }
  }

  const [contacts, prospects] = await Promise.all([
    contactIds.size
      ? admin
          .from("contacts")
          .select("id")
          .eq("tenant_id", tenantId)
          .in("id", [...contactIds])
      : Promise.resolve({ data: [], error: null }),
    prospectIds.size
      ? admin
          .from("want_to_know")
          .select("id")
          .eq("tenant_id", tenantId)
          .not("owner_selected_at", "is", null)
          .in("id", [...prospectIds])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (contacts.error || prospects.error) {
    return fail(
      "Relationship targets could not be verified.",
      500,
      "target_verification",
    );
  }
  const validContacts = new Set((contacts.data ?? []).map((row) => row.id));
  const validProspects = new Set((prospects.data ?? []).map((row) => row.id));

  const rejections: Array<{ index: number; reasons: string[] }> = [];
  const rows = items.flatMap((item, index) => {
    const contactId = cleanText(item.contact_id, 80);
    const prospectId = cleanText(item.want_to_know_id, 80);
    const sourceUrl = normalizeExternalContentUrl(
      cleanText(item.source_url, 2000),
    );
    const publishedAt = cleanText(item.published_at, 80);
    const reasons: string[] = [];
    if (!sourceUrl) reasons.push("invalid_source_url");
    if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) {
      reasons.push("invalid_published_at");
    }
    if (contactId && !isValidUuid(contactId)) {
      reasons.push("invalid_contact_id");
    } else if (contactId && !validContacts.has(contactId)) {
      reasons.push("contact_not_in_tenant");
    }
    if (prospectId && !isValidUuid(prospectId)) {
      reasons.push("invalid_want_to_know_id");
    } else if (prospectId && !validProspects.has(prospectId)) {
      reasons.push("want_to_know_not_in_tenant");
    }
    if (contactId && prospectId) reasons.push("multiple_targets");

    if (reasons.length > 0) {
      rejections.push({ index, reasons });
      return [];
    }

    return [
      {
        tenant_id: tenantId,
        contact_id: contactId || null,
        want_to_know_id: prospectId || null,
        target_name: cleanText(item.target_name, 300) || null,
        platform: cleanText(item.platform, 80) || null,
        content_type: cleanText(item.content_type, 40) || "social_post",
        source_url: sourceUrl,
        title: cleanText(item.title, 500) || null,
        content: cleanText(item.content, 10_000) || null,
        classification: cleanText(item.classification, 80) || null,
        relevance: cleanText(item.relevance, 1000) || null,
        published_at: new Date(publishedAt).toISOString(),
        observed_at:
          item.observed_at && !Number.isNaN(Date.parse(item.observed_at))
            ? new Date(item.observed_at).toISOString()
            : new Date().toISOString(),
        metrics: {
          likes: safeNumber(item.likes),
          comments: safeNumber(item.comments),
        },
        source_payload: {
          is_repost: Boolean(item.is_repost),
          ingested_via: "claude_content_api",
        },
      },
    ];
  });

  if (rows.length === 0) {
    return fail("No valid content items were supplied.", 400, "validation", {
      rejections: rejections.slice(0, 25),
    });
  }

  const policyError = await authorizeClaudeWrite({
    admin,
    tenantId,
    writeClass: "mechanical",
    requestKey: claudeWriteRequestKey("content-batch", [
      runId,
      batchIndex,
      rows.map((row) => row.source_url).sort(),
    ]),
  });
  if (policyError) return policyError;

  for (const row of rows) {
    if (!row.contact_id && !row.want_to_know_id) continue;
    await admin
      .from("content_items")
      .update({
        contact_id: row.contact_id,
        want_to_know_id: row.want_to_know_id,
        target_name: row.target_name,
      })
      .eq("tenant_id", tenantId)
      .eq("source_url", row.source_url)
      .is("contact_id", null)
      .is("want_to_know_id", null);
  }

  const { data, error: insertError } = await admin
    .from("content_items")
    .upsert(rows, {
      onConflict: "tenant_id,source_url",
      ignoreDuplicates: true,
    })
    .select("id");
  if (insertError) return fail(insertError.message, 500, "content_upsert");

  const inserted = data?.length ?? 0;
  const duplicate = Math.max(0, rows.length - inserted);
  const rejected = Math.max(0, items.length - rows.length);
  const event: ContentDeliveryEvent = {
    outcome: "succeeded",
    stage: "complete",
    runId,
    batchIndex,
    batchCount,
    retrievedCount,
    received: items.length,
    accepted: rows.length,
    inserted,
    duplicate,
    rejected,
  };
  logContentDelivery(event);
  const heartbeatRecorded = await recordContentDelivery({ admin, tenantId, event });

  return privateJson(
    {
      run_id: runId,
      received: items.length,
      accepted: rows.length,
      inserted,
      duplicate,
      rejected,
      rejections: rejections.slice(0, 25),
      heartbeat: heartbeatRecorded ? "recorded" : "degraded",
    },
    { status: 201 },
  );
}
