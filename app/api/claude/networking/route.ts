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
  groundNetworkingEvidence,
  type PersistedNetworkingEvidence,
} from "@/lib/networking-evidence-grounding";

type EvidenceRef = {
  kind?: string;
  contact_id?: string;
  source_ref?: string;
  observed_at?: string;
  note?: string;
};

type MatchedEvidenceClaim = {
  contact_id?: string;
  source_ref?: string;
  excerpt?: string;
};

type NetworkingRecommendationInput = {
  client_ref?: string;
  idempotency_key?: string;
  contact_a_id?: string;
  contact_b_id?: string;
  summary?: string;
  why_now?: string;
  match_type?: string;
  direction?: string;
  confidence?: number;
  priority_score?: number;
  evidence_refs?: EvidenceRef[];
  matched_terms?: MatchedEvidenceClaim[];
};

type NetworkingRecommendationRequest = {
  tenant_id?: string;
  recommendations?: NetworkingRecommendationInput[];
};

type RpcResult = {
  id?: string;
  status?: string;
  queue_state?: string;
  reason?: string;
  context?: string;
};

type IntakeResult = {
  client_ref: string | null;
  id?: string | null;
  status: string;
  queue?: "connections";
  queue_state?: string | null;
  reason: string | null;
  context?: string | null;
};

const matchTypes = new Set([
  "podcast",
  "referral",
  "commercial",
  "expertise",
  "peer",
  "other",
]);
const directions = new Set(["a_to_b", "b_to_a", "two_way"]);
const evidenceKinds = new Set([
  "calendar",
  "email",
  "transcript",
  "content",
  "profile",
  "owner_note",
  "other",
]);

function finiteScore(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cleanEvidence(rows: EvidenceRef[] | undefined) {
  return (rows ?? []).slice(0, 8).flatMap((row) => {
    const kind = cleanText(row.kind, 30) || "other";
    const note = cleanText(row.note, 500);
    const observedAt = cleanText(row.observed_at, 80);
    if (!evidenceKinds.has(kind) || !note) return [];
    if (observedAt && Number.isNaN(Date.parse(observedAt))) return [];
    return [{
      kind,
      contact_id: cleanText(row.contact_id, 80) || null,
      source_ref: cleanText(row.source_ref, 500) || null,
      observed_at: observedAt || null,
      note,
    }];
  });
}

type ClaudeAdmin = NonNullable<
  ReturnType<typeof authenticateClaudeRequest>["admin"]
>;

async function persistedEvidenceForPair(input: {
  admin: ClaudeAdmin;
  tenantId: string;
  contactIds: [string, string];
  sourceRefs: string[];
}) {
  const { admin, tenantId, contactIds, sourceRefs } = input;
  const [content, provenance, interactions, transcripts, promises] = await Promise.all([
    admin.from("content_items").select("contact_id, source_url, title, content, relevance")
      .eq("tenant_id", tenantId).in("contact_id", contactIds).in("source_url", sourceRefs),
    admin.from("field_provenance").select("record_id, table_name, source_ref, summary")
      .eq("tenant_id", tenantId).eq("table_name", "contacts")
      .in("record_id", contactIds).in("source_ref", sourceRefs),
    admin.from("interactions").select("id, source_ref, title, summary")
      .eq("tenant_id", tenantId).in("source_ref", sourceRefs),
    admin.from("transcripts").select("interaction_id, source_ref, title, distilled_summary")
      .eq("tenant_id", tenantId).eq("processing_status", "ready").in("source_ref", sourceRefs),
    admin.from("promises").select("contact_id, promise_text, evidence")
      .eq("tenant_id", tenantId).in("contact_id", contactIds).limit(100),
  ]);
  if ([content, provenance, interactions, transcripts, promises].some((row) => row.error)) {
    return null;
  }
  const interactionIds = Array.from(new Set([
    ...(interactions.data ?? []).map((row) => row.id),
    ...(transcripts.data ?? []).map((row) => row.interaction_id).filter(Boolean),
  ]));
  const participants = interactionIds.length
    ? await admin.from("interaction_contacts").select("interaction_id, contact_id")
        .eq("tenant_id", tenantId).in("interaction_id", interactionIds)
    : { data: [], error: null };
  if (participants.error) return null;
  const contactsByInteraction = new Map<string, string[]>();
  for (const row of participants.data ?? []) {
    const current = contactsByInteraction.get(row.interaction_id) ?? [];
    current.push(row.contact_id);
    contactsByInteraction.set(row.interaction_id, current);
  }
  const persisted: PersistedNetworkingEvidence[] = [];
  for (const row of content.data ?? []) {
    if (!row.contact_id) continue;
    persisted.push({
      contactId: row.contact_id,
      sourceRef: row.source_url,
      text: [row.title, row.content, row.relevance].filter(Boolean).join(" "),
    });
  }
  for (const row of provenance.data ?? []) {
    if (!row.source_ref || !row.summary) continue;
    persisted.push({ contactId: row.record_id, sourceRef: row.source_ref, text: row.summary });
  }
  for (const row of interactions.data ?? []) {
    if (!row.source_ref) continue;
    const participantIds = contactsByInteraction.get(row.id) ?? [];
    if (participantIds.length !== 1 || !contactIds.includes(participantIds[0])) continue;
    persisted.push({
      contactId: participantIds[0],
      sourceRef: row.source_ref,
      text: [row.title, row.summary].filter(Boolean).join(" "),
    });
  }
  for (const row of transcripts.data ?? []) {
    if (!row.source_ref || !row.interaction_id) continue;
    const participantIds = contactsByInteraction.get(row.interaction_id) ?? [];
    if (participantIds.length !== 1 || !contactIds.includes(participantIds[0])) continue;
    persisted.push({
      contactId: participantIds[0],
      sourceRef: row.source_ref,
      text: [row.title, row.distilled_summary].filter(Boolean).join(" "),
    });
  }
  for (const row of promises.data ?? []) {
    const evidence = row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence)
      ? row.evidence as Record<string, unknown>
      : {};
    const sourceRef = cleanText(evidence.source_ref, 500);
    if (!sourceRef || !sourceRefs.includes(sourceRef)) continue;
    persisted.push({ contactId: row.contact_id, sourceRef, text: row.promise_text });
  }
  return persisted;
}

