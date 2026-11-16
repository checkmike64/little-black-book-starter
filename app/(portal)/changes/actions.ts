"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  pendingChangeNeedsDetailedReview,
  pendingChangeRiskReason,
} from "@/lib/pending-change-risk";
import {
  qualityCleanupApprovalBlockingFields,
  qualityCleanupDetails,
} from "@/lib/pending-change-review";
import {
  contactFieldTypes,
  type ContactField,
  type ContactUpdates,
} from "@/lib/contact-fields";
import {
  redirectWithMessage,
  safeFormReturnPath,
} from "@/lib/server-action-redirect";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateProspectingCandidatePolicy } from "@/lib/prospecting-buckets";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { pendingChangePayloadBody } from "@/lib/pending-change-inspection";
import { isNewPersonChangeType } from "@/lib/pending-change-types";
import {
  enqueueContactEnrichmentJob,
  enqueueInitialContactEnrichment,
  syncAndStartContactContentDiscovery,
} from "@/lib/contact-enrichment-jobs";
import { approveNewContactOnce } from "@/lib/contact-creation";
import { syncContactContentScanSources } from "@/lib/automation/content-scans";
import {
  contactDuplicateInputFromPayload,
  findDuplicateCandidates,
  recommendedExistingContact,
  type ContactDuplicateRecord,
} from "@/lib/contact-duplicate-detection";
import { isGroupableProfileChange } from "@/lib/change-review-groups";

type PendingChange = {
  id: string;
  tenant_id: string;
  contact_id: string | null;
  change_type: string;
  summary: string;
  payload: Record<string, unknown>;
  risk_level: string | null;
  source: string | null;
  replaces_pending_change_id?: string | null;
  replaced_by_pending_change_id?: string | null;
  superseded_at?: string | null;
};

const contentSourceFields = new Set<ContactField>([
  "website",
  "linkedin",
  "instagram",
  "facebook",
  "x_twitter",
  "youtube",
]);

type WantToKnowInsert = {
  full_name: string;
  bucket?: string | null;
  lane?: string | null;
  stage?: string;
  company?: string | null;
  source?: string | null;
  why?: string | null;
  linkedin?: string | null;
  dossier?: Record<string, unknown>;
  engagement_count?: number;
  last_touch?: string | null;
};

const wantToKnowStages = new Set([
  "watching",
  "warming",
  "ready",
  "graduated",
]);

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function reviewRedirect(message: string): never {
  redirectWithMessage("/changes", message);
}

function reviewFormRedirect(formData: FormData, message: string): never {
  redirectWithMessage(safeFormReturnPath(formData, "/changes"), message);
}

function reviewDetailRedirect(changeId: string, message: string): never {
  redirectWithMessage(`/changes/${changeId}`, message);
}

const profileChangesPath = "/changes?view=profile";

function profileReviewReturnPath(formData: FormData) {
  return safeFormReturnPath(formData, profileChangesPath);
}

function profileReviewRedirect(formData: FormData, message: string): never {
  redirectWithMessage(profileReviewReturnPath(formData), message);
}

function profileReviewDetailRedirect(
  formData: FormData,
  changeId: string,
  message: string,
): never {
  const params = new URLSearchParams({
    return_to: profileReviewReturnPath(formData),
  });
  redirectWithMessage(`/changes/${changeId}?${params.toString()}`, message);
}

function getChangeId(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  return isValidUuid(id) ? id : null;
}

function selectedChangeIds(formData: FormData, key = "ids") {
  return formData
    .getAll(key)
    .map((value) => String(value))
    .filter(isValidUuid)
    .slice(0, 25);
}

function selectedProfileFields(formData: FormData) {
  const selections = new Map<string, Set<ContactField>>();

  for (const value of formData.getAll("fields").slice(0, 100)) {
    const [changeId, fieldName, ...extra] = String(value).split(":");
    if (
      extra.length > 0
      || !changeId
      || !fieldName
      || !isValidUuid(changeId)
      || !(fieldName in contactFieldTypes)
    ) {
      continue;
    }
    const fields = selections.get(changeId) ?? new Set<ContactField>();
    fields.add(fieldName as ContactField);
    selections.set(changeId, fields);
  }

  return selections;
}

function profileReviewChangeIds(formData: FormData) {
  return [
    ...new Set(
      formData
        .getAll("review_change_ids")
        .map((value) => String(value))
        .filter(isValidUuid)
        .slice(0, 50),
    ),
  ];
}

function dismissedProfileField(formData: FormData) {
  const [changeId, fieldName, returnId, ...extra] = String(
    formData.get("dismiss_field") ?? "",
  ).split(":");

  if (
    extra.length > 0
    || !isValidUuid(changeId)
    || !(fieldName in contactFieldTypes)
  ) {
    return null;
  }

  return {
    changeId,
    field: fieldName as ContactField,
    returnId: returnId && isValidUuid(returnId) ? returnId : null,
  };
}

function correctedProfileField(formData: FormData) {
  const [changeId, fieldName, returnId, ...extra] = String(
    formData.get("correction_field") ?? "",
  ).split(":");

  if (
    extra.length > 0
    || !isValidUuid(changeId)
    || !(fieldName in contactFieldTypes)
  ) {
    return null;
  }

  return {
    changeId,
    field: fieldName as ContactField,
    returnId: returnId && isValidUuid(returnId) ? returnId : null,
  };
}

function getTargetContactId(formData: FormData) {
  const id = String(formData.get("target_contact_id") ?? "");
  return isValidUuid(id) ? id : null;
}

function fieldsPayload(payload: Record<string, unknown>) {
  const nestedFields = payload.fields;
  if (
    nestedFields &&
    typeof nestedFields === "object" &&
    !Array.isArray(nestedFields)
  ) {
    return nestedFields as Record<string, unknown>;
  }

  const legacyField = typeof payload.field === "string" ? payload.field.trim() : "";
  const legacyValue = payload.proposed_value ?? payload.proposed_addition;
  if (legacyField && legacyValue !== undefined) {
    return {
      [legacyField]: contactFieldTypes[legacyField as ContactField] === "text_array"
        && !Array.isArray(legacyValue)
        ? [legacyValue]
        : legacyValue,
    };
  }

  return payload;
}

function scopedFieldPayload(
  payload: Record<string, unknown>,
  selectedFields: ReadonlySet<ContactField>,
) {
  const proposedFields = fieldsPayload(payload);
  const fields = Object.fromEntries(
    Object.entries(proposedFields).filter(([field]) => selectedFields.has(field as ContactField)),
  );

  return {
    ...payload,
    fields,
  };
}

function remainingFieldPayload(
  payload: Record<string, unknown>,
  removedFields: ReadonlySet<string>,
) {
  const proposedFields = fieldsPayload(payload);
  const fields = Object.fromEntries(
    Object.entries(proposedFields).filter(([field]) => !removedFields.has(field as ContactField)),
  );
  const previousValues = payload.previous_values;

  return {
    fields,
    payload: {
      ...payload,
      fields,
      ...(previousValues && typeof previousValues === "object" && !Array.isArray(previousValues)
        ? {
            previous_values: Object.fromEntries(
              Object.entries(previousValues).filter(([field]) => field in fields),
            ),
          }
        : {}),
    },
  };
}

function remainingFieldsSummary(fields: Record<string, unknown>) {
  const labels = Object.keys(fields).map((field) => field.replaceAll("_", " "));
  return `Remaining profile update: ${labels.join(", ")}`;
}

function wantToKnowPayload(payload: Record<string, unknown>) {
  const candidate = payload.candidate;
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    return candidate as Record<string, unknown>;
  }

  return fieldsPayload(payload);
}

function normalizeText(value: unknown, maxLength: number) {
  if (value === null || value === undefined) return null;
  const clean = String(value).trim().slice(0, maxLength);
  return clean || null;
}

function normalizeDossier(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function normalizeEngagementCount(value: unknown) {
  const numberValue =
    typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(numberValue)) return 0;
  return Math.min(Math.max(Math.round(numberValue), 0), 1000);
}

