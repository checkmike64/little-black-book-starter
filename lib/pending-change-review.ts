import { isNewPersonChangeType } from "./pending-change-types.ts";

export type PendingChangeReviewInput = {
  change_type: string;
  contact_id?: string | null;
  created_at: string;
  payload: Record<string, unknown>;
  replaced_by_pending_change_id?: string | null;
  replaces_pending_change_id?: string | null;
  risk_level?: string | null;
  source?: string | null;
  superseded_at?: string | null;
};

export type PendingChangeReviewSignals = {
  detailedReview: boolean;
  duplicateCount: number;
  supportedFieldCount: number;
  unsupportedKeyCount: number;
};

export type PendingChangeReviewPosture = {
  key:
    | "replaced"
    | "replacement"
    | "owner_context_needed"
    | "owner_context_requested"
    | "owner_context_attached"
    | "revision_queued"
    | "duplicate_check"
    | "prospecting_review"
    | "detailed_review"
    | "quick_approval"
    | "operator_repair"
    | "standard_review";
  label: string;
  detail: string;
  canApprove: boolean;
  tone: "hot" | "gold" | "cool" | "neutral";
};

export type QualityCleanupDetails = {
  blockedFields: string[];
  fieldNeedsOwnerVerification: boolean;
  jobId: string | null;
  leftBlank: string[];
  missingFieldsReviewed: string[];
  proposedField: string | null;
  proposedFieldLabel: string | null;
};

