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

type IntroductionEventRequest = {
  tenant_id?: string;
  introduction_id?: string;
  contact_ids?: string[];
  source?: "email" | "owner";
  source_ref?: string;
  occurred_at?: string;
  idempotency_key?: string;
  why_context?: string;
  evidence_summary?: string;
};

function canonicalPair(ids: string[]) {
  return [...new Set(ids)].sort();
}

export async function POST(request: Request) {
  const { admin, error } = authenticateClaudeRequest(request, "write");
  if (error) return error;
  const parsed = await readClaudeJson<IntroductionEventRequest>(request);
  if (parsed.error) return parsed.error;

  const body = parsed.body;
  const tenantId = tenantIdFrom(body.tenant_id);
  const source = body.source === "owner" ? "owner" : "email";
  const sourceRef = cleanText(body.source_ref, 500);
  const idempotencyKey = cleanText(body.idempotency_key, 300);
  const evidenceSummary = cleanText(body.evidence_summary, 1000);
  const whyContext = cleanText(body.why_context, 2000);
  const occurredAt = cleanText(body.occurred_at, 80);
  let introductionId = cleanText(body.introduction_id, 80);
  const pair = canonicalPair(body.contact_ids ?? []);

  if (!tenantId || !["email", "owner"].includes(source)) {
    return jsonError("A valid tenant and source are required.");
  }
  if (!idempotencyKey || !sourceRef || !evidenceSummary) {
    return jsonError("A source reference, evidence summary, and idempotency key are required.");
  }
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) {
    return jsonError("A valid occurrence time is required.");
  }
  if (!isValidUuid(introductionId) && (pair.length !== 2 || pair.some((id) => !isValidUuid(id)))) {
    return jsonError("Provide an introduction ID or exactly two contact IDs.");
  }

  const writeError = await authorizeClaudeWrite({
    admin,
    tenantId,
    writeClass: "mechanical",
    requestKey: claudeWriteRequestKey("introduction-event", [tenantId, idempotencyKey]),
  });
  if (writeError) return writeError;

  if (!isValidUuid(introductionId)) {
    const { data: contacts, error: contactsError } = await admin
      .from("contacts")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", pair)
      .is("archived_at", null);
    if (contactsError || (contacts ?? []).length !== 2) {
      return jsonError("Both introduction participants must be verified contacts.");
    }

    const [personA, personB] = pair;
    const { data: existing } = await admin
      .from("introductions")
      .select("id")
      .eq("tenant_id", tenantId)
      .or(`and(person_a.eq.${personA},person_b.eq.${personB}),and(person_a.eq.${personB},person_b.eq.${personA})`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    introductionId = existing?.id ?? "";

    if (!introductionId) {
      const { data: created, error: createError } = await admin
        .from("introductions")
        .insert({
          tenant_id: tenantId,
          person_a: personA,
          person_b: personB,
          date_proposed: occurredAt.slice(0, 10),
          why_context: whyContext || evidenceSummary,
          status: "proposed",
          draft_evidence: {
            detected_from: source,
            source_ref: sourceRef,
            evidence_summary: evidenceSummary,
          },
        })
        .select("id")
        .single();
      if (createError || !created) return jsonError("The detected introduction could not be created.", 503);
      introductionId = created.id;
    }
  }

  const externalKey = `introduction-event:${idempotencyKey}`;
  const { data, error: recordError } = await admin.rpc("lbb_record_introduction_sent", {
    p_tenant_id: tenantId,
    p_introduction_id: introductionId,
    p_actor_user_id: null,
    p_source: source,
    p_occurred_at: occurredAt,
    p_external_key: externalKey,
    p_source_ref: sourceRef,
    p_evidence: {
      summary: evidenceSummary,
      idempotency_key: idempotencyKey,
    },
  });
  if (recordError) return jsonError("The introduction event could not be recorded.", 503);

  await admin.from("audit_log").insert({
    tenant_id: tenantId,
    actor_type: "claude",
    action: "introduction.sent_detected",
    table_name: "introductions",
    record_id: introductionId,
    metadata: { source, source_ref: sourceRef, idempotency_key: idempotencyKey },
  });

  return privateJson({ introduction_id: introductionId, status: "made", result: data });
}
