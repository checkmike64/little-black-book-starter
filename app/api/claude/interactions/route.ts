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
import { canAdvanceLastSpoke } from "@/lib/interaction-freshness";

type PromiseRequest = {
  contact_id?: string;
  direction?: string;
  promise_text?: string;
  due_on?: string;
  evidence?: Record<string, unknown>;
};

type ConnectionEdgeRequest = {
  contact_a?: string;
  contact_b?: string;
  evidence?: Record<string, unknown>;
  confidence?: number;
};

type InteractionRequest = {
  tenant_id?: string;
  run_id?: string;
  idempotency_key?: string;
  occurred_at?: string;
  interaction_type?: string;
  title?: string;
  summary?: string;
  source?: string;
  source_ref?: string;
  metadata?: Record<string, unknown>;
  contact_ids?: string[];
  update_last_spoke?: boolean;
  promises?: PromiseRequest[];
  infer_connections?: boolean;
  connection_edges?: ConnectionEdgeRequest[];
};

type PromiseDraft = {
  contact_id: string;
  direction: string;
  promise_text: string;
  due_on: string | null;
  evidence: Record<string, unknown>;
};

type ConnectionDraft = {
  contact_a: string;
  contact_b: string;
  evidence: Record<string, unknown>;
  confidence: number | null;
};

type InteractionRpcResult = {
  id?: string;
  duplicate?: boolean;
  last_spoke_updated?: string[];
  promise_count?: number;
  connection_count?: number;
  strength_updated_count?: number;
};

type ClaudeAdmin = NonNullable<
  ReturnType<typeof authenticateClaudeRequest>["admin"]
>;

type InteractionDeliveryEvent = {
  outcome: "succeeded" | "failed";
  stage: string;
  runId: string | null;
  idempotencyKey: string | null;
  contactCount: number;
  promiseCount: number;
  duplicate: boolean;
  error?: string;
};

function logInteractionDelivery(event: InteractionDeliveryEvent) {
  const payload = { endpoint: "/api/claude/interactions", ...event };
  if (event.outcome === "failed") {
    console.error("claude_interaction_delivery", payload);
  } else {
    console.info("claude_interaction_delivery", payload);
  }
}

async function recordInteractionDelivery({
  admin,
  tenantId,
  event,
}: {
  admin: ClaudeAdmin;
  tenantId: string;
  event: InteractionDeliveryEvent;
}) {
  const metadata = {
    endpoint: "/api/claude/interactions",
    outcome: event.outcome,
    stage: event.stage,
    run_id: event.runId,
    idempotency_key: event.idempotencyKey,
    contact_count: event.contactCount,
    promise_count: event.promiseCount,
    duplicate: event.duplicate,
    error: event.error ?? null,
  };
  const [auditResult, usageResult] = await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: tenantId,
      actor_type: "claude",
      action:
        event.outcome === "succeeded"
          ? "interaction.delivery_succeeded"
          : "interaction.delivery_failed",
      table_name: "interactions",
      metadata,
    }),
    admin.from("usage_events").insert({
      tenant_id: tenantId,
      actor_type: "claude",
      event_type:
        event.outcome === "succeeded"
          ? "interaction_delivered"
          : "interaction_failed",
      quantity: 1,
      unit: "interaction",
      metadata,
    }),
  ]);

  if (auditResult.error || usageResult.error) {
    console.error("claude_interaction_delivery_heartbeat_failed", {
      runId: event.runId,
      auditError: auditResult.error?.message ?? null,
      usageError: usageResult.error?.message ?? null,
    });
    return false;
  }
  return true;
}

const interactionTypes = new Set([
  "meeting",
  "call",
  "email",
  "message",
  "note",
  "manual_touch",
]);

const promiseDirections = new Set(["owner_owes_contact", "contact_owes_owner"]);

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids));
}

function canonicalPair(contactA: string, contactB: string) {
  return [contactA, contactB].sort() as [string, string];
}

function inferredConnectionEdges(contactIds: string[]) {
  const edges: ConnectionEdgeRequest[] = [];
  for (let i = 0; i < contactIds.length; i += 1) {
    for (let j = i + 1; j < contactIds.length; j += 1) {
      edges.push({
        contact_a: contactIds[i],
        contact_b: contactIds[j],
        evidence: {
          reason: "co_attendance",
        },
        confidence: 0.8,
      });
    }
  }
  return edges;
}

