import { contactFieldTypes } from "@/lib/contact-fields";
import { pendingChangeSupportedFieldNames } from "@/lib/pending-change-inspection";
import { isNewPersonChangeType } from "@/lib/pending-change-types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isValidUuid } from "@/lib/uuid";
import { getTenantContext } from "@/lib/tenant-context";
import {
  contactDuplicateInputFromPayload,
  findDuplicateCandidates,
  recommendedExistingContact,
  type ContactDuplicateRecord,
} from "@/lib/contact-duplicate-detection";
import { isGroupableProfileChange } from "@/lib/change-review-groups";
import { loadPendingChangeQueueRows } from "@/lib/pending-change-queue";

export type PendingChangeRow = {
  id: string;
  contact_id: string | null;
  contact?: (Record<string, unknown> & {
    id: string;
    full_name: string;
    company_name: string | null;
  }) | null;
  change_type: string;
  summary: string;
  payload: Record<string, unknown>;
  risk_level: string | null;
  source: string | null;
  created_at: string;
  replaces_pending_change_id: string | null;
  replaced_by_pending_change_id: string | null;
  superseded_at: string | null;
  resolved_existing_contact_id?: string | null;
};

export type PendingChangeDetail = {
  id: string;
  tenant_id: string;
  contact_id: string | null;
  change_type: string;
  summary: string;
  payload: Record<string, unknown>;
  risk_level: string | null;
  source: string | null;
  created_at: string;
  replaces_pending_change_id: string | null;
  replaced_by_pending_change_id: string | null;
  superseded_at: string | null;
};

export type ChangeContactOption = {
  id: string;
  full_name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  website: string | null;
  role_title: string[] | null;
  relationship_type: string[] | null;
  one_line_summary: string | null;
};

export type ChangeProvenanceRow = {
  field_name: string;
  source_type: string;
  source_ref: string | null;
  summary: string | null;
  confidence: number | null;
  created_at: string;
};