export async function POST(request: Request) {
  const { admin, error } = authenticateClaudeRequest(request, "write");
  if (error) return error;

  const parsed = await readClaudeJson<NetworkingRecommendationRequest>(request, {
    maxBytes: 300_000,
  });
  if (parsed.error) return parsed.error;

  const tenantId = tenantIdFrom(parsed.body.tenant_id);
  const recommendations = Array.isArray(parsed.body.recommendations)
    ? parsed.body.recommendations
    : [];
  if (!tenantId) return jsonError("Valid tenant_id is required.");
  if (recommendations.length === 0 || recommendations.length > 25) {
    return jsonError("recommendations must include 1 to 25 items.");
  }

  const policyError = await authorizeClaudeWrite({
    admin,
    tenantId,
    writeClass: "proposal",
    requestKey: claudeWriteRequestKey(
      "networking-batch",
      recommendations
        .map((item) => cleanText(item.idempotency_key, 160))
        .sort(),
    ),
  });
  if (policyError) return policyError;

  const results: IntakeResult[] = [];
  const seenRefs = new Set<string>();
  for (const recommendation of recommendations) {
    const clientRef = cleanText(recommendation.client_ref, 80);
    const idempotencyKey = cleanText(recommendation.idempotency_key, 160);
    const contactA = cleanText(recommendation.contact_a_id, 80);
    const contactB = cleanText(recommendation.contact_b_id, 80);
    const summary = cleanText(recommendation.summary, 500);
    const whyNow = cleanText(recommendation.why_now, 500);
    const matchType = cleanText(recommendation.match_type, 30);
    const direction = cleanText(recommendation.direction, 20);
    const evidence = cleanEvidence(recommendation.evidence_refs);
    const evidenceClaims = (recommendation.matched_terms ?? []).slice(0, 8).map((claim) => ({
      contact_id: cleanText(claim.contact_id, 80),
      source_ref: cleanText(claim.source_ref, 500),
      excerpt: cleanText(claim.excerpt, 120),
    }));

    const reject = (reason: string) => {
      results.push({
        client_ref: clientRef || null,
        status: "rejected",
        reason,
      });
    };

    if (!clientRef || seenRefs.has(clientRef)) {
      reject("client_ref must be present and unique within the batch");
      continue;
    }
    seenRefs.add(clientRef);
    if (!idempotencyKey) {
      reject("idempotency_key is required");
      continue;
    }
    if (!isValidUuid(contactA) || !isValidUuid(contactB) || contactA === contactB) {
      reject("two different valid contact UUIDs are required");
      continue;
    }
    if (!summary || !whyNow) {
      reject("summary and why_now are required");
      continue;
    }
    if (!matchTypes.has(matchType) || !directions.has(direction)) {
      reject("match_type or direction is not supported");
      continue;
    }
    if (
      evidence.length === 0 ||
      evidence.some((item) => !item.source_ref || !item.contact_id) ||
      evidenceClaims.length < 2
    ) {
      reject("matched_terms must bind exact excerpts to both contacts and stored sources");
      continue;
    }
    const sourceRefs = Array.from(new Set(evidence.map((item) => item.source_ref as string)));
    const persisted = await persistedEvidenceForPair({
      admin,
      tenantId,
      contactIds: [contactA, contactB],
      sourceRefs,
    });
    const groundedClaims = persisted
      ? groundNetworkingEvidence({
          contactA,
          contactB,
          claims: evidenceClaims,
          persisted,
        })
      : null;
    if (!groundedClaims) {
      reject("networking evidence could not be verified against this pair's stored sources");
      continue;
    }
    const canonicalEvidence = groundedClaims.map((claim) => {
      const submitted = evidence.find(
        (item) =>
          item.contact_id === claim.contact_id &&
          item.source_ref === claim.source_ref,
      );
      return {
        kind: submitted?.kind ?? "other",
        contact_id: claim.contact_id,
        source_ref: claim.source_ref,
        observed_at: submitted?.observed_at ?? null,
        note: claim.excerpt,
      };
    });
    const groundedSummary = groundedClaims
      .map(
        (claim) =>
          `${claim.contact_id === contactA ? "Person A" : "Person B"}: ${claim.excerpt}`,
      )
      .join(" ")
      .slice(0, 500);
    const groundedWhyNow =
      "Review the cited, stored evidence for both people before making this introduction.";

    const { data, error: rpcError } = await admin.rpc(
      "lbb_record_grounded_networking_recommendation",
      {
        p_tenant_id: tenantId,
        p_idempotency_key: idempotencyKey,
        p_contact_a: contactA,
        p_contact_b: contactB,
        p_summary: groundedSummary,
        p_why_now: groundedWhyNow,
        p_match_type: matchType,
        p_direction: direction,
        p_confidence: Math.min(
          0.999,
          Math.max(0, finiteScore(recommendation.confidence, 0.5)),
        ),
        p_priority_score: Math.round(
          Math.min(100, Math.max(0, finiteScore(recommendation.priority_score, 50))),
        ),
        p_evidence: canonicalEvidence,
        p_matched_terms: groundedClaims,
      },
    );

    if (rpcError) {
      reject(rpcError.message);
      continue;
    }
    const result = (data ?? {}) as RpcResult;
    results.push({
      client_ref: clientRef,
      id: result.id ?? null,
      status: result.status ?? "rejected",
      queue: "connections",
      queue_state: result.queue_state ?? null,
      reason: result.reason ?? null,
      context: result.context ?? null,
    });
  }

  const count = (status: string) =>
    results.filter((result) => result.status === status).length;
  return privateJson(
    {
      received: recommendations.length,
      created: count("created"),
      upgraded: count("upgraded"),
      duplicate: count("duplicate"),
      preserved: count("preserved"),
      suppressed: count("suppressed"),
      rejected: count("rejected"),
      results,
    },
    { status: count("created") > 0 ? 201 : 200 },
  );
}