function cleanStringList(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function normalizedFieldName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function proposedFieldNames(payload: Record<string, unknown>) {
  const fields = payload.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return [];
  return Object.keys(fields).map(normalizedFieldName).filter(Boolean);
}

export function qualityCleanupDetails(
  payload: Record<string, unknown>,
): QualityCleanupDetails {
  const cleanup = payload.quality_cleanup;
  if (!cleanup || typeof cleanup !== "object" || Array.isArray(cleanup)) {
    return {
      blockedFields: [],
      fieldNeedsOwnerVerification: false,
      jobId: null,
      leftBlank: [],
      missingFieldsReviewed: [],
      proposedField: null,
      proposedFieldLabel: null,
    };
  }

  const details = cleanup as Record<string, unknown>;
  return {
    blockedFields: cleanStringList(details.blocked_fields),
    fieldNeedsOwnerVerification: details.field_needs_owner_verification === true,
    jobId: typeof details.job_id === "string" ? details.job_id : null,
    leftBlank: cleanStringList(details.left_blank),
    missingFieldsReviewed: cleanStringList(details.missing_fields_reviewed),
    proposedField:
      typeof details.proposed_field === "string" && details.proposed_field.trim()
        ? details.proposed_field.trim()
        : null,
    proposedFieldLabel:
      typeof details.proposed_field_label === "string" &&
      details.proposed_field_label.trim()
        ? details.proposed_field_label.trim()
        : null,
  };
}

export function qualityCleanupApprovalBlockingFields(
  payload: Record<string, unknown>,
) {
  const cleanup = qualityCleanupDetails(payload);
  const proposed = new Set(proposedFieldNames(payload));

  if (cleanup.fieldNeedsOwnerVerification) {
    if (cleanup.proposedField) proposed.add(normalizedFieldName(cleanup.proposedField));
    if (cleanup.proposedFieldLabel) {
      proposed.add(normalizedFieldName(cleanup.proposedFieldLabel));
    }
  }

  if (proposed.size === 0) return cleanup.blockedFields;

  return cleanup.blockedFields.filter((field) =>
    proposed.has(normalizedFieldName(field)),
  );
}

export function isQualityCleanupChange(row: PendingChangeReviewInput) {
  return row.source === "quality_cleanup_job" || Boolean(row.payload.quality_cleanup);
}

export function ownerContextStatus(row: PendingChangeReviewInput) {
  const context = row.payload.owner_context;
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;

  const status = (context as Record<string, unknown>).status;
  return typeof status === "string" && status.trim() ? status.trim() : null;
}

function replacementMetadata(row: PendingChangeReviewInput) {
  const replacement = row.payload.replacement;
  if (!replacement || typeof replacement !== "object" || Array.isArray(replacement)) {
    return {};
  }

  return replacement as Record<string, unknown>;
}

export function replacementStatus(row: PendingChangeReviewInput) {
  if (row.replaced_by_pending_change_id || row.superseded_at) return "replaced";
  if (row.replaces_pending_change_id) return "replacement";

  const status = replacementMetadata(row).status;
  return typeof status === "string" && status.trim() ? status.trim() : null;
}

export function replacementPendingChangeId(row: PendingChangeReviewInput) {
  if (row.replaced_by_pending_change_id) return row.replaced_by_pending_change_id;

  const id = replacementMetadata(row).replacement_pending_change_id;
  return typeof id === "string" ? id : null;
}

export function originalPendingChangeId(row: PendingChangeReviewInput) {
  if (row.replaces_pending_change_id) return row.replaces_pending_change_id;

  const id = replacementMetadata(row).replaces_pending_change_id;
  return typeof id === "string" ? id : null;
}

export function daysWaiting(row: PendingChangeReviewInput, now = Date.now()) {
  const created = Date.parse(row.created_at);
  if (!Number.isFinite(created)) return 0;
  return Math.floor(Math.max(0, now - created) / 86_400_000);
}

export function reviewLane(
  row: PendingChangeReviewInput,
  signals: Pick<PendingChangeReviewSignals, "detailedReview">,
) {
  const approvalBlockers = qualityCleanupApprovalBlockingFields(row.payload);

  if (replacementStatus(row) === "replaced") return "Replaced by newer proposal";
  if (replacementStatus(row) === "replacement") return "Replacement proposal";
  if (ownerContextStatus(row) === "revision_queued") return "Claude revision queued";
  if (ownerContextStatus(row) === "answered") return "Owner context attached";
  if (approvalBlockers.length > 0) return "Needs owner context";
  if (isQualityCleanupChange(row)) return "Quality cleanup review";
  if (isNewPersonChangeType(row.change_type)) return "Duplicate check";
  if (row.change_type === "want_to_know_candidate") return "Prospecting review";
  if (signals.detailedReview) return "Detailed review";
  if (
    ["contact_enrichment", "field_update"].includes(row.change_type) &&
    Boolean((row as { contact_id?: string | null }).contact_id)
  ) {
    return "Quick approval";
  }

  return "Standard review";
}

export function reviewPosture(
  row: PendingChangeReviewInput,
  signals: PendingChangeReviewSignals,
): PendingChangeReviewPosture {
  const approvalBlockers = qualityCleanupApprovalBlockingFields(row.payload);
  const ownerStatus = ownerContextStatus(row);
  const blockedDetail = approvalBlockers.length
    ? `Needs owner/source context for ${approvalBlockers.join(", ")}.`
    : "No owner-context blocker is recorded.";

  if (replacementStatus(row) === "replaced") {
    return {
      key: "replaced",
      label: "Replaced",
      detail: "A newer proposal should be reviewed instead of this original.",
      canApprove: false,
      tone: "neutral",
    };
  }

  if (replacementStatus(row) === "replacement") {
    return {
      key: "replacement",
      label: "Replacement",
      detail: "Review this newer proposal instead of the superseded original.",
      canApprove: true,
      tone: "gold",
    };
  }

  if (ownerStatus === "revision_queued") {
    return {
      key: "revision_queued",
      label: "Revision queued",
      detail: "Wait for Claude to return a revised proposal before approving.",
      canApprove: false,
      tone: "neutral",
    };
  }

  if (ownerStatus === "answered") {
    return {
      key: "owner_context_attached",
      label: "Context attached",
      detail: "Owner context is attached; review the proposal one-by-one before approval.",
      canApprove: true,
      tone: "cool",
    };
  }

  if (approvalBlockers.length > 0) {
    return {
      key: ownerStatus === "requested" ? "owner_context_requested" : "owner_context_needed",
      label: ownerStatus === "requested" ? "Context requested" : "Needs context",
      detail: blockedDetail,
      canApprove: false,
      tone: "hot",
    };
  }

  if (signals.supportedFieldCount === 0 && signals.unsupportedKeyCount > 0) {
    return {
      key: "operator_repair",
      label: "Operator repair",
      detail: "This proposal does not map to a field the Book can write safely.",
      canApprove: false,
      tone: "neutral",
    };
  }

  if (isNewPersonChangeType(row.change_type)) {
    return {
      key: "duplicate_check",
      label: "Duplicate check",
      detail:
        signals.duplicateCount > 0
          ? `${signals.duplicateCount} possible duplicate${
              signals.duplicateCount === 1 ? "" : "s"
            } need review.`
          : "Compare against the Book before approving a new person.",
      canApprove: true,
      tone: "gold",
    };
  }

  if (row.change_type === "want_to_know_candidate") {
    return {
      key: "prospecting_review",
      label: "Prospecting review",
      detail: "Confirm the bucket and why-this-person context before adding them.",
      canApprove: true,
      tone: "gold",
    };
  }

  if (signals.detailedReview) {
    return {
      key: "detailed_review",
      label: "Detailed review",
      detail: "Sensitive or judgment-heavy fields require one-by-one review.",
      canApprove: true,
      tone: "gold",
    };
  }

  if (
    ["contact_enrichment", "field_update"].includes(row.change_type) &&
    Boolean((row as { contact_id?: string | null }).contact_id)
  ) {
    return {
      key: "quick_approval",
      label: "Quick approval",
      detail: "Low-risk contact-linked update can be approved from the queue.",
      canApprove: true,
      tone: "cool",
    };
  }

  return {
    key: "standard_review",
    label: "Standard review",
    detail: "Inspect before approving; this proposal does not match a quick lane.",
    canApprove: false,
    tone: "neutral",
  };
}

export function reviewPriority(
  row: PendingChangeReviewInput,
  signals: PendingChangeReviewSignals,
  now = Date.now(),
) {
  if (replacementStatus(row) === "replaced") return -1;

  const cleanup = qualityCleanupDetails(row.payload);
  const ownerStatus = ownerContextStatus(row);
  const qualityReady = isQualityCleanupChange(row) && cleanup.blockedFields.length === 0;

  return (
    (signals.detailedReview ? 50 : 10) +
    (cleanup.blockedFields.length > 0 &&
    !["answered", "revision_queued"].includes(ownerStatus ?? "")
      ? 35
      : 0) +
    (qualityReady ? 16 : 0) +
    (cleanup.fieldNeedsOwnerVerification ? 10 : 0) +
    (ownerStatus === "answered" ? 18 : 0) +
    (ownerStatus === "revision_queued" ? 6 : 0) +
    (isNewPersonChangeType(row.change_type) ? 30 : 0) +
    (row.change_type === "want_to_know_candidate" ? 20 : 0) +
    Math.min(signals.supportedFieldCount * 6, 24) +
    Math.min(signals.unsupportedKeyCount * 8, 24) +
    Math.min(signals.duplicateCount * 10, 20) +
    Math.min(daysWaiting(row, now) * 3, 18)
  );
}
