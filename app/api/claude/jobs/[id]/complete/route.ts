import {
  authenticateClaudeRequest,
  cleanText,
  isValidUuid,
  jsonError,
  privateJson,
  readClaudeJson,
  tenantIdFrom,
} from "@/app/api/claude/_shared";
import {
  pendingChangeWithWrongJobContact,
  requiredFieldCompletionError,
  requiredFieldProposalLineageError,
  type RequiredFieldPendingChange,
} from "@/lib/claude-job-completion";

type CompleteJobRequest = {
  tenant_id?: string;
  summary?: string;
  result?: Record<string, unknown>;
  created_pending_change_ids?: string[];
  created_interaction_ids?: string[];
};

type JobRow = {
  id: string;
  tenant_id: string;
  job_type: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  attempts: number;
  created_at: string;
};

type PendingChangeLinkRow = {
  id: string;
  tenant_id: string;
  contact_id: string | null;
  payload: Record<string, unknown>;
  summary: string;
  status: string;
};

type CreatedPendingChangeRow = {
  id: string;
  tenant_id: string;
  contact_id: string | null;
  change_type: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
};

type CreatedInteractionRow = {
  id: string;
  tenant_id: string;
};

type InteractionContactRow = {
  interaction_id: string;
  contact_id: string;
};

function cleanUuidList(values: unknown) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(values.filter((value): value is string => typeof value === "string")),
  ).filter(isValidUuid);
}

function jobContactId(job: JobRow) {
  return typeof job.payload.contact_id === "string" && isValidUuid(job.payload.contact_id)
    ? job.payload.contact_id
    : null;
}

