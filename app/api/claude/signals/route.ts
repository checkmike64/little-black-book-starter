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
import {
  engageableSocialPostPlatform,
  normalizeExternalContentUrl,
} from "@/lib/engagement-source";
import {
  resolveEngagementLane,
  type EngagementLaneContact,
} from "@/lib/engagement/lane";

type SignalRequest = {
  tenant_id?: string;
  run_id?: string;
  idempotency_key?: string;
  contact_id?: string;
  want_to_know_id?: string;
  signal_type?: string;
  classification?: string;
  summary?: string;
  source?: string;
  source_url?: string;
  published_at?: string;
  observed_at?: string;
  why_now?: string;
  engagement_lane?: string;
  content_classification?: string;
  recommended_action?: string;
  priority_score?: number;
  exceptional_reason?: string;
};

type SignalRpcResult = {
  id?: string;
  duplicate?: boolean;
};

type ContactTarget = EngagementLaneContact & {
  id: string;
};

type ClaudeAdmin = NonNullable<
  ReturnType<typeof authenticateClaudeRequest>["admin"]
>;

type SignalDeliveryEvent = {
  outcome: "succeeded" | "failed";
  stage: string;
  runId: string | null;
  idempotencyKey: string | null;
  targetType: "contact" | "want_to_know" | null;
  duplicate: boolean;
  error?: string;
};

const signalTypes = new Set(["social_post"]);

function logSignalDelivery(event: SignalDeliveryEvent) {
  const payload = {
    endpoint: "/api/claude/signals",
    ...event,
  };
  if (event.outcome === "failed" && event.stage !== "authentication") {
    console.error("claude_signal_delivery", payload);
  } else {
    console.info("claude_signal_delivery", payload);
  }
}