export async function POST(request: Request) {
  const { admin, error } = authenticateClaudeRequest(request, "write");
  if (error) return error;

  const parsed = await readClaudeJson<InteractionRequest>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  const tenantId = tenantIdFrom(body.tenant_id);
  const runId = cleanText(body.run_id, 160);
  const occurredAt = cleanText(body.occurred_at, 80);
  const interactionType = cleanText(body.interaction_type, 40);
  const title = cleanText(body.title, 240);
  const summary = cleanText(body.summary, 8000);
  const source = cleanText(body.source, 120) || "client_claude_project";
  const sourceRef = cleanText(body.source_ref, 240);
  const idempotencyKey = cleanText(body.idempotency_key, 160);
  const contactIds = uniqueIds(body.contact_ids ?? []);

  if (!tenantId) {
    return jsonError("Valid tenant_id is required.");
  }

  if (!idempotencyKey) {
    return jsonError("idempotency_key is required for Claude writes.");
  }

  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) {
    return jsonError("occurred_at must be a valid ISO date or timestamp.");
  }

  if (!interactionTypes.has(interactionType)) {
    return jsonError(
      "interaction_type must be meeting, call, email, message, note, or manual_touch.",
    );
  }

  if (!summary) {
    return jsonError("summary is required.");
  }

  if (contactIds.length === 0 || contactIds.length > 20) {
    return jsonError("contact_ids must include 1 to 20 contact UUIDs.");
  }

  if (contactIds.some((id) => !isValidUuid(id))) {
    return jsonError("Every contact_id must be a UUID.");
  }

  const { data: contacts, error: contactsError } = await admin
    .from("contacts")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("id", contactIds);

  if (contactsError) {
    return jsonError(contactsError.message, 500);
  }

  if (!contacts || contacts.length !== contactIds.length) {
    return jsonError("Every contact_id must belong to this tenant.", 400);
  }

  const promiseDrafts: PromiseDraft[] = [];
  for (const promise of body.promises ?? []) {
    const promiseText = cleanText(promise.promise_text, 1200);
    const direction = cleanText(promise.direction, 40);
    const promiseContactId =
      cleanText(promise.contact_id, 80) || (contactIds.length === 1 ? contactIds[0] : "");

    if (!promiseText) return jsonError("Each promise needs promise_text.");
    if (!promiseDirections.has(direction)) {
      return jsonError(
        "Each promise direction must be owner_owes_contact or contact_owes_owner.",
      );
    }
    if (!promiseContactId || !contactIds.includes(promiseContactId)) {
      return jsonError("Each promise contact_id must be one of the interaction contacts.");
    }
    if (promise.due_on && !isValidDate(promise.due_on)) {
      return jsonError("Promise due_on must be YYYY-MM-DD when provided.");
    }

    promiseDrafts.push({
      contact_id: promiseContactId,
      direction,
      promise_text: promiseText,
      due_on: promise.due_on ?? null,
      evidence: promise.evidence ?? {},
    });
  }

  const requestedEdges = body.connection_edges ?? [];
  const candidateEdges =
    body.infer_connections === true
      ? [...requestedEdges, ...inferredConnectionEdges(contactIds)]
      : requestedEdges;
  const connectionDrafts: ConnectionDraft[] = [];
  const seenPairs = new Set<string>();

  for (const edge of candidateEdges) {
    const contactA = cleanText(edge.contact_a, 80);
    const contactB = cleanText(edge.contact_b, 80);

    if (!contactA || !contactB || contactA === contactB) continue;
    if (!contactIds.includes(contactA) || !contactIds.includes(contactB)) {
      return jsonError("Connection edges must use contacts from contact_ids.");
    }

    const [pairA, pairB] = canonicalPair(contactA, contactB);
    const pairKey = `${pairA}:${pairB}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    connectionDrafts.push({
      contact_a: pairA,
      contact_b: pairB,
      evidence: edge.evidence ?? {},
      confidence: edge.confidence ?? null,
    });
  }

  const promises = promiseDrafts.map((promise) => ({
    contact_id: promise.contact_id,
    direction: promise.direction,
    promise_text: promise.promise_text,
    due_on: promise.due_on,
    evidence: promise.evidence,
  }));

  const connectionEdges = connectionDrafts.map((edge) => ({
    contact_a: edge.contact_a,
    contact_b: edge.contact_b,
    evidence: edge.evidence,
    confidence: edge.confidence,
  }));
  const updateLastSpoke =
    body.update_last_spoke !== false && canAdvanceLastSpoke(occurredAt);

  const policyError = await authorizeClaudeWrite({
    admin,
    tenantId,
    writeClass: "mechanical",
    requestKey: claudeWriteRequestKey("interaction", [idempotencyKey]),
  });
  if (policyError) return policyError;

  const { data, error: rpcError } = await admin.rpc("lbb_log_interaction", {
    p_tenant_id: tenantId,
    p_idempotency_key: idempotencyKey,
    p_occurred_at: occurredAt,
    p_interaction_type: interactionType,
    p_title: title,
    p_summary: summary,
    p_source: source,
    p_source_ref: sourceRef,
    p_metadata: body.metadata ?? {},
    p_contact_ids: contactIds,
    p_update_last_spoke: updateLastSpoke,
    p_promises: promises,
    p_connection_edges: connectionEdges,
  });

  if (rpcError) {
    const failureEvent: InteractionDeliveryEvent = {
      outcome: "failed",
      stage: "interaction_rpc",
      runId: runId || null,
      idempotencyKey: idempotencyKey || null,
      contactCount: contactIds.length,
      promiseCount: promises.length,
      duplicate: false,
      error: cleanText(rpcError.message, 500),
    };
    logInteractionDelivery(failureEvent);
    await recordInteractionDelivery({ admin, tenantId, event: failureEvent });
    return jsonError(rpcError.message, 500);
  }

  const result = (data ?? {}) as InteractionRpcResult;
  const deliveryEvent: InteractionDeliveryEvent = {
    outcome: "succeeded",
    stage: "complete",
    runId: runId || null,
    idempotencyKey,
    contactCount: contactIds.length,
    promiseCount: result.promise_count ?? promiseDrafts.length,
    duplicate: result.duplicate ?? false,
  };
  logInteractionDelivery(deliveryEvent);
  const heartbeatRecorded = await recordInteractionDelivery({
    admin,
    tenantId,
    event: deliveryEvent,
  });

  return privateJson(
    {
      id: result.id,
      duplicate: result.duplicate ?? false,
      last_spoke_updated: result.last_spoke_updated ?? [],
      promise_count: result.promise_count ?? 0,
      connection_count: result.connection_count ?? 0,
      strength_updated_count: result.strength_updated_count ?? 0,
      run_id: runId || null,
      heartbeat: heartbeatRecorded ? "recorded" : "degraded",
      last_spoke_update_suppressed:
        body.update_last_spoke !== false && !updateLastSpoke,
    },
    { status: result.duplicate ? 200 : 201 },
  );
}