export type ChangeAuditRow = {
  id: string;
  actor_type: string;
  action: string;
  table_name: string | null;
  record_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

function payloadRecord(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function payloadUuid(payload: Record<string, unknown>, key: string, nestedKey: string) {
  const value = payloadRecord(payload, key)[nestedKey];
  return typeof value === "string" && isValidUuid(value) ? value : null;
}

export async function getPendingChanges() {
  const [supabase, tenantContext] = await Promise.all([
    createSupabaseServerClient(),
    getTenantContext(),
  ]);
  if (!supabase || !tenantContext) {
    return {
      rows: [] as PendingChangeRow[],
      setupMode: true,
      loadError: false,
    };
  }

  const rowsResult = await loadPendingChangeQueueRows(
    supabase,
    tenantContext.tenantId,
  );

  const baseRows = (rowsResult.data as PendingChangeRow[] | null) ?? [];
  if (rowsResult.error) {
    return {
      rows: [] as PendingChangeRow[],
      setupMode: false,
      loadError: true,
    };
  }
  const effectiveContactId = (row: PendingChangeRow) => {
    if (row.contact_id) return row.contact_id;
    const nestedId = row.payload.contact_id;
    return typeof nestedId === "string" && isValidUuid(nestedId) ? nestedId : null;
  };
  const contactIds = [...new Set(baseRows.map(effectiveContactId).filter(Boolean))];
  const hasNewPersonRows = baseRows.some((row) =>
    isNewPersonChangeType(row.change_type),
  );
  const contactsResult =
    hasNewPersonRows
      ? await supabase
          .from("contacts")
          .select(
            ["id", ...Object.keys(contactFieldTypes)].join(", "),
            { count: "exact" },
          )
          .eq("tenant_id", tenantContext.tenantId)
          .is("archived_at", null)
          .order("full_name", { ascending: true })
          .limit(2000)
      : contactIds.length > 0
      ? await supabase
          .from("contacts")
          .select(["id", ...Object.keys(contactFieldTypes)].join(", "))
          .eq("tenant_id", tenantContext.tenantId)
          .in("id", contactIds)
      : { data: [] };
  const identityContactRows = (contactsResult.data ?? []) as unknown as ContactDuplicateRecord[];
  const identityContactCount =
    "count" in contactsResult ? contactsResult.count : null;
  const identityContactsComplete = !hasNewPersonRows || (
    Number.isSafeInteger(identityContactCount)
    && identityContactCount === identityContactRows.length
  );
  const contactsById = new Map(
    ((contactsResult.data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>).map(
      (contact) => [contact.id, contact],
    ),
  );
  const rows = baseRows.map((row) => {
    const contactId = effectiveContactId(row);
    const recommendedDuplicate =
      identityContactsComplete && isNewPersonChangeType(row.change_type)
        ? recommendedExistingContact(
            findDuplicateCandidates(
              contactDuplicateInputFromPayload(row.payload),
              identityContactRows,
              { minimumScore: 30, limit: 8 },
            ),
          )
        : null;
    const recommendedContact = recommendedDuplicate?.contact.full_name
      ? recommendedDuplicate.contact as unknown as NonNullable<PendingChangeRow["contact"]>
      : null;
    const resolvedContactId = recommendedContact?.id ?? null;
    return {
      ...row,
      contact_id: contactId ?? resolvedContactId,
      resolved_existing_contact_id: resolvedContactId,
      contact:
        recommendedContact
        ?? (contactId
          ? contactsById.get(contactId) as PendingChangeRow["contact"] ?? null
          : null),
    };
  });

  return {
    rows,
    setupMode: false,
    loadError:
      ("error" in contactsResult && Boolean(contactsResult.error))
      || !identityContactsComplete,
  };
}

export async function getReviewDetail(id: string) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      change: null,
      relatedChanges: [] as PendingChangeDetail[],
      currentContact: null as Record<string, unknown> | null,
      contacts: [] as ChangeContactOption[],
      provenance: [] as ChangeProvenanceRow[],
      audit: [] as ChangeAuditRow[],
      setupMode: true,
      loadError: false,
    };
  }

  const changeResult = await supabase
    .from("pending_changes")
    .select(
      "id, tenant_id, contact_id, change_type, summary, payload, risk_level, source, created_at, replaces_pending_change_id, replaced_by_pending_change_id, superseded_at",
    )
    .eq("id", id)
    .eq("status", "pending")
    .maybeSingle();

  const change = (changeResult.data as PendingChangeDetail | null) ?? null;
  let relatedChanges = change ? [change] : [];
  let relatedChangesError = false;

  if (change && isGroupableProfileChange(change)) {
    const relatedResult = await supabase
      .from("pending_changes")
      .select(
        "id, tenant_id, contact_id, change_type, summary, payload, risk_level, source, created_at, replaces_pending_change_id, replaced_by_pending_change_id, superseded_at",
      )
      .eq("tenant_id", change.tenant_id)
      .eq("contact_id", change.contact_id)
      .eq("status", "pending")
      .in("change_type", ["field_update", "contact_enrichment"])
      .or("source.is.null,source.neq.recording_baseline")
      .is("replaced_by_pending_change_id", null)
      .is("superseded_at", null)
      .order("created_at", { ascending: true })
      .limit(50);

    relatedChangesError = Boolean(relatedResult.error);
    relatedChanges = relatedResult.error
      ? [change]
      : ((relatedResult.data as PendingChangeDetail[] | null) ?? [change]);
  }

  const supportedFields = [...new Set(
    relatedChanges.flatMap((row) => pendingChangeSupportedFieldNames(row)),
  )];

  const [currentContactResult, provenanceResult] =
    change?.contact_id
      ? await Promise.all([
          supabase
            .from("contacts")
            .select(["id", ...Object.keys(contactFieldTypes)].join(", "))
            .eq("tenant_id", change.tenant_id)
            .eq("id", change.contact_id)
            .is("archived_at", null)
            .maybeSingle(),
          supportedFields.length > 0
            ? supabase
                .from("field_provenance")
                .select("field_name, source_type, source_ref, summary, confidence, created_at")
                .eq("tenant_id", change.tenant_id)
                .eq("table_name", "contacts")
                .eq("record_id", change.contact_id)
                .in("field_name", supportedFields)
                .order("created_at", { ascending: false })
                .limit(20)
            : { data: [] },
        ])
      : [{ data: null }, { data: [] }];

  const contactsResult =
    change && isNewPersonChangeType(change.change_type)
      ? await supabase
          .from("contacts")
          .select(
            "id, full_name, company_name, email, phone, linkedin, website, role_title, relationship_type, one_line_summary",
            { count: "exact" },
          )
          .eq("tenant_id", change.tenant_id)
          .is("archived_at", null)
          .order("full_name", { ascending: true })
          .limit(2000)
      : { data: [] };
  const reviewContacts = (contactsResult.data as ChangeContactOption[] | null) ?? [];
  const reviewContactCount = "count" in contactsResult ? contactsResult.count : null;
  const reviewContactsComplete =
    !change
    || !isNewPersonChangeType(change.change_type)
    || (
      Number.isSafeInteger(reviewContactCount)
      && reviewContactCount === reviewContacts.length
    );

  const linkedChangeIds = change
    ? [
        change.id,
        change.replaced_by_pending_change_id,
        change.replaces_pending_change_id,
        payloadUuid(change.payload, "replacement", "replacement_pending_change_id"),
        payloadUuid(change.payload, "replacement", "replaces_pending_change_id"),
        payloadUuid(change.payload, "owner_context", "replacement_pending_change_id"),
      ].filter((value, index, values): value is string =>
        Boolean(value) && values.indexOf(value) === index,
      )
    : [];

  const auditResult =
    change && linkedChangeIds.length > 0
      ? await supabase
          .from("audit_log")
          .select("id, actor_type, action, table_name, record_id, before, after, metadata, created_at")
          .eq("tenant_id", change.tenant_id)
          .in("record_id", linkedChangeIds)
          .order("created_at", { ascending: false })
          .limit(30)
      : { data: [] };

  return {
    change,
    relatedChanges,
    currentContact:
      (currentContactResult.data as Record<string, unknown> | null) ?? null,
    contacts: reviewContacts,
    provenance:
      ((provenanceResult.data ?? []) as unknown) as ChangeProvenanceRow[],
    audit: ((auditResult.data ?? []) as unknown) as ChangeAuditRow[],
    setupMode: false,
    loadError:
      relatedChangesError
      || ("error" in contactsResult && Boolean(contactsResult.error))
      || !reviewContactsComplete,
  };
}