async function recordSignalDelivery({
  admin,
  tenantId,
  event,
}: {
  admin: ClaudeAdmin;
  tenantId: string;
  event: SignalDeliveryEvent;
}) {
  const metadata = {
    endpoint: "/api/claude/signals",
    outcome: event.outcome,
    stage: event.stage,
    run_id: event.runId,
    idempotency_key: event.idempotencyKey,
    target_type: event.targetType,
    duplicate: event.duplicate,
    error: event.error ?? null,
  };
  const [auditResult, usageResult] = await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: tenantId,
      actor_type: "claude",
      action:
        event.outcome === "succeeded"
          ? "engagement.signal_delivery_succeeded"
          : "engagement.signal_delivery_failed",
      table_name: "signals",
      metadata,
    }),
    admin.from("usage_events").insert({
      tenant_id: tenantId,
      actor_type: "claude",
      event_type:
        event.outcome === "succeeded"
          ? "engagement_signal_delivered"
          : "engagement_signal_failed",
      quantity: 1,
      unit: event.outcome === "succeeded" ? "signal" : "request",
      metadata,
    }),
  ]);

  if (auditResult.error || usageResult.error) {
    console.error("claude_signal_delivery_heartbeat_failed", {
      endpoint: "/api/claude/signals",
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
    logSignalDelivery({
      outcome: "failed",
      stage: "authentication",
      runId: null,
      idempotencyKey: null,
      targetType: null,
      duplicate: false,
      error: "Unauthorized Claude signal delivery.",
    });
    return error;
  }

  const parsed = await readClaudeJson<SignalRequest>(request, {
    maxBytes: 20_000,
  });
  if (parsed.error) {
    logSignalDelivery({
      outcome: "failed",
      stage: "request_body",
      runId: null,
      idempotencyKey: null,
      targetType: null,
      duplicate: false,
      error: "Claude signal JSON could not be accepted.",
    });
    return parsed.error;
  }
  const body = parsed.body;

  const tenantId = tenantIdFrom(body.tenant_id);
  const runId = cleanText(body.run_id, 160);
  const idempotencyKey = cleanText(body.idempotency_key, 160);
  const contactId = cleanText(body.contact_id, 80);
  const wantToKnowId = cleanText(body.want_to_know_id, 80);
  const signalType = cleanText(body.signal_type, 40) || "social_post";
  const classification = cleanText(body.classification, 40) || "CONTINUITY";
  const summary = cleanText(body.summary, 500);
  const whyNow = cleanText(body.why_now, 500);
  const observedAt = cleanText(body.observed_at, 80);
  const publishedAt = cleanText(body.published_at, 80);
  const sourceUrl = normalizeExternalContentUrl(cleanText(body.source_url, 2000));
  const socialPlatform = sourceUrl
    ? engageableSocialPostPlatform(sourceUrl)
    : null;

  const hasContact = isValidUuid(contactId);
  const hasProspect = isValidUuid(wantToKnowId);
  const targetType = hasContact
    ? "contact"
    : hasProspect
      ? "want_to_know"
      : null;
  const fail = async (message: string, status = 400, stage = "validation") => {
    const event: SignalDeliveryEvent = {
      outcome: "failed",
      stage,
      runId: runId || null,
      idempotencyKey: idempotencyKey || null,
      targetType,
      duplicate: false,
      error: cleanText(message, 500),
    };
    logSignalDelivery(event);
    if (tenantId) {
      await recordSignalDelivery({ admin, tenantId, event });
    }
    return jsonError(message, status);
  };

  if (!tenantId) return fail("Valid tenant_id is required.");
  if (!runId) {
    return fail("run_id is required and must identify the daily research run.");
  }
  if (!idempotencyKey) {
    return fail("idempotency_key is required for Claude writes.");
  }
  if (hasContact === hasProspect) {
    return fail(
      "Provide exactly one valid contact_id or want_to_know_id.",
    );
  }
  if (!signalTypes.has(signalType)) {
    return fail("signal_type must be social_post for engagement recommendations.");
  }
  if (!summary) return fail("A concise factual summary is required.");
  if (!whyNow) {
    return fail("why_now must explain the relationship-specific reason.");
  }
  if (!sourceUrl) {
    return fail("source_url must be a public HTTP or HTTPS content URL.");
  }
  if (!socialPlatform) {
    return fail(
      "source_url must point to an individual engageable post on LinkedIn, Facebook, Instagram, X, Threads, TikTok, or YouTube. Profiles, articles, newsletters, podcast pages, Bluesky, and Reddit are research evidence only, not engagement recommendations.",
    );
  }
  if (!observedAt || Number.isNaN(Date.parse(observedAt))) {
    return fail("observed_at must be a valid ISO date or timestamp.");
  }
  if (publishedAt && Number.isNaN(Date.parse(publishedAt))) {
    return fail("published_at must be a valid ISO date or timestamp when supplied.");
  }

  const targetTable = hasContact ? "contacts" : "want_to_know";
  const targetId = hasContact ? contactId : wantToKnowId;
  const targetResult = hasContact
    ? await admin
        .from("contacts")
        .select(
          "id, last_spoke, relationship_strength, relationship_type, touch_cadence, trust_level",
        )
        .eq("tenant_id", tenantId)
        .eq("id", targetId)
        .maybeSingle()
    : await admin
        .from("want_to_know")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", targetId)
        .not("owner_selected_at", "is", null)
        .maybeSingle();
  const target = targetResult.data as ContactTarget | { id: string } | null;
  const targetError = targetResult.error;

  if (targetError) return fail(targetError.message, 500, "target_verification");
  if (!target) {
    return fail(
      "The relationship target must belong to this tenant.",
      400,
      "target_verification",
    );
  }

  const source = socialPlatform.toLowerCase();
  const requestedLane = cleanText(body.engagement_lane, 20);
  const engagementLane = resolveEngagementLane({
    requestedLane,
    classification,
    isWantToKnow: hasProspect,
    contact: hasContact ? (target as ContactTarget) : null,
  });
  const rescueWasRequested =
    requestedLane === "rescue" ||
    /relationship.?rescue|rescue|cooling/i.test(classification);
  if (rescueWasRequested && engagementLane !== "rescue") {
    return fail(
      `Recent contact prevents Relationship Rescue. Resubmit as ${engagementLane} with a why_now sentence that reflects the recent interaction.`,
    );
  }

  const policyError = await authorizeClaudeWrite({
    admin,
    tenantId,
    writeClass: "mechanical",
    requestKey: claudeWriteRequestKey("signal", [idempotencyKey]),
  });
  if (policyError) return policyError;

  const { data, error: rpcError } = await admin.rpc(
    "lbb_record_engagement_signal_v2",
    {
      p_classification: classification,
      p_contact_id: hasContact ? contactId : null,
      p_want_to_know_id: hasProspect ? wantToKnowId : null,
      p_idempotency_key: idempotencyKey,
      p_published_at: publishedAt || observedAt,
      p_signal_type: signalType,
      p_source: source,
      p_source_url: sourceUrl,
      p_summary: summary,
      p_why_now: whyNow,
      p_engagement_lane: engagementLane,
      p_content_classification: cleanText(
        body.content_classification,
        40,
      ),
      p_recommended_action: cleanText(body.recommended_action, 20),
      p_priority_score:
        typeof body.priority_score === "number"
          ? body.priority_score
          : 50,
      p_exceptional_reason: cleanText(body.exceptional_reason, 500),
      p_tenant_id: tenantId,
    },
  );

  if (rpcError) return fail(rpcError.message, 500, "signal_rpc");

  const result = (data ?? {}) as SignalRpcResult;
  const event: SignalDeliveryEvent = {
    outcome: "succeeded",
    stage: "complete",
    runId,
    idempotencyKey,
    targetType,
    duplicate: result.duplicate ?? false,
  };
  logSignalDelivery(event);
  const heartbeatRecorded = await recordSignalDelivery({ admin, tenantId, event });
  return privateJson(
    {
      id: result.id,
      duplicate: result.duplicate ?? false,
      run_id: runId,
      heartbeat: heartbeatRecorded ? "recorded" : "degraded",
    },
    { status: result.duplicate ? 200 : 201 },
  );
}
