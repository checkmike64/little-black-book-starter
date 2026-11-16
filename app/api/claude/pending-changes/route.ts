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
  contactDuplicateInputFromPayload,
  duplicateMatchesToPayloadCandidates,
  findDuplicateCandidates,
  hasStrongIdentityIdentifier,
  mergeDuplicateCandidatesIntoPayload,
  recommendedExistingContact,
  type ContactDuplicateRecord,
} from "@/lib/contact-duplicate-detection";
import { pendingChangePayloadBody } from "@/lib/pending-change-inspection";
import { pendingChangeFieldPolicy } from "@/lib/pending-change-field-policy";

type PendingChangeRequest = {
  tenant_id?: string;
  idempotency_key?: string;
  source_job_id?: string;
  contact_id?: string;
  change_type?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  source?: string;
  risk_level?: string;
};

type PendingChangeRpcResult = {
  id?: string;
  duplicate?: boolean;
};

type OriginalPendingChange = {
  id: string;
  contact_id: string | null;
  summary: string;
  payload: Record<string, unknown>;
  status: string;
};

function metadataObject(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sourcePendingChangeId(payload: Record<string, unknown>) {
  const evidence = metadataObject(payload, "evidence");
  const replacement = metadataObject(payload, "replacement");
  const candidates = [
    payload.source_pending_change_id,
    evidence.source_pending_change_id,
    replacement.replaces_pending_change_id,
  ];

  return (
    candidates.find((candidate): candidate is string =>
      typeof candidate === "string" && isValidUuid(candidate),
    ) ?? null
  );
}

function mergeMetadata(
  payload: Record<string, unknown>,
  key: string,
  metadata: Record<string, unknown>,
) {
  return {
    ...payload,
    [key]: {
      ...metadataObject(payload, key),
      ...metadata,
    },
  };
}

export async function POST(request: Request) {
  const { admin, error } = authenticateClaudeRequest(request, "write");
  if (error) return error;

  const parsed = await readClaudeJson<PendingChangeRequest>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  const tenantId = tenantIdFrom(body.tenant_id);
  let changeType = cleanText(body.change_type, 80);
  let summary = cleanText(body.summary, 1200);
  let contactId = body.contact_id ?? null;
  const idempotencyKey = cleanText(body.idempotency_key, 160);

  if (!tenantId) {
    return jsonError("Valid tenant_id is required.");
  }

  if (!idempotencyKey) {
    return jsonError("idempotency_key is required for Claude writes.");
  }

  if (!changeType || !summary) {
    return jsonError("change_type and summary are required.");
  }

  if (changeType === "want_to_know_candidate") {
    return jsonError(
      "Want to Know is owner-controlled. Add the person manually in the app.",
      422,
    );
  }

  if (body.contact_id && !isValidUuid(body.contact_id)) {
    return jsonError("contact_id must be a UUID.");
  }
  if (body.source_job_id && !isValidUuid(body.source_job_id)) {
    return jsonError("source_job_id must be a UUID.");
  }

  let payload = body.payload ?? {};
  const suppliedEvidence = metadataObject(payload, "evidence");
  if ("source_job_id" in suppliedEvidence) {
    const trustedEvidence = { ...suppliedEvidence };
    delete trustedEvidence.source_job_id;
    payload = { ...payload, evidence: trustedEvidence };
  }
  const source = cleanText(body.source, 120) || "client_claude_project";
  if (["recording_baseline", "recording_operator"].includes(source)) {
    return jsonError(`${source} is reserved for the internal meeting workflow.`, 422);
  }
  let riskLevel =
    body.risk_level === "high" ||
    changeType === "new_contact"
      ? "high"
      : "low";
  const originalPendingChangeId = sourcePendingChangeId(payload);
  let originalPendingChange: OriginalPendingChange | null = null;

  if (originalPendingChangeId) {
    const { data: original } = await admin
      .from("pending_changes")
      .select("id, contact_id, summary, payload, status")
      .eq("tenant_id", tenantId)
      .eq("id", originalPendingChangeId)
      .maybeSingle();

    originalPendingChange = (original as OriginalPendingChange | null) ?? null;

    if (!originalPendingChange) {
      return jsonError("source_pending_change_id must belong to this tenant.");
    }

    if (originalPendingChange.contact_id && body.contact_id !== originalPendingChange.contact_id) {
      return jsonError("Replacement proposal contact_id must match the original proposal.");
    }

    payload = mergeMetadata(payload, "replacement", {
      status: "replacement",
      replaces_pending_change_id: originalPendingChange.id,
      original_summary: originalPendingChange.summary,
    });
  }

  if (changeType === "new_contact") {
    const { data: contacts, error: contactsError, count: contactsCount } = await admin
      .from("contacts")
      .select(
        "id, full_name, email, phone, company_name, role_title, linkedin, website, relationship_type, one_line_summary",
        { count: "exact" },
      )
      .eq("tenant_id", tenantId)
      .is("archived_at", null)
      .limit(2000);
    if (
      contactsError
      || !Number.isSafeInteger(contactsCount)
      || contactsCount !== (contacts?.length ?? 0)
    ) {
      return jsonError("The Book could not be checked completely for an existing person.", 500);
    }
    const appDuplicateMatches = findDuplicateCandidates(
      contactDuplicateInputFromPayload(payload),
      (contacts ?? []) as ContactDuplicateRecord[],
      { minimumScore: 30, limit: 5 },
    );

    payload = mergeDuplicateCandidatesIntoPayload(
      payload,
      duplicateMatchesToPayloadCandidates(appDuplicateMatches),
    );

    const recommendedDuplicate = recommendedExistingContact(appDuplicateMatches);
    if (
      recommendedDuplicate &&
      hasStrongIdentityIdentifier(recommendedDuplicate)
    ) {
      const proposedContactFields = pendingChangePayloadBody({
        change_type: "new_contact",
        payload,
      });
      const existingContactFields = Object.fromEntries(
        Object.entries(proposedContactFields).filter(([field]) => field !== "full_name"),
      );
      payload = {
        ...payload,
        fields: existingContactFields,
        identity_resolution: {
          status: "matched_existing_contact",
          contact_id: recommendedDuplicate.contact.id,
          reasons: recommendedDuplicate.reasons,
          original_change_type: "new_contact",
          original_summary: summary,
        },
      };
      changeType = "contact_enrichment";
      contactId = recommendedDuplicate.contact.id;
      riskLevel = "high";
      summary = `Update ${recommendedDuplicate.contact.full_name ?? "the existing person"} with newly found information.`;
    }
  }

  const fieldPolicy = pendingChangeFieldPolicy({
    change_type: changeType,
    payload,
    risk_level: riskLevel,
  });
  if (
    ["field_update", "contact_enrichment", "new_contact", "contact_candidate"].includes(
      changeType,
    ) && fieldPolicy.retiredFields.length > 0
  ) {
    return jsonError(
      "Alternate email proposals are not supported. Use the primary email field only when the contact's primary email should change.",
      422,
    );
  }

  if (["field_update", "contact_enrichment"].includes(changeType)) {
    if (fieldPolicy.unsupportedFields.length > 0) {
      return jsonError(
        `Unsupported contact field${fieldPolicy.unsupportedFields.length === 1 ? "" : "s"}: ${fieldPolicy.unsupportedFields.join(", ")}.`,
        422,
      );
    }

    if (fieldPolicy.supportedFields.length === 0) {
      return jsonError("At least one supported contact field is required.", 422);
    }
  }

  if (body.source_job_id) {
    const { data: sourceJob, error: sourceJobError } = await admin
      .from("jobs")
      .select("id, tenant_id, job_type, status, payload")
      .eq("tenant_id", tenantId)
      .eq("id", body.source_job_id)
      .maybeSingle();
    const sourcePayload =
      sourceJob?.payload &&
      typeof sourceJob.payload === "object" &&
      !Array.isArray(sourceJob.payload)
        ? (sourceJob.payload as Record<string, unknown>)
        : {};
    if (
      sourceJobError ||
      !sourceJob ||
      sourceJob.job_type !== "contact_enrichment" ||
      sourceJob.status !== "running" ||
      typeof sourcePayload.contact_id !== "string" ||
      sourcePayload.contact_id !== contactId
    ) {
      return jsonError(
        "source_job_id must identify the running contact-enrichment job for this tenant and contact.",
        422,
      );
    }
    payload = mergeMetadata(payload, "evidence", {
      source_job_id: sourceJob.id,
    });
  }

  const policyError = await authorizeClaudeWrite({
    admin,
    tenantId,
    writeClass: "proposal",
    requestKey: claudeWriteRequestKey("pending-change", [idempotencyKey]),
  });
  if (policyError) return policyError;

  const { data, error: rpcError } = await admin.rpc("lbb_create_pending_change", {
    p_tenant_id: tenantId,
    p_idempotency_key: idempotencyKey,
    p_contact_id: contactId,
    p_change_type: changeType,
    p_summary: summary,
    p_payload: payload,
    p_source: source,
    p_risk_level: riskLevel,
  });

  if (rpcError) {
    return jsonError(rpcError.message, 500);
  }

  const result = (data ?? {}) as PendingChangeRpcResult;

  if (result.id && originalPendingChange && result.id !== originalPendingChange.id) {
    const now = new Date().toISOString();
    const originalPayload = mergeMetadata(
      mergeMetadata(originalPendingChange.payload, "replacement", {
        status: "replaced",
        replacement_pending_change_id: result.id,
        replacement_summary: summary,
        replaced_at: now,
        replacement_source: source,
      }),
      "owner_context",
      {
        ...metadataObject(originalPendingChange.payload, "owner_context"),
        status: "replacement_created",
        replacement_pending_change_id: result.id,
        replacement_created_at: now,
      },
    );

    await Promise.all([
      admin
        .from("pending_changes")
        .update({
          payload: originalPayload,
          replaced_by_pending_change_id: result.id,
          superseded_at: now,
        })
        .eq("tenant_id", tenantId)
        .eq("id", originalPendingChange.id),
      admin
        .from("pending_changes")
        .update({ replaces_pending_change_id: originalPendingChange.id })
        .eq("tenant_id", tenantId)
        .eq("id", result.id),
      admin.from("audit_log").insert({
        tenant_id: tenantId,
        actor_type: "claude",
        action: "pending_change.replacement_created",
        table_name: "pending_changes",
        record_id: originalPendingChange.id,
        after: {
          replacement_pending_change_id: result.id,
          replacement_summary: summary,
        },
        metadata: {
          source,
          new_pending_change_id: result.id,
          original_pending_change_id: originalPendingChange.id,
          duplicate: result.duplicate ?? false,
        },
      }),
    ]);
  }

  return privateJson(
    { id: result.id, duplicate: result.duplicate ?? false },
    { status: result.duplicate ? 200 : 201 },
  );
}
