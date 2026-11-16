export type CreatedPendingChangeContactLink = {
  id: string;
  contact_id: string | null;
};

export type RequiredFieldPendingChange = CreatedPendingChangeContactLink & {
  change_type: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
};

export function pendingChangeWithWrongJobContact(
  rows: CreatedPendingChangeContactLink[],
  expectedContactId: string | null,
) {
  if (!expectedContactId) return null;
  return rows.find((row) => row.contact_id !== expectedContactId) ?? null;
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function proposedFieldValues(row: RequiredFieldPendingChange) {
  const nested = row.payload.fields ?? row.payload.contact ?? row.payload.candidate;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  const legacyField =
    typeof row.payload.field === "string" ? row.payload.field.trim() : "";
  const legacyValue = row.payload.proposed_value ?? row.payload.proposed_addition;
  if (legacyField && legacyValue !== undefined) return { [legacyField]: legacyValue };
  return row.payload;
}

function fieldsForRequirement(field: string) {
  if (field === "primary_email") return ["email"];
  if (field === "company_or_role") return ["company_name", "role_title"];
  if (field === "social_profiles") {
    return ["linkedin", "instagram", "facebook", "x_twitter", "youtube"];
  }
  return [field];
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyStringList(value: unknown) {
  return Array.isArray(value) && value.some(nonEmptyString);
}

function proposalSatisfiesRequirement(
  requiredField: string,
  fields: Record<string, unknown>,
) {
  if (requiredField === "company_or_role") {
    return nonEmptyString(fields.company_name) || nonEmptyStringList(fields.role_title);
  }
  if (requiredField === "role_title") {
    return nonEmptyStringList(fields.role_title);
  }
  if (requiredField === "social_profiles") {
    return fieldsForRequirement(requiredField).some((field) => nonEmptyString(fields[field]));
  }
  return fieldsForRequirement(requiredField).some((field) => nonEmptyString(fields[field]));
}

export function requiredFieldProposalLineageError({
  jobId,
  jobPayload,
  jobCreatedAt,
  completionResult,
  expectedContactId,
  pendingChanges,
}: {
  jobId: string;
  jobPayload: Record<string, unknown>;
  jobCreatedAt: string;
  completionResult: Record<string, unknown>;
  expectedContactId: string | null;
  pendingChanges: RequiredFieldPendingChange[];
}) {
  const requiredFields = Array.from(new Set(stringList(jobPayload.required_fields)));
  if (requiredFields.length === 0) return null;

  const admittedAt = Date.parse(jobCreatedAt);
  if (!Number.isFinite(admittedAt)) {
    return "Required-field enrichment job is missing its admission timestamp.";
  }

  const rowsById = new Map(pendingChanges.map((row) => [row.id, row]));
  const dispositions = objectValue(completionResult.required_field_dispositions);
  for (const requiredField of requiredFields) {
    const disposition = objectValue(dispositions[requiredField]);
    if (disposition.status !== "proposed") continue;
    const pendingChangeId =
      typeof disposition.pending_change_id === "string"
        ? disposition.pending_change_id.trim()
        : "";
    const row = rowsById.get(pendingChangeId);
    if (!row) {
      return `Required field ${requiredField} references a pending change that was not created for this completion.`;
    }
    if (!["field_update", "contact_enrichment"].includes(row.change_type)) {
      return `Required field ${requiredField} must reference a field-update or contact-enrichment change.`;
    }
    if (row.status !== "pending") {
      return `Required field ${requiredField} must reference a still-pending change.`;
    }
    if (!expectedContactId || row.contact_id !== expectedContactId) {
      return `Required field ${requiredField} must reference a change for the assigned contact.`;
    }
    const createdAt = Date.parse(row.created_at);
    if (!Number.isFinite(createdAt) || createdAt < admittedAt) {
      return `Required field ${requiredField} must reference a change created after this job was admitted.`;
    }
    const evidence = objectValue(row.payload.evidence);
    if (evidence.source_job_id !== jobId) {
      return `Required field ${requiredField} must reference a change carrying this job's source_job_id.`;
    }
    const proposedFields = proposedFieldValues(row);
    if (!proposalSatisfiesRequirement(requiredField, proposedFields)) {
      return `Required field ${requiredField} references a proposal without a usable value for that field.`;
    }
  }

  return null;
}

export function requiredFieldCompletionError({
  jobPayload,
  completionResult,
  createdPendingChangeIds,
  createdInteractionIds,
}: {
  jobPayload: Record<string, unknown>;
  completionResult: Record<string, unknown>;
  createdPendingChangeIds: string[];
  createdInteractionIds: string[];
}) {
  const requiredFields = Array.from(new Set(stringList(jobPayload.required_fields)));
  if (requiredFields.length === 0) return null;

  const outcome =
    typeof completionResult.outcome === "string"
      ? completionResult.outcome.trim()
      : "";
  const createdWork =
    createdPendingChangeIds.length > 0 || createdInteractionIds.length > 0;
  if (!createdWork && outcome !== "no_change_needed") {
    return "A required-field enrichment job must submit work or explicitly use outcome no_change_needed.";
  }
  if (createdWork && !["submitted_changes", "no_change_needed"].includes(outcome)) {
    return "A required-field enrichment job must report outcome submitted_changes or no_change_needed.";
  }

  const dispositions = objectValue(completionResult.required_field_dispositions);
  const allowedStatuses = new Set([
    "verified_current",
    "proposed",
    "not_found",
    "owner_confirmation_required",
    "intentionally_blank",
  ]);

  for (const field of requiredFields) {
    const disposition = objectValue(dispositions[field]);
    const status =
      typeof disposition.status === "string" ? disposition.status.trim() : "";
    if (!allowedStatuses.has(status)) {
      return `Required field ${field} needs a valid completion disposition.`;
    }
    if (status === "proposed") {
      const pendingChangeId =
        typeof disposition.pending_change_id === "string"
          ? disposition.pending_change_id.trim()
          : "";
      if (
        outcome === "no_change_needed" ||
        !pendingChangeId ||
        !createdPendingChangeIds.includes(pendingChangeId)
      ) {
        return `Required field ${field} needs a linked pending change proposal.`;
      }
      continue;
    }
    if (status === "verified_current") {
      if (stringList(disposition.source_refs).length === 0) {
        return `Required field ${field} needs at least one source reference.`;
      }
      continue;
    }
    const reason =
      typeof disposition.reason === "string" ? disposition.reason.trim() : "";
    if (!reason || stringList(disposition.sources_checked).length === 0) {
      return `Required field ${field} needs the sources checked and a reason.`;
    }
  }

  return null;
}
