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

type IntroductionFeedbackRequest = {
  tenant_id?: string;
  feedback_request_id?: string;
  source_ref?: string;
  idempotency_key?: string;
  response_text?: string;
  response_reasoning?: string;
  usefulness_rating?: number;
  fit_rating?: number;
  would_recommend?: boolean | null;
  occurred_at?: string;
};

function rating(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5
    ? Number(value)
    : null;
}

export async function POST(request: Request) {
  const { admin, error } = authenticateClaudeRequest(request, "write");
  if (error) return error;
  const parsed = await readClaudeJson<IntroductionFeedbackRequest>(request);
  if (parsed.error) return parsed.error;

  const body = parsed.body;
  const tenantId = tenantIdFrom(body.tenant_id);
  const feedbackId = cleanText(body.feedback_request_id, 80);
  const sourceRef = cleanText(body.source_ref, 500);
  const idempotencyKey = cleanText(body.idempotency_key, 300);
  const responseText = cleanText(body.response_text, 5000);
  const responseReasoning = cleanText(body.response_reasoning, 2000);
  const occurredAt = cleanText(body.occurred_at, 80);
  const usefulnessRating = rating(body.usefulness_rating);
  const fitRating = rating(body.fit_rating);

  if (!tenantId || !isValidUuid(feedbackId)) {
    return jsonError("A valid tenant and feedback request are required.");
  }
  if (!sourceRef || !idempotencyKey || !responseText) {
    return jsonError("The source reference, idempotency key, and response text are required.");
  }
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) {
    return jsonError("A valid response time is required.");
  }
  if (usefulnessRating === null || fitRating === null) {
    return jsonError("Usefulness and fit ratings from 1 to 5 are required.");
  }

  const writeError = await authorizeClaudeWrite({
    admin,
    tenantId,
    writeClass: "mechanical",
    requestKey: claudeWriteRequestKey("introduction-feedback", [tenantId, idempotencyKey]),
  });
  if (writeError) return writeError;

  const { data: feedback, error: feedbackError } = await admin
    .from("introduction_feedback_requests")
    .select("id, introduction_id, contact_id, status")
    .eq("tenant_id", tenantId)
    .eq("id", feedbackId)
    .single();
  if (feedbackError || !feedback) {
    return jsonError("The feedback request could not be matched.", 404);
  }

  const externalKey = `introduction-feedback:${idempotencyKey}`;
  const { data: existingEvent } = await admin
    .from("introduction_events")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("external_key", externalKey)
    .maybeSingle();
  if (existingEvent) {
    return privateJson({ feedback_request_id: feedbackId, status: "responded", duplicate: true });
  }

  const update = {
    status: "responded",
    usefulness_rating: usefulnessRating,
    fit_rating: fitRating,
    would_recommend:
      typeof body.would_recommend === "boolean" ? body.would_recommend : null,
    response_text: responseText,
    response_reasoning: responseReasoning || null,
    response_source: "email",
    response_source_ref: sourceRef,
    response_received_at: occurredAt,
    updated_at: new Date().toISOString(),
  };
  const { error: updateError } = await admin
    .from("introduction_feedback_requests")
    .update(update)
    .eq("tenant_id", tenantId)
    .eq("id", feedbackId);
  if (updateError) return jsonError("The feedback response could not be stored.", 503);

  const { error: eventError } = await admin.from("introduction_events").insert({
    tenant_id: tenantId,
    introduction_id: feedback.introduction_id,
    event_type: "feedback_received",
    occurred_at: occurredAt,
    source: "email",
    source_ref: sourceRef,
    external_key: externalKey,
    evidence: {
      feedback_request_id: feedbackId,
      contact_id: feedback.contact_id,
      usefulness_rating: usefulnessRating,
      fit_rating: fitRating,
    },
  });
  if (eventError) return jsonError("The feedback event could not be recorded.", 503);

  await admin.from("audit_log").insert({
    tenant_id: tenantId,
    actor_type: "claude",
    action: "introduction.feedback_received",
    table_name: "introduction_feedback_requests",
    record_id: feedbackId,
    after: update,
    metadata: { source_ref: sourceRef, idempotency_key: idempotencyKey },
  });

  return privateJson({ feedback_request_id: feedbackId, status: "responded" });
}