function normalizeWantToKnowCandidate(payload: Record<string, unknown>) {
  const candidate = wantToKnowPayload(payload);
  const fullName = normalizeText(candidate.full_name ?? candidate.name, 240);
  const stage = String(candidate.stage ?? "watching").trim();
  const lastTouch = normalizeText(candidate.last_touch, 10);

  if (!fullName) return null;

  return {
    full_name: fullName,
    bucket: normalizeText(candidate.bucket, 120),
    lane: normalizeText(candidate.lane, 120),
    stage: wantToKnowStages.has(stage) ? stage : "watching",
    company: normalizeText(candidate.company, 240),
    source: normalizeText(candidate.source, 240),
    why: normalizeText(candidate.why, 1200),
    linkedin: normalizeText(candidate.linkedin, 500),
    dossier: normalizeDossier(candidate.dossier),
    engagement_count: normalizeEngagementCount(candidate.engagement_count),
    last_touch: lastTouch && /^\d{4}-\d{2}-\d{2}$/.test(lastTouch) ? lastTouch : null,
  } satisfies WantToKnowInsert;
}

function normalizeFieldValue(field: ContactField, value: unknown) {
  const type = contactFieldTypes[field];

  if (value === null) return null;

  if (type === "boolean") {
    return typeof value === "boolean" ? value : undefined;
  }

  if (type === "date") {
    if (typeof value !== "string") return undefined;
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  }

  if (type === "text_array") {
    if (Array.isArray(value)) {
      const clean = value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
      return clean.length > 0 ? clean : null;
    }
    return undefined;
  }

  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOwnerCorrection(field: ContactField, value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;

  const type = contactFieldTypes[field];
  if (type === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    return undefined;
  }
  if (type === "date") {
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
  }
  if (type === "text_array") {
    const items = raw
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 50);
    return items.length > 0 ? [...new Set(items)] : undefined;
  }

  return raw.slice(0, 4000);
}

function normalizeContactUpdates(payload: Record<string, unknown>) {
  const update: ContactUpdates = {};
  const proposedFields = fieldsPayload(payload);

  for (const [field, rawValue] of Object.entries(proposedFields)) {
    if (!(field in contactFieldTypes)) continue;

    const normalized = normalizeFieldValue(field as ContactField, rawValue);
    if (normalized !== undefined && normalized !== null) {
      update[field] = normalized;
    }
  }

  return addStrengthOverride(update);
}

function normalizeNewContact(payload: Record<string, unknown>, changeType: string) {
  const update: ContactUpdates = {};
  const proposedFields = pendingChangePayloadBody({
    change_type: changeType,
    payload,
  });

  for (const [field, rawValue] of Object.entries(proposedFields)) {
    if (!(field in contactFieldTypes)) continue;

    const normalized = normalizeFieldValue(field as ContactField, rawValue);
    if (normalized !== undefined && normalized !== null) {
      update[field] = normalized;
    }
  }

  return addStrengthOverride(update);
}

function addStrengthOverride(update: ContactUpdates) {
  if (
    typeof update.relationship_strength === "string" &&
    update.relationship_strength &&
    update.relationship_strength_override === undefined
  ) {
    update.relationship_strength_override = true;
  }

  return update;
}

function payloadMetadata(payload: Record<string, unknown>) {
  return {
    evidence: payload.evidence ?? null,
    verification: payload.verification ?? null,
    duplicate_candidates: payload.duplicate_candidates ?? null,
    source_ref: payload.source_ref ?? null,
  };
}

function ownerContextStatus(payload: Record<string, unknown>) {
  const context = payload.owner_context;
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;

  const status = (context as Record<string, unknown>).status;
  return typeof status === "string" && status.trim() ? status.trim() : null;
}

function qualityCleanupBlockedFields(payload: Record<string, unknown>) {
  const cleanup = payload.quality_cleanup;
  if (!cleanup || typeof cleanup !== "object" || Array.isArray(cleanup)) {
    return null;
  }
  return qualityCleanupDetails(payload).blockedFields;
}

function approvalBlockedReason(change: PendingChange) {
  const blockedFields = qualityCleanupApprovalBlockingFields(change.payload);
  const ownerStatus = ownerContextStatus(change.payload);

  if (ownerStatus === "revision_queued") {
    return "A Claude revision is queued for this proposal. Review the replacement before approving.";
  }

  if (blockedFields.length > 0 && ownerStatus !== "answered") {
    return `Owner/source context is still needed for: ${blockedFields.join(", ")}.`;
  }

  return null;
}

function replacementMetadata(payload: Record<string, unknown>) {
  return metadataObject(payload, "replacement");
}

function replacementStatus(payload: Record<string, unknown>) {
  const status = replacementMetadata(payload).status;
  return typeof status === "string" && status.trim() ? status.trim() : null;
}

function replacementPendingChangeId(payload: Record<string, unknown>) {
  const id = replacementMetadata(payload).replacement_pending_change_id;
  return typeof id === "string" && isValidUuid(id) ? id : null;
}

function isReplacedChange(change: PendingChange) {
  return Boolean(change.replaced_by_pending_change_id || change.superseded_at) ||
    replacementStatus(change.payload) === "replaced";
}

function assertNotReplaced(change: PendingChange) {
  const replacementId =
    change.replaced_by_pending_change_id ?? replacementPendingChangeId(change.payload);
  if (isReplacedChange(change) && replacementId) {
    reviewRedirect(
      `This proposal was replaced by ${replacementId.slice(0, 8)}. Review the newer proposal instead.`,
    );
  }
}

function shortText(formData: FormData, key: string, maxLength: number) {
  const value = String(formData.get(key) ?? "").trim();
  return value ? value.slice(0, maxLength) : null;
}

function mergePayloadMetadata(
  payload: Record<string, unknown>,
  key: string,
  metadata: Record<string, unknown>,
) {
  const existing = payload[key];
  const existingObject =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};

  return {
    ...payload,
    [key]: {
      ...existingObject,
      ...metadata,
    },
  };
}