function metadataObject(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

async function linkRevisionReplacement({
  admin,
  tenantId,
  job,
  createdPendingChangeIds,
}: {
  admin: NonNullable<ReturnType<typeof authenticateClaudeRequest>["admin"]>;
  tenantId: string;
  job: JobRow;
  createdPendingChangeIds: string[];
}) {
  if (job.payload.trigger !== "owner_context_revision") return null;

  const originalId =
    typeof job.payload.source_pending_change_id === "string" &&
    isValidUuid(job.payload.source_pending_change_id)
      ? job.payload.source_pending_change_id
      : null;
  const contactId =
    typeof job.payload.contact_id === "string" && isValidUuid(job.payload.contact_id)
      ? job.payload.contact_id
      : null;

  if (!originalId || !contactId || createdPendingChangeIds.length !== 1) return null;

  const replacementId = createdPendingChangeIds[0];
  if (replacementId === originalId) return null;

  const { data: rows } = await admin
    .from("pending_changes")
    .select("id, tenant_id, contact_id, payload, summary, status")
    .eq("tenant_id", tenantId)
    .in("id", [originalId, replacementId]);

  const pendingRows = ((rows ?? []) as PendingChangeLinkRow[]);
  const original = pendingRows.find((row) => row.id === originalId) ?? null;
  const replacement = pendingRows.find((row) => row.id === replacementId) ?? null;

  if (
    !original ||
    !replacement ||
    original.status !== "pending" ||
    replacement.status !== "pending" ||
    original.contact_id !== contactId ||
    replacement.contact_id !== contactId
  ) {
    return null;
  }

  const now = new Date().toISOString();
  const originalPayload = mergeMetadata(
    mergeMetadata(original.payload, "replacement", {
      status: "replaced",
      replacement_pending_change_id: replacement.id,
      replacement_summary: replacement.summary,
      replaced_at: now,
      replacement_source: "owner_context_revision_job",
    }),
    "owner_context",
    {
      ...metadataObject(original.payload, "owner_context"),
      status: "replacement_created",
      replacement_pending_change_id: replacement.id,
      replacement_created_at: now,
    },
  );
  const replacementPayload = mergeMetadata(replacement.payload, "replacement", {
    status: "replacement",
    replaces_pending_change_id: original.id,
    original_summary: original.summary,
  });

  await Promise.all([
    admin
      .from("pending_changes")
      .update({
        payload: originalPayload,
        replaced_by_pending_change_id: replacement.id,
        superseded_at: now,
      })
      .eq("tenant_id", tenantId)
      .eq("id", original.id)
      .eq("status", "pending"),
    admin
      .from("pending_changes")
      .update({
        payload: replacementPayload,
        replaces_pending_change_id: original.id,
      })
      .eq("tenant_id", tenantId)
      .eq("id", replacement.id)
      .eq("status", "pending"),
    admin.from("audit_log").insert({
      tenant_id: tenantId,
      actor_type: "claude",
      action: "pending_change.replacement_linked_from_job",
      table_name: "pending_changes",
      record_id: original.id,
      after: {
        replacement_pending_change_id: replacement.id,
        replacement_summary: replacement.summary,
      },
      metadata: {
        job_id: job.id,
        original_pending_change_id: original.id,
        replacement_pending_change_id: replacement.id,
      },
    }),
  ]);

  return replacement.id;
}

async function validateCreatedRecordLinks({
  admin,
  tenantId,
  job,
  completionResult,
  createdPendingChangeIds,
  createdInteractionIds,
}: {
  admin: NonNullable<ReturnType<typeof authenticateClaudeRequest>["admin"]>;
  tenantId: string;
  job: JobRow;
  completionResult: Record<string, unknown>;
  createdPendingChangeIds: string[];
  createdInteractionIds: string[];
}) {
  const expectedContactId = jobContactId(job);

  if (createdPendingChangeIds.length > 0) {
    const { data, error } = await admin
      .from("pending_changes")
      .select("id, tenant_id, contact_id, change_type, payload, status, created_at")
      .eq("tenant_id", tenantId)
      .in("id", createdPendingChangeIds);

    if (error) return `Pending change validation failed: ${error.message}`;

    const rows = ((data ?? []) as CreatedPendingChangeRow[]);
    const foundIds = new Set(rows.map((row) => row.id));
    const missing = createdPendingChangeIds.filter((createdId) => !foundIds.has(createdId));
    if (missing.length > 0) {
      return `Pending change id not found for this tenant: ${missing[0]}.`;
    }

    const wrongContact = pendingChangeWithWrongJobContact(rows, expectedContactId);
    if (wrongContact) {
      return "Created pending change does not belong to the contact assigned to this job.";
    }

    const lineageError = requiredFieldProposalLineageError({
      jobId: job.id,
      jobPayload: job.payload,
      jobCreatedAt: job.created_at,
      completionResult,
      expectedContactId,
      pendingChanges: rows as RequiredFieldPendingChange[],
    });
    if (lineageError) return lineageError;
  }

  if (createdInteractionIds.length > 0) {
    const { data, error } = await admin
      .from("interactions")
      .select("id, tenant_id")
      .eq("tenant_id", tenantId)
      .in("id", createdInteractionIds);

    if (error) return `Interaction validation failed: ${error.message}`;

    const rows = ((data ?? []) as CreatedInteractionRow[]);
    const foundIds = new Set(rows.map((row) => row.id));
    const missing = createdInteractionIds.filter((createdId) => !foundIds.has(createdId));
    if (missing.length > 0) {
      return `Interaction id not found for this tenant: ${missing[0]}.`;
    }

    if (expectedContactId) {
      const { data: links, error: linkError } = await admin
        .from("interaction_contacts")
        .select("interaction_id, contact_id")
        .eq("tenant_id", tenantId)
        .in("interaction_id", createdInteractionIds);

      if (linkError) return `Interaction contact validation failed: ${linkError.message}`;

      const linkedInteractionIds = new Set(
        ((links ?? []) as InteractionContactRow[])
          .filter((link) => link.contact_id === expectedContactId)
          .map((link) => link.interaction_id),
      );
      const unlinked = createdInteractionIds.filter(
        (interactionId) => !linkedInteractionIds.has(interactionId),
      );
      if (unlinked.length > 0) {
        return "Created interaction is not linked to the contact assigned to this job.";
      }
    }
  }

  return null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { admin, error } = authenticateClaudeRequest(request, "jobs");
  if (error) return error;

  const { id } = await params;
  if (!isValidUuid(id)) {
    return jsonError("Valid job id is required.");
  }

  const parsed = await readClaudeJson<CompleteJobRequest>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  const tenantId = tenantIdFrom(body.tenant_id);
  if (!tenantId) {
    return jsonError("Valid tenant_id is required.");
  }

  const { data: existing, error: fetchError } = await admin
    .from("jobs")
    .select("id, tenant_id, job_type, status, payload, result, attempts, created_at")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return jsonError(fetchError.message, 500);
  }

  if (!existing) {
    return jsonError("Job not found.", 404);
  }

  const job = existing as JobRow;
  if (job.status !== "running") {
    return jsonError("Only running jobs can be completed.", 409);
  }

  const completedAt = new Date().toISOString();
  const createdPendingChangeIds = cleanUuidList(body.created_pending_change_ids);
  const createdInteractionIds = cleanUuidList(body.created_interaction_ids);
  const summary = cleanText(body.summary, 1200);
  const completionResult =
    body.result && typeof body.result === "object" && !Array.isArray(body.result)
      ? body.result
      : {};
  const coverageError = requiredFieldCompletionError({
    jobPayload: job.payload,
    completionResult,
    createdPendingChangeIds,
    createdInteractionIds,
  });
  if (coverageError) {
    return jsonError(coverageError, 400);
  }
  const validationError = await validateCreatedRecordLinks({
    admin,
    tenantId,
    job,
    completionResult,
    createdPendingChangeIds,
    createdInteractionIds,
  });

  if (validationError) {
    return jsonError(validationError, 400);
  }

  const result: Record<string, unknown> = {
    ...(job.result ?? {}),
    ...completionResult,
    summary: summary || body.result?.summary || null,
    created_pending_change_ids: createdPendingChangeIds,
    created_interaction_ids: createdInteractionIds,
    completed_at: completedAt,
  };

  const linkedReplacementId = await linkRevisionReplacement({
    admin,
    tenantId,
    job,
    createdPendingChangeIds,
  });

  if (linkedReplacementId) {
    result.owner_context_replacement_pending_change_id = linkedReplacementId;
  }

  const { data: updated, error: updateError } = await admin
    .from("jobs")
    .update({
      status: "succeeded",
      result,
      locked_at: null,
    })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .eq("status", "running")
    .select("id, status, result")
    .single();

  if (updateError || !updated) {
    return jsonError(updateError?.message ?? "Job could not be completed.", 500);
  }

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: tenantId,
      actor_type: "claude",
      action: "job.completed",
      table_name: "jobs",
      record_id: id,
      before: {
        status: "running",
      },
      after: {
        status: "succeeded",
        result,
      },
      metadata: {
        job_type: job.job_type,
        contact_id:
          typeof job.payload.contact_id === "string" ? job.payload.contact_id : null,
        created_pending_change_ids: createdPendingChangeIds,
        created_interaction_ids: createdInteractionIds,
      },
    }),
    admin.from("usage_events").insert({
      tenant_id: tenantId,
      actor_type: "claude",
      event_type: "job_completed",
      quantity: 1,
      unit: "job",
      metadata: {
        job_id: id,
        job_type: job.job_type,
        created_pending_change_ids: createdPendingChangeIds,
        created_interaction_ids: createdInteractionIds,
      },
    }),
  ]);

  return privateJson({
    id,
    status: "succeeded",
    created_pending_change_ids: createdPendingChangeIds,
    created_interaction_ids: createdInteractionIds,
  });
}