function metadataObject(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function wantToKnowIdFromPayload(payload: Record<string, unknown>) {
  const evidence = metadataObject(payload, "evidence");
  const sourceRef = typeof payload.source_ref === "string" ? payload.source_ref : "";
  const evidenceId = evidence.want_to_know_id;

  if (typeof evidenceId === "string" && isValidUuid(evidenceId)) {
    return evidenceId;
  }

  const [, refId] = sourceRef.match(/^want_to_know:([0-9a-f-]{36})$/i) ?? [];
  return refId && isValidUuid(refId) ? refId : null;
}

async function markWantToKnowGraduated({
  admin,
  change,
  contactId,
  userId,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  change: PendingChange;
  contactId: string;
  userId: string;
}) {
  const wantToKnowId = wantToKnowIdFromPayload(change.payload);
  if (!wantToKnowId) return;

  const { data: before } = await admin
    .from("want_to_know")
    .select("id, stage, full_name, bucket, lane")
    .eq("tenant_id", change.tenant_id)
    .eq("id", wantToKnowId)
    .maybeSingle();

  const { error } = await admin
    .from("want_to_know")
    .update({
      stage: "graduated",
      graduated_contact_id: contactId,
      graduated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", change.tenant_id)
    .eq("id", wantToKnowId);

  if (error) return;

  await admin.from("audit_log").insert({
    tenant_id: change.tenant_id,
    actor_user_id: userId,
    actor_type: "client",
    action: "want_to_know.graduated",
    table_name: "want_to_know",
    record_id: wantToKnowId,
    before: before ?? {},
    after: {
      stage: "graduated",
      contact_id: contactId,
      pending_change_id: change.id,
    },
    metadata: {
      source: change.source,
      change_type: change.change_type,
    },
  });
}

async function insertFieldProvenance({
  admin,
  tenantId,
  contactId,
  fields,
  change,
  userId,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  tenantId: string;
  contactId: string;
  fields: ContactUpdates;
  change: PendingChange;
  userId: string;
}) {
  const rows = Object.keys(fields).map((fieldName) => ({
    tenant_id: tenantId,
    table_name: "contacts",
    record_id: contactId,
    field_name: fieldName,
    source_type: "claude",
    source_ref: change.source,
    summary: change.summary,
    metadata: {
      pending_change_id: change.id,
      approved_by: userId,
      change_type: change.change_type,
      ...payloadMetadata(change.payload),
    },
  }));

  if (rows.length > 0) {
    await admin.from("field_provenance").insert(rows);
  }
}

async function queuePostApprovalEnrichment({
  admin,
  tenantId,
  contactId,
  change,
  userId,
  newContactCreated = false,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  tenantId: string;
  contactId: string;
  change: PendingChange;
  userId: string;
  newContactCreated?: boolean;
}) {
  if (newContactCreated) {
    const initial = await enqueueInitialContactEnrichment({
      admin,
      tenantId,
      userId,
      contactId,
      trigger: "approved_new_contact",
      source: change.source ?? "client_claude_project",
      pendingChangeId: change.id,
    });
    return initial?.id ?? null;
  }

  const scanSources = await syncContactContentScanSources({ admin, tenantId, contactId });
  const queued = await enqueueContactEnrichmentJob({
    admin,
    tenantId,
    contactId,
    idempotencyKey: `approved-change-enrichment:${change.id}:${contactId}`,
    requestedBy: userId,
    payload: {
      trigger: "merged_new_contact_proposal",
      source: change.source ?? "client_claude_project",
      pending_change_id: change.id,
      requested_by: userId,
      required_steps: [
        "post_approval_duplicate_check",
        "review_approved_fields",
        "public_profile_discovery",
        "public_profile_verification",
        "content_scan_source_sync",
        "follow_up_pending_change_proposals",
      ],
      known_profile_scan_sources: scanSources.registered,
      research_policy:
        "Use owner-authorized transcript, correspondence, and public profile sources. Propose uncertain fields for owner review.",
    },
  });
  return queued?.id ?? null;
}

async function markChangeApproved({
  admin,
  change,
  userId,
  reviewedAt,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  change: PendingChange;
  userId: string;
  reviewedAt: string;
}) {
  const { error } = await admin
    .from("pending_changes")
    .update({
      status: "approved",
      reviewed_by: userId,
      reviewed_at: reviewedAt,
    })
    .eq("tenant_id", change.tenant_id)
    .eq("id", change.id);

  return error;
}

async function approveWantToKnowCandidate({
  admin,
  change,
  userId,
  reviewedAt,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  change: PendingChange;
  userId: string;
  reviewedAt: string;
}) {
  const candidate = normalizeWantToKnowCandidate(change.payload);

  if (!candidate) {
    reviewRedirect("Want to Know proposals need a candidate name before approval.");
  }

  const [{ data: tenant }, { data: membership }] = await Promise.all([
    admin.from("tenants").select("settings").eq("id", change.tenant_id).maybeSingle(),
    admin
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", change.tenant_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  const reviewerRole = membership?.role === "operator" ? "operator" : membership?.role === "owner" ? "owner" : null;
  const policyValidation = validateProspectingCandidatePolicy({
    settings: normalizeTenantSettings(tenant?.settings),
    payload: change.payload,
    proposalSource: change.source,
    reviewerRole,
  });
  if (!policyValidation.ok) reviewRedirect(policyValidation.reason);

  const insertPayload = {
    ...candidate,
    tenant_id: change.tenant_id,
    owner_selected_at: reviewerRole === "owner" ? reviewedAt : null,
    owner_selected_by: reviewerRole === "owner" ? userId : null,
  };

  const { data: row, error: insertError } = await admin
    .from("want_to_know")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insertError || !row) {
    reviewRedirect("The Want to Know candidate could not be added.");
  }

  const changeError = await markChangeApproved({
    admin,
    change,
    userId,
    reviewedAt,
  });

  if (changeError) {
    reviewRedirect("The candidate was added, but the review status could not be saved.");
  }

  await admin.from("audit_log").insert({
    tenant_id: change.tenant_id,
    actor_user_id: userId,
    actor_type: "client",
    action: "pending_change.want_to_know_candidate_approved",
    table_name: "pending_changes",
    record_id: change.id,
    after: {
      want_to_know_id: row.id,
      candidate,
    },
    metadata: {
      change_type: change.change_type,
      source: change.source,
      ...payloadMetadata(change.payload),
    },
  });

  revalidateReviewSurfaces();
  reviewRedirect("Want to Know candidate approved and added to the outer ring.");
}

function revalidateReviewSurfaces(contactId?: string | null) {
  revalidatePath("/changes");
  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  revalidatePath("/ops");
  revalidatePath("/ask");
  revalidatePath("/want-to-know");
  if (contactId) revalidatePath(`/contacts/${contactId}`);
}

function rpcObject(value: unknown) {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved && typeof resolved === "object" && !Array.isArray(resolved)
    ? resolved as Record<string, unknown>
    : null;
}

async function reviewRecordingBaselineChange({
  admin,
  change,
  userId,
  decision,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  change: PendingChange;
  userId: string;
  decision: "approve" | "dismiss";
}): Promise<
  | { ok: true; contactId: string }
  | { ok: false; conflict: boolean }
> {
  try {
    const { data, error } = await admin.rpc("lbb_review_recording_baseline_change", {
      p_tenant_id: change.tenant_id,
      p_change_id: change.id,
      p_actor_user_id: userId,
      p_decision: decision,
    });
    const result = rpcObject(data);
    const expectedStatus = decision === "approve" ? "approved" : "dismissed";
    const contactId = typeof result?.contact_id === "string" ? result.contact_id : null;
    if (
      error
      || !result
      || result.change_id !== change.id
      || result.status !== expectedStatus
      || !contactId
      || contactId !== change.contact_id
    ) {
      return { ok: false, conflict: error?.code === "40001" };
    }
    return { ok: true, contactId };
  } catch {
    return { ok: false, conflict: false };
  }
}

async function reviewOperatorRecordingAction({
  admin,
  change,
  userId,
  decision,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  change: PendingChange;
  userId: string;
  decision: "approve" | "decline";
}): Promise<
  | { ok: true; contactId: string }
  | { ok: false; conflict: boolean }
> {
  try {
    const { data, error } = await admin.rpc("lbb_review_operator_recording_action", {
      p_tenant_id: change.tenant_id,
      p_change_id: change.id,
      p_actor_user_id: userId,
      p_decision: decision,
    });
    const result = rpcObject(data);
    const expectedStatus = decision === "approve" ? "approved" : "dismissed";
    if (
      error
      || !result
      || result.change_id !== change.id
      || result.status !== expectedStatus
      || !change.contact_id
      || (decision === "approve" && typeof result.action_id !== "string")
    ) {
      return { ok: false, conflict: error?.code === "40001" };
    }
    return { ok: true, contactId: change.contact_id };
  } catch {
    return { ok: false, conflict: false };
  }
}

function isOperatorRecordingAction(change: PendingChange) {
  return change.source === "recording_operator" && change.change_type === "recording_action";
}

async function getReviewContext(changeId: string) {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  if (!supabase || !admin) {
    reviewRedirect("Supabase is not configured for review actions.");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: change, error } = await supabase
    .from("pending_changes")
    .select(
      "id, tenant_id, contact_id, change_type, summary, payload, risk_level, source, replaces_pending_change_id, replaced_by_pending_change_id, superseded_at",
    )
    .eq("id", changeId)
    .eq("status", "pending")
    .single();

  if (error || !change) {
    reviewRedirect("That pending change is no longer available.");
  }

  return {
    admin,
    change: change as PendingChange,
    userId: user.id,
  };
}

async function getReviewBase() {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  if (!supabase || !admin) {
    reviewRedirect("Supabase is not configured for review actions.");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return {
    admin,
    supabase,
    userId: user.id,
  };
}

function isBulkApprovable(change: PendingChange) {
  if (isReplacedChange(change)) return false;
  if (pendingChangeNeedsDetailedReview(change)) return false;
  if (!change.contact_id) return false;
  return ["field_update", "contact_enrichment"].includes(change.change_type);
}

async function approveContactFieldChange({
  admin,
  approvalSurface,
  change,
  dismissRemainingFields = false,
  selectedFields,
  userId,
  reviewedAt,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  approvalSurface: string;
  change: PendingChange;
  dismissRemainingFields?: boolean;
  selectedFields?: ReadonlySet<ContactField>;
  userId: string;
  reviewedAt: string;
}) {
  if (change.source === "recording_baseline") {
    return { approved: false, contactId: change.contact_id };
  }
  const scopedChange: PendingChange = selectedFields
    ? {
        ...change,
        payload: scopedFieldPayload(change.payload, selectedFields),
      }
    : change;
  const contactUpdates = normalizeContactUpdates(scopedChange.payload);

  if (!change.contact_id || Object.keys(contactUpdates).length === 0) {
    return { approved: false, contactId: change.contact_id };
  }

  const { data: beforeContact } = await admin
    .from("contacts")
    .select(Object.keys(contactUpdates).join(", "))
    .eq("tenant_id", change.tenant_id)
    .eq("id", change.contact_id)
    .single();

  const legacyAdditionField = scopedChange.payload.proposed_addition !== undefined
    && typeof scopedChange.payload.field === "string"
    ? scopedChange.payload.field.trim()
    : null;
  if (
    legacyAdditionField
    && contactFieldTypes[legacyAdditionField as ContactField] === "text_array"
    && Array.isArray(contactUpdates[legacyAdditionField])
  ) {
    const beforeFields = beforeContact as Record<string, unknown> | null;
    const beforeValues = Array.isArray(beforeFields?.[legacyAdditionField])
      ? beforeFields[legacyAdditionField] as string[]
      : [];
    contactUpdates[legacyAdditionField] = [
      ...new Set([...beforeValues, ...(contactUpdates[legacyAdditionField] as string[])]),
    ];
  }

  const { error: contactError } = await admin
    .from("contacts")
    .update(contactUpdates)
    .eq("tenant_id", change.tenant_id)
    .eq("id", change.contact_id);

  if (contactError) {
    return { approved: false, contactId: change.contact_id };
  }

  const remaining = selectedFields
    ? remainingFieldPayload(change.payload, selectedFields)
    : { fields: {}, payload: change.payload };
  const remainingFieldNames = Object.keys(remaining.fields);
  const dismissedFieldNames = dismissRemainingFields ? remainingFieldNames : [];
  const isPartialApproval = selectedFields !== undefined
    && remainingFieldNames.length > 0
    && !dismissRemainingFields;
  const changeError = isPartialApproval
    ? (await admin
        .from("pending_changes")
        .update({
          payload: remaining.payload,
          summary: remainingFieldsSummary(remaining.fields),
        })
        .eq("tenant_id", change.tenant_id)
        .eq("id", change.id)
        .eq("status", "pending")).error
    : await markChangeApproved({
        admin,
        change,
        userId,
        reviewedAt,
      });

  if (changeError) {
    return { approved: false, contactId: change.contact_id };
  }

  await insertFieldProvenance({
    admin,
    tenantId: change.tenant_id,
    contactId: change.contact_id,
    fields: contactUpdates,
    change: scopedChange,
    userId,
  });

  await admin.from("audit_log").insert({
    tenant_id: change.tenant_id,
    actor_user_id: userId,
    actor_type: "client",
    action: isPartialApproval
      ? "pending_change.fields_partially_approved"
      : dismissedFieldNames.length > 0
        ? "pending_change.fields_approved_with_unchecked_dismissed"
      : "pending_change.approved",
    table_name: "pending_changes",
    record_id: change.id,
    before: beforeContact ?? {},
    after: {
      contact_id: change.contact_id,
      fields: contactUpdates,
    },
    metadata: {
      change_type: change.change_type,
      source: change.source,
      enrichment_job_id: null,
      post_approval_enrichment: "suppressed",
      approval_mode: dismissRemainingFields
        ? "selected_fields_finish"
        : isPartialApproval
          ? "selected_fields"
          : "single_or_bulk",
      approval_surface: approvalSurface,
      approved_fields: Object.keys(contactUpdates),
      remaining_fields: isPartialApproval ? remainingFieldNames : [],
      dismissed_fields: dismissedFieldNames,
    },
  });

  const approvedFields = Object.keys(contactUpdates) as ContactField[];
  if (approvedFields.some((field) => contentSourceFields.has(field))) {
    await syncAndStartContactContentDiscovery({
      admin,
      tenantId: change.tenant_id,
      contactId: change.contact_id,
      reason: "approved_profile_source",
    });
  }

  return {
    approved: true,
    contactId: change.contact_id,
    partial: isPartialApproval,
    dismissedFields: dismissedFieldNames.length,
    approvedFields,
  };
}

export async function approvePendingChange(formData: FormData) {
  const changeId = getChangeId(formData);
  if (!changeId) reviewRedirect("Invalid pending change.");

  const { admin, change, userId } = await getReviewContext(changeId);
  const reviewedAt = new Date().toISOString();
  const reviewScope = String(formData.get("review_scope") ?? "");
  const requestedApprovalSurface = shortText(formData, "approval_surface", 80);
  const approvalSurface =
    requestedApprovalSurface === "launch_cohort" ||
    requestedApprovalSurface === "owner_change_card" ||
    requestedApprovalSurface === "owner_change_detail"
      ? requestedApprovalSurface
      : reviewScope === "detailed"
        ? "detail_review"
        : "standard_queue";

  assertNotReplaced(change);

  if (isOperatorRecordingAction(change)) {
    const result = await reviewOperatorRecordingAction({
      admin,
      change,
      userId,
      decision: "approve",
    });
    if (!result.ok) {
      reviewRedirect(
        result.conflict
          ? "This meeting action changed after it was proposed. Nothing was approved. Refresh and review it again."
          : "This meeting action could not be approved. Nothing was changed.",
      );
    }
    revalidateReviewSurfaces(result.contactId);
    revalidatePath("/movement");
    reviewFormRedirect(formData, "Approved and added to Next Moves.");
  }

  const blocker = approvalBlockedReason(change);
  if (blocker) {
    reviewRedirect(blocker);
  }

  if (pendingChangeNeedsDetailedReview(change) && reviewScope !== "detailed") {
    reviewRedirect(pendingChangeRiskReason(change));
  }

  if (change.source === "recording_baseline") {
    const result = await reviewRecordingBaselineChange({
      admin,
      change,
      userId,
      decision: "approve",
    });
    if (!result.ok) {
      reviewRedirect(
        result.conflict
          ? "This contact changed since the meeting proposal was created. Nothing was approved. Refresh and review it again."
          : "This meeting change could not be approved. Nothing was changed.",
      );
    }
    revalidateReviewSurfaces(result.contactId);
    reviewFormRedirect(formData, "Approved and written to the book.");
  }

  if (isNewPersonChangeType(change.change_type)) {
    const createSeparate =
      String(formData.get("identity_resolution") ?? "") === "create_separate";
    const {
      data: existingContacts,
      error: existingContactsError,
      count: existingContactsCount,
    } = await admin
      .from("contacts")
      .select(
        "id, full_name, email, phone, company_name, role_title, linkedin, website, relationship_type, one_line_summary",
        { count: "exact" },
      )
      .eq("tenant_id", change.tenant_id)
      .is("archived_at", null)
      .limit(2000);

    if (
      existingContactsError
      || !Number.isSafeInteger(existingContactsCount)
      || existingContactsCount !== (existingContacts?.length ?? 0)
    ) {
      reviewDetailRedirect(
        change.id,
        "The Book could not be checked for an existing person. Nothing was added.",
      );
    }

    const recommendedDuplicate = recommendedExistingContact(
      findDuplicateCandidates(
        contactDuplicateInputFromPayload(change.payload),
        (existingContacts ?? []) as ContactDuplicateRecord[],
        { minimumScore: 30, limit: 8 },
      ),
    );

    if (recommendedDuplicate && !createSeparate) {
      reviewDetailRedirect(
        change.id,
        `${recommendedDuplicate.contact.full_name} appears to be the same person. Review the profile update before adding anyone new.`,
      );
    }

    const contactInsert = normalizeNewContact(change.payload, change.change_type);
    if (typeof contactInsert.full_name !== "string" || contactInsert.full_name.length < 2) {
      reviewRedirect("New contact proposals need a full name before approval.");
    }

    const contactExtra = {
      pending_change_id: change.id,
      ...payloadMetadata(change.payload),
    };
    const { result: creation, error: contactError } = await approveNewContactOnce({
      admin,
      tenantId: change.tenant_id,
      pendingChangeId: change.id,
      actorUserId: userId,
      fields: contactInsert,
      source: "claude_proposal",
      extra: contactExtra,
    });

    if (contactError || !creation) {
      reviewRedirect("The new contact could not be written to the Book.");
    }

    if (creation.created) {
      await insertFieldProvenance({
        admin,
        tenantId: change.tenant_id,
        contactId: creation.contactId,
        fields: contactInsert,
        change,
        userId,
      });
    }

    const enrichmentJobId = await queuePostApprovalEnrichment({
      admin,
      tenantId: change.tenant_id,
      contactId: creation.contactId,
      change,
      userId,
      newContactCreated: true,
    });

    if (!creation.approvalReplayed) {
      await markWantToKnowGraduated({
        admin,
        change,
        contactId: creation.contactId,
        userId,
      });

      await admin.from("audit_log").insert({
        tenant_id: change.tenant_id,
        actor_user_id: userId,
        actor_type: "client",
        action: "pending_change.new_contact_approved",
        table_name: "pending_changes",
        record_id: change.id,
        after: {
          contact_id: creation.contactId,
          fields: contactInsert,
        },
        metadata: {
          change_type: change.change_type,
          source: change.source,
          enrichment_job_id: enrichmentJobId,
          contact_creation_replayed: creation.replayed,
          identity_resolution: createSeparate ? "create_separate" : "new_person",
        },
      });
    }

    revalidateReviewSurfaces(creation.contactId);
    reviewFormRedirect(formData, "New contact approved and enrichment follow-up queued.");
  }

  if (change.change_type === "want_to_know_candidate") {
    await approveWantToKnowCandidate({
      admin,
      change,
      userId,
      reviewedAt,
    });
  }

  if (
    !["field_update", "contact_enrichment"].includes(change.change_type) ||
    !change.contact_id
  ) {
    reviewRedirect("This change type needs a dedicated approval workflow first.");
  }

  const contactUpdates = normalizeContactUpdates(change.payload);
  if (Object.keys(contactUpdates).length === 0) {
    reviewRedirect("No supported contact fields were found in that proposal.");
  }

  const result = await approveContactFieldChange({
    admin,
    approvalSurface,
    change,
    userId,
    reviewedAt,
  });

  if (!result.approved) {
    reviewRedirect("The contact update failed. Nothing was approved.");
  }

  revalidateReviewSurfaces(change.contact_id);
  reviewFormRedirect(
    formData,
    change.change_type === "contact_enrichment"
      ? "Profile update approved."
      : "Approved and written to the book.",
  );
}

async function getSelectedProfileReviewContext(formData: FormData) {
  const selections = selectedProfileFields(formData);
  const { admin, supabase, userId } = await getReviewBase();
  const submittedChangeIds = profileReviewChangeIds(formData);
  const changeIds = submittedChangeIds.length > 0
    ? submittedChangeIds
    : [...selections.keys()];
  if (changeIds.length === 0) {
    profileReviewRedirect(formData, "That profile review no longer contains any fields.");
  }
  const { data, error } = await supabase
    .from("pending_changes")
    .select(
      "id, tenant_id, contact_id, change_type, summary, payload, risk_level, source, replaces_pending_change_id, replaced_by_pending_change_id, superseded_at",
    )
    .eq("status", "pending")
    .in("id", changeIds);

  if (error || !data || data.length !== changeIds.length) {
    profileReviewRedirect(formData, "Some of those profile fields are no longer waiting. Refresh and review them again.");
  }

  const changes = data as PendingChange[];
  const first = changes[0];
  if (
    !first
    || !first.contact_id
    || changes.some((change) =>
      !isGroupableProfileChange(change)
      || change.tenant_id !== first.tenant_id
      || change.contact_id !== first.contact_id
      || isReplacedChange(change)
    )
  ) {
    profileReviewRedirect(formData, "Those fields do not belong to one current profile review.");
  }

  for (const change of changes) {
    const selected = selections.get(change.id) ?? new Set<ContactField>();
    const proposed = fieldsPayload(change.payload);
    if ([...selected].some((field) => !(field in proposed))) {
      profileReviewRedirect(formData, "One of the selected fields changed after the page loaded. Refresh and review it again.");
    }
  }

  return { admin, changes, selections, userId, contactId: first.contact_id };
}

async function dismissProfileFields({
  admin,
  change,
  fields,
  userId,
  reviewedAt,
  dismissalMode,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  change: PendingChange;
  fields: ReadonlySet<string>;
  userId: string;
  reviewedAt: string;
  dismissalMode: "individual_field" | "unchecked_on_finish";
}) {
  const proposed = fieldsPayload(change.payload);
  const validFields = new Set(
    [...fields].filter((field) => field in proposed),
  );
  if (validFields.size === 0) {
    return { dismissed: false, remainingFieldNames: Object.keys(proposed) };
  }

  const remaining = remainingFieldPayload(change.payload, validFields);
  const remainingFieldNames = Object.keys(remaining.fields);
  const update = remainingFieldNames.length > 0
    ? {
        payload: remaining.payload,
        summary: remainingFieldsSummary(remaining.fields),
      }
    : {
        status: "dismissed",
        reviewed_by: userId,
        reviewed_at: reviewedAt,
      };
  const { data, error } = await admin
    .from("pending_changes")
    .update(update)
    .eq("tenant_id", change.tenant_id)
    .eq("id", change.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { dismissed: false, remainingFieldNames };
  }

  await admin.from("audit_log").insert({
    tenant_id: change.tenant_id,
    actor_user_id: userId,
    actor_type: "client",
    action: remainingFieldNames.length > 0
      ? "pending_change.fields_partially_dismissed"
      : "pending_change.dismissed",
    table_name: "pending_changes",
    record_id: change.id,
    before: {
      status: "pending",
      fields: [...validFields],
    },
    after: remainingFieldNames.length > 0
      ? { status: "pending", remaining_fields: remainingFieldNames }
      : { status: "dismissed" },
    metadata: {
      change_type: change.change_type,
      source: change.source,
      dismissal_mode: dismissalMode,
      dismissed_fields: [...validFields],
    },
  });

  return { dismissed: true, remainingFieldNames };
}

export async function approveSelectedProfileFields(formData: FormData) {
  const { admin, changes, selections, userId, contactId } =
    await getSelectedProfileReviewContext(formData);
  const reviewedAt = new Date().toISOString();

  for (const change of changes) {
    const selected = selections.get(change.id) ?? new Set<ContactField>();
    if (selected.size === 0) continue;
    const scopedChange = {
      ...change,
      payload: scopedFieldPayload(change.payload, selected),
    };
    const blocker = approvalBlockedReason(scopedChange);
    if (blocker) profileReviewRedirect(formData, blocker);
    if (Object.keys(normalizeContactUpdates(scopedChange.payload)).length === 0) {
      profileReviewRedirect(formData, "A selected field cannot be written safely. Nothing was approved.");
    }
  }

  let approvedFields = 0;
  let dismissedFields = 0;
  for (const change of changes) {
    const selected = selections.get(change.id) ?? new Set<ContactField>();
    if (selected.size === 0) {
      const proposedFields = Object.keys(fieldsPayload(change.payload));
      const result = await dismissProfileFields({
        admin,
        change,
        fields: new Set(proposedFields),
        userId,
        reviewedAt,
        dismissalMode: "unchecked_on_finish",
      });
      if (!result.dismissed) {
        profileReviewRedirect(formData, "An unchecked profile field could not be dismissed. Refresh before reviewing anything else.");
      }
      dismissedFields += proposedFields.length;
      continue;
    }
    const result = await approveContactFieldChange({
      admin,
      approvalSurface: "owner_profile_review",
      change,
      dismissRemainingFields: true,
      selectedFields: selected,
      userId,
      reviewedAt,
    });
    if (!result.approved) {
      profileReviewRedirect(formData, "A profile field could not be saved. Refresh before reviewing anything else.");
    }
    approvedFields += selected.size;
    dismissedFields += result.dismissedFields ?? 0;
  }

  revalidateReviewSurfaces(contactId);
  const appliedMessage = approvedFields > 0
    ? `Applied ${approvedFields} profile field${approvedFields === 1 ? "" : "s"}.`
    : "";
  const dismissedMessage = dismissedFields > 0
    ? ` Dismissed ${dismissedFields} unchecked field${dismissedFields === 1 ? "" : "s"}.`
    : "";
  profileReviewRedirect(formData, `${appliedMessage}${dismissedMessage}`.trim());
}

export async function dismissProfileField(formData: FormData) {
  const selection = dismissedProfileField(formData);
  if (!selection) profileReviewRedirect(formData, "That profile field is no longer available.");

  const { admin, change, userId } = await getReviewContext(selection.changeId);
  if (!isGroupableProfileChange(change)) {
    profileReviewRedirect(formData, "That recommendation is not part of a profile review.");
  }

  const proposed = fieldsPayload(change.payload);
  if (!(selection.field in proposed)) {
    profileReviewRedirect(formData, "That profile field changed after the page loaded. Refresh and review it again.");
  }

  const reviewedAt = new Date().toISOString();
  const result = await dismissProfileFields({
    admin,
    change,
    fields: new Set([selection.field]),
    userId,
    reviewedAt,
    dismissalMode: "individual_field",
  });
  if (!result.dismissed) {
    profileReviewRedirect(formData, "That profile field could not be dismissed. Refresh before reviewing anything else.");
  }

  revalidateReviewSurfaces(change.contact_id);
  const returnId = result.remainingFieldNames.length > 0
    ? change.id
    : selection.returnId;
  const fieldLabel = selection.field.replaceAll("_", " ");
  if (returnId) {
    profileReviewDetailRedirect(formData, returnId, `Dismissed ${fieldLabel}.`);
  }
  profileReviewRedirect(formData, `Dismissed ${fieldLabel}.`);
}

export async function correctProfileField(formData: FormData) {
  const selection = correctedProfileField(formData);
  if (!selection) {
    profileReviewRedirect(formData, "That profile field is no longer available.");
  }

  const correctedValue = normalizeOwnerCorrection(
    selection.field,
    formData.get("corrected_value"),
  );
  const correctionReason = shortText(formData, "correction_reason", 1200);
  if (correctedValue === undefined || !correctionReason) {
    profileReviewDetailRedirect(
      formData,
      selection.changeId,
      "Add the correct value and a short explanation before saving.",
    );
  }

  const { admin, change, userId } = await getReviewContext(selection.changeId);
  if (!isGroupableProfileChange(change) || !change.contact_id) {
    profileReviewRedirect(formData, "That recommendation is not part of a profile review.");
  }
  const proposed = fieldsPayload(change.payload);
  if (!(selection.field in proposed)) {
    profileReviewRedirect(
      formData,
      "That profile field changed after the page loaded. Refresh and review it again.",
    );
  }

  const contactUpdates = addStrengthOverride({
    [selection.field]: correctedValue,
  });
  const updateFields = Object.keys(contactUpdates);
  const { data: beforeContact } = await admin
    .from("contacts")
    .select(updateFields.join(", "))
    .eq("tenant_id", change.tenant_id)
    .eq("id", change.contact_id)
    .single();
  const { error: contactError } = await admin
    .from("contacts")
    .update(contactUpdates)
    .eq("tenant_id", change.tenant_id)
    .eq("id", change.contact_id);
  if (contactError) {
    profileReviewDetailRedirect(
      formData,
      selection.changeId,
      "The correction could not be saved. Nothing was dismissed.",
    );
  }

  const reviewedAt = new Date().toISOString();
  const result = await dismissProfileFields({
    admin,
    change,
    fields: new Set([selection.field]),
    userId,
    reviewedAt,
    dismissalMode: "individual_field",
  });
  if (!result.dismissed) {
    profileReviewDetailRedirect(
      formData,
      selection.changeId,
      "The correction was saved, but the old recommendation is still visible. Refresh before reviewing it again.",
    );
  }

  await admin.from("field_provenance").insert({
    tenant_id: change.tenant_id,
    table_name: "contacts",
    record_id: change.contact_id,
    field_name: selection.field,
    source_type: "manual",
    source_ref: "owner_profile_correction",
    summary: correctionReason,
    metadata: {
      pending_change_id: change.id,
      corrected_by: userId,
      proposed_value: proposed[selection.field],
    },
  });
  await admin.from("audit_log").insert({
    tenant_id: change.tenant_id,
    actor_user_id: userId,
    actor_type: "client",
    action: "pending_change.field_corrected",
    table_name: "pending_changes",
    record_id: change.id,
    before: {
      contact: beforeContact ?? {},
      proposed_value: proposed[selection.field],
    },
    after: {
      contact_id: change.contact_id,
      field: selection.field,
      corrected_value: correctedValue,
    },
    metadata: {
      correction_reason: correctionReason,
      source: change.source,
      post_approval_enrichment: "suppressed",
    },
  });

  if (contentSourceFields.has(selection.field)) {
    await syncAndStartContactContentDiscovery({
      admin,
      tenantId: change.tenant_id,
      contactId: change.contact_id,
      reason: "corrected_profile_source",
    });
  }

  revalidateReviewSurfaces(change.contact_id);
  const returnId = result.remainingFieldNames.length > 0
    ? change.id
    : selection.returnId;
  const fieldLabel = selection.field.replaceAll("_", " ");
  if (returnId) {
    profileReviewDetailRedirect(formData, returnId, `Corrected ${fieldLabel}.`);
  }
  profileReviewRedirect(formData, `Corrected ${fieldLabel}.`);
}

export async function approveVisibleLowRiskChanges(formData: FormData) {
  const changeIds = formData
    .getAll("ids")
    .map((value) => String(value))
    .filter(isValidUuid)
    .slice(0, 10);

  if (changeIds.length === 0) {
    reviewRedirect("No low-risk changes were selected.");
  }

  const { admin, supabase, userId } = await getReviewBase();
  const { data, error } = await supabase
    .from("pending_changes")
    .select(
      "id, tenant_id, contact_id, change_type, summary, payload, risk_level, source, replaces_pending_change_id, replaced_by_pending_change_id, superseded_at",
    )
    .eq("status", "pending")
    .in("id", changeIds);

  if (error || !data) {
    reviewRedirect("The selected changes are no longer available.");
  }

  const reviewedAt = new Date().toISOString();
  let approvedCount = 0;
  let skippedCount = 0;
  const contactIds = new Set<string>();

  for (const change of data as PendingChange[]) {
    if (!isBulkApprovable(change)) {
      skippedCount += 1;
      continue;
    }

    if (change.source === "recording_baseline") {
      const result = await reviewRecordingBaselineChange({
        admin,
        change,
        userId,
        decision: "approve",
      });
      if (result.ok) {
        approvedCount += 1;
        contactIds.add(result.contactId);
      } else {
        skippedCount += 1;
      }
      continue;
    }

    const result = await approveContactFieldChange({
      admin,
      approvalSurface: "bulk_low_risk",
      change,
      userId,
      reviewedAt,
    });

    if (result.approved) {
      approvedCount += 1;
      if (result.contactId) contactIds.add(result.contactId);
    } else {
      skippedCount += 1;
    }
  }

  for (const contactId of contactIds) {
    revalidateReviewSurfaces(contactId);
  }

  revalidateReviewSurfaces();
  reviewRedirect(
    `Approved ${approvedCount} low-risk change${
      approvedCount === 1 ? "" : "s"
    }.${skippedCount ? ` Skipped ${skippedCount} item${skippedCount === 1 ? "" : "s"} needing detailed review or valid fields.` : ""}`,
  );
}

export async function mergeNewContactProposal(formData: FormData) {
  const changeId = getChangeId(formData);
  if (!changeId) reviewRedirect("Invalid pending change.");

  const targetContactId = getTargetContactId(formData);
  if (!targetContactId) reviewRedirect("Choose the existing person to merge into.");
  if (String(formData.get("review_scope") ?? "") !== "detailed") {
    reviewRedirect("New people need duplicate review before they enter the Book.");
  }

  const { admin, change, userId } = await getReviewContext(changeId);
  const reviewedAt = new Date().toISOString();

  assertNotReplaced(change);

  if (!isNewPersonChangeType(change.change_type)) {
    reviewRedirect("Only new-person proposals can be merged into an existing contact.");
  }

  const proposedFields = normalizeNewContact(change.payload, change.change_type);
  const { full_name: proposedName, ...mergeUpdates } = proposedFields;

  if (Object.keys(mergeUpdates).length === 0) {
    reviewRedirect("No mergeable fields were found in that proposal.");
  }

  const { data: targetContact, error: targetError } = await admin
    .from("contacts")
    .select("id, full_name")
    .eq("tenant_id", change.tenant_id)
    .eq("id", targetContactId)
    .is("archived_at", null)
    .single();

  if (targetError || !targetContact) {
    reviewRedirect("That existing contact is no longer available.");
  }

  const { data: beforeContact } = await admin
    .from("contacts")
    .select(Object.keys(mergeUpdates).join(", "))
    .eq("tenant_id", change.tenant_id)
    .eq("id", targetContactId)
    .single();

  const { error: contactError } = await admin
    .from("contacts")
    .update(mergeUpdates)
    .eq("tenant_id", change.tenant_id)
    .eq("id", targetContactId);

  if (contactError) {
    reviewRedirect("The merge failed. Nothing was approved.");
  }

  const changeError = await markChangeApproved({
    admin,
    change,
    userId,
    reviewedAt,
  });

  if (changeError) {
    reviewRedirect("The contact was updated, but the merge review status could not be saved.");
  }

  await insertFieldProvenance({
    admin,
    tenantId: change.tenant_id,
    contactId: targetContactId,
    fields: mergeUpdates,
    change,
    userId,
  });

  const enrichmentJobId = await queuePostApprovalEnrichment({
    admin,
    tenantId: change.tenant_id,
    contactId: targetContactId,
    change,
    userId,
  });

  await markWantToKnowGraduated({
    admin,
    change,
    contactId: targetContactId,
    userId,
  });

  await admin.from("audit_log").insert({
    tenant_id: change.tenant_id,
    actor_user_id: userId,
    actor_type: "client",
    action: "pending_change.new_contact_merged",
    table_name: "pending_changes",
    record_id: change.id,
    before: beforeContact ?? {},
    after: {
      contact_id: targetContactId,
      contact_name: targetContact.full_name,
      proposed_new_contact_name: proposedName ?? null,
      fields: mergeUpdates,
    },
    metadata: {
      change_type: change.change_type,
      source: change.source,
      enrichment_job_id: enrichmentJobId,
      merge_target_contact_id: targetContactId,
    },
  });

  revalidateReviewSurfaces(targetContactId);
  reviewFormRedirect(formData, "Merged into the existing contact and queued enrichment follow-up.");
}

export async function dismissPendingChange(formData: FormData) {
  const changeId = getChangeId(formData);
  if (!changeId) reviewRedirect("Invalid pending change.");

  const { admin, change, userId } = await getReviewContext(changeId);
  const reviewedAt = new Date().toISOString();

  if (isOperatorRecordingAction(change)) {
    const result = await reviewOperatorRecordingAction({
      admin,
      change,
      userId,
      decision: "decline",
    });
    if (!result.ok) {
      reviewRedirect("This meeting action could not be declined. Nothing was changed.");
    }
    revalidateReviewSurfaces(result.contactId);
    reviewFormRedirect(formData, "Declined.");
  }

  if (change.source === "recording_baseline") {
    const result = await reviewRecordingBaselineChange({
      admin,
      change,
      userId,
      decision: "dismiss",
    });
    if (!result.ok) {
      reviewRedirect("This meeting change could not be declined. Nothing was changed.");
    }
    revalidateReviewSurfaces(result.contactId);
    reviewFormRedirect(formData, "Declined.");
  }

  const { error } = await admin
    .from("pending_changes")
    .update({
      status: "dismissed",
      reviewed_by: userId,
      reviewed_at: reviewedAt,
    })
    .eq("tenant_id", change.tenant_id)
    .eq("id", change.id);

  if (error) {
    reviewRedirect("The pending change could not be dismissed.");
  }

  await admin.from("audit_log").insert({
    tenant_id: change.tenant_id,
    actor_user_id: userId,
    actor_type: "client",
    action: "pending_change.dismissed",
    table_name: "pending_changes",
    record_id: change.id,
    before: {
      status: "pending",
    },
    after: {
      status: "dismissed",
    },
    metadata: {
      change_type: change.change_type,
      source: change.source,
    },
  });

  revalidateReviewSurfaces(change.contact_id);
  reviewFormRedirect(formData, "Dismissed.");
}

export async function markOwnerContextRequested(formData: FormData) {
  const changeIds = selectedChangeIds(formData);
  if (changeIds.length === 0) {
    reviewRedirect("Choose at least one proposal that needs owner context.");
  }

  const packet = shortText(formData, "verification_packet", 12000);
  const { admin, supabase, userId } = await getReviewBase();

  const { data, error } = await supabase
    .from("pending_changes")
    .select(
      "id, tenant_id, contact_id, change_type, summary, payload, risk_level, source, replaces_pending_change_id, replaced_by_pending_change_id, superseded_at",
    )
    .eq("status", "pending")
    .in("id", changeIds);

  if (error || !data) {
    reviewRedirect("Those proposals are no longer available.");
  }

  const requestedAt = new Date().toISOString();
  let requestedCount = 0;
  const contactIds = new Set<string>();

  for (const change of data as PendingChange[]) {
    if (isReplacedChange(change)) continue;

    const blockedFields = qualityCleanupBlockedFields(change.payload) ?? [];
    if (blockedFields.length === 0) continue;
    if (ownerContextStatus(change.payload) === "answered") continue;

    const updatedPayload = mergePayloadMetadata(change.payload, "owner_context", {
      status: "requested",
      requested_at: requestedAt,
      requested_by: userId,
      blocked_fields: blockedFields,
      verification_packet: packet,
    });

    const { error: updateError } = await admin
      .from("pending_changes")
      .update({ payload: updatedPayload })
      .eq("tenant_id", change.tenant_id)
      .eq("id", change.id)
      .eq("status", "pending");

    if (updateError) continue;

    requestedCount += 1;
    if (change.contact_id) contactIds.add(change.contact_id);

    await admin.from("audit_log").insert({
      tenant_id: change.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      action: "pending_change.owner_context_requested",
      table_name: "pending_changes",
      record_id: change.id,
      after: {
        status: "pending",
        owner_context: updatedPayload.owner_context,
      },
      metadata: {
        change_type: change.change_type,
        source: change.source,
        blocked_fields: blockedFields,
      },
    });
  }

  for (const contactId of contactIds) {
    revalidateReviewSurfaces(contactId);
  }

  revalidateReviewSurfaces();
  reviewRedirect(
    requestedCount > 0
      ? `Marked ${requestedCount} proposal${
          requestedCount === 1 ? "" : "s"
        } as waiting on owner context.`
      : "No proposals with owner-context blockers were selected.",
  );
}

export async function attachOwnerContextAnswer(formData: FormData) {
  const changeId = getChangeId(formData);
  if (!changeId) reviewRedirect("Invalid pending change.");

  const answer = shortText(formData, "owner_answer", 12000);
  if (!answer) {
    reviewDetailRedirect(changeId, "Add the owner answer before saving context.");
  }

  const { admin, change, userId } = await getReviewContext(changeId);
  assertNotReplaced(change);

  const answeredAt = new Date().toISOString();
  const blockedFields = qualityCleanupBlockedFields(change.payload) ?? [];
  const updatedPayload = mergePayloadMetadata(change.payload, "owner_context", {
    status: "answered",
    answered_at: answeredAt,
    answered_by: userId,
    answer,
    blocked_fields: blockedFields,
  });

  const { error } = await admin
    .from("pending_changes")
    .update({ payload: updatedPayload })
    .eq("tenant_id", change.tenant_id)
    .eq("id", change.id)
    .eq("status", "pending");

  if (error) {
    reviewDetailRedirect(change.id, "The owner context could not be saved.");
  }

  await admin.from("audit_log").insert({
    tenant_id: change.tenant_id,
    actor_user_id: userId,
    actor_type: "client",
    action: "pending_change.owner_context_answered",
    table_name: "pending_changes",
    record_id: change.id,
    after: {
      status: "pending",
      owner_context: updatedPayload.owner_context,
    },
    metadata: {
      change_type: change.change_type,
      source: change.source,
      blocked_fields: blockedFields,
    },
  });

  revalidateReviewSurfaces(change.contact_id);
  revalidatePath(`/changes/${change.id}`);
  reviewDetailRedirect(change.id, "Owner context attached. Review the proposal before approval.");
}

export async function queueOwnerContextRevisionJob(formData: FormData) {
  const changeId = getChangeId(formData);
  if (!changeId) reviewRedirect("Invalid pending change.");

  const { admin, change, userId } = await getReviewContext(changeId);
  assertNotReplaced(change);

  if (!change.contact_id) {
    reviewDetailRedirect(change.id, "Only contact-linked proposals can queue revision jobs.");
  }

  const ownerContext = metadataObject(change.payload, "owner_context");
  const ownerStatus = ownerContextStatus(change.payload);
  const ownerAnswer =
    typeof ownerContext.answer === "string" ? ownerContext.answer.trim() : "";
  const existingJobId =
    typeof ownerContext.revision_job_id === "string" &&
    isValidUuid(ownerContext.revision_job_id)
      ? ownerContext.revision_job_id
      : null;

  if (existingJobId) {
    reviewDetailRedirect(change.id, "A Claude revision job is already linked to this proposal.");
  }

  if (ownerStatus !== "answered" || !ownerAnswer) {
    reviewDetailRedirect(change.id, "Attach the owner answer before queuing a revision job.");
  }

  const { data: activeJobs } = await admin
    .from("jobs")
    .select("id, status, payload, created_at")
    .eq("tenant_id", change.tenant_id)
    .eq("job_type", "contact_enrichment")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(100);

  const activeRevisionJob = (((activeJobs ?? []) as Array<{
    id: string;
    status: string;
    payload: Record<string, unknown>;
  }>).find((job) => job.payload.source_pending_change_id === change.id) ?? null);

  if (activeRevisionJob) {
    const updatedPayload = mergePayloadMetadata(change.payload, "owner_context", {
      ...ownerContext,
      status: "revision_queued",
      revision_job_id: activeRevisionJob.id,
      revision_queued_at: new Date().toISOString(),
      revision_queued_by: userId,
    });

    await admin
      .from("pending_changes")
      .update({ payload: updatedPayload })
      .eq("tenant_id", change.tenant_id)
      .eq("id", change.id)
      .eq("status", "pending");

    revalidateReviewSurfaces(change.contact_id);
    revalidatePath(`/changes/${change.id}`);
    reviewDetailRedirect(change.id, "A Claude revision job is already linked to this proposal.");
  }

  const now = new Date().toISOString();
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({
      tenant_id: change.tenant_id,
      job_type: "contact_enrichment",
      status: "queued",
      payload: {
        contact_id: change.contact_id,
        trigger: "owner_context_revision",
        source: "pending_change_owner_context",
        source_pending_change_id: change.id,
        requested_by: userId,
        owner_context: {
          status: ownerStatus,
          answer: ownerAnswer,
          blocked_fields: ownerContext.blocked_fields ?? [],
          answered_at: ownerContext.answered_at ?? null,
        },
        original_pending_change: {
          id: change.id,
          change_type: change.change_type,
          summary: change.summary,
          risk_level: change.risk_level,
          source: change.source,
          payload: change.payload,
        },
        required_steps: [
          "review_owner_context_answer",
          "compare_against_original_proposal",
          "submit_revised_pending_change_or_no_change",
          "do_not_approve_original_proposal",
        ],
        revision_contract: {
          goal:
            "Create a cleaner replacement pending change when the owner answer resolves the blocker.",
          original_proposal_remains_pending: true,
          evidence_requirement:
            "Reference the owner answer in payload.evidence.verification_summary and include source_pending_change_id.",
        },
      },
      result: {
        queued_from_pending_change_id: change.id,
        queued_at: now,
      },
    })
    .select("id")
    .single();

  if (jobError || !job) {
    reviewDetailRedirect(change.id, "The Claude revision job could not be queued.");
  }

  const updatedPayload = mergePayloadMetadata(change.payload, "owner_context", {
    ...ownerContext,
    status: "revision_queued",
    revision_job_id: job.id,
    revision_queued_at: now,
    revision_queued_by: userId,
  });

  await admin
    .from("pending_changes")
    .update({ payload: updatedPayload })
    .eq("tenant_id", change.tenant_id)
    .eq("id", change.id)
    .eq("status", "pending");

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: change.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      action: "pending_change.owner_context_revision_queued",
      table_name: "pending_changes",
      record_id: change.id,
      after: {
        status: "pending",
        owner_context: updatedPayload.owner_context,
        job_id: job.id,
      },
      metadata: {
        change_type: change.change_type,
        source: change.source,
        contact_id: change.contact_id,
      },
    }),
    admin.from("usage_events").insert({
      tenant_id: change.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      event_type: "owner_context_revision_queued",
      quantity: 1,
      unit: "job",
      metadata: {
        contact_id: change.contact_id,
        pending_change_id: change.id,
        job_id: job.id,
      },
    }),
  ]);

  revalidateReviewSurfaces(change.contact_id);
  revalidatePath(`/changes/${change.id}`);
  reviewDetailRedirect(change.id, "Claude revision job queued from owner context.");
}

export async function requestEditPendingChange(formData: FormData) {
  const changeId = getChangeId(formData);
  if (!changeId) reviewRedirect("Invalid pending change.");

  const { admin, change, userId } = await getReviewContext(changeId);
  assertNotReplaced(change);

  const reviewedAt = new Date().toISOString();

  const { error } = await admin
    .from("pending_changes")
    .update({
      status: "edited",
      reviewed_by: userId,
      reviewed_at: reviewedAt,
    })
    .eq("tenant_id", change.tenant_id)
    .eq("id", change.id);

  if (error) {
    reviewRedirect("The pending change could not be marked for editing.");
  }

  await admin.from("audit_log").insert({
    tenant_id: change.tenant_id,
    actor_user_id: userId,
    actor_type: "client",
    action: "pending_change.edit_requested",
    table_name: "pending_changes",
    record_id: change.id,
    before: {
      status: "pending",
    },
    after: {
      status: "edited",
    },
    metadata: {
      change_type: change.change_type,
      source: change.source,
    },
  });

  revalidateReviewSurfaces(change.contact_id);
  reviewRedirect("Marked as needs edit.");
}
