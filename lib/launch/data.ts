import { hasAskRunDecision } from "@/lib/ask-run-decision";
import { qualityStats, type QualityContact } from "@/lib/data-quality";
import { launchRehearsalSource } from "@/lib/launch-rehearsal-evidence";
import {
  buildReviewQueueObservation,
  type ReviewQueueRow,
} from "@/lib/review-queue-observation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/tenant-context";

export type ContactOption = QualityContact & {
  tenant_id: string | null;
  email: string | null;
};

export type LaunchJobRow = {
  id: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  created_at?: string;
};

export type LaunchPendingChangeRow = {
  id: string;
  contact_id: string | null;
  change_type: string;
  status: string;
  risk_level: string | null;
  source: string | null;
  reviewed_at: string | null;
  created_at: string;
  payload?: Record<string, unknown>;
  replaces_pending_change_id?: string | null;
  replaced_by_pending_change_id?: string | null;
  superseded_at?: string | null;
};

export type LaunchAuditRow = {
  action: string;
  actor_type: string;
  table_name: string | null;
  record_id: string | null;
  metadata: Record<string, unknown>;
};

export type LaunchProvenanceRow = {
  field_name: string;
  source_type: string;
  source_ref: string | null;
  metadata: Record<string, unknown>;
};

export type LaunchRelationshipActionRow = {
  id: string;
  contact_id?: string | null;
  title?: string;
  status: string;
  source: string | null;
  metadata: Record<string, unknown> | null;
  created_at?: string;
  completed_at?: string | null;
};

type AskRunRow = {
  id: string;
  answer: Record<string, unknown> | null;
};

const launchContactSelect =
  "id, tenant_id, full_name, email, company_name, role_title, trust_level, relationship_strength, relationship_type, last_spoke, how_we_met, why_stay_in_touch, current_asks, wants_help_with, ideal_referral, podcast_fit, recent_activity, private_notes";

const previewContactSelect =
  "id, full_name, company_name, role_title, trust_level, relationship_strength, relationship_type, last_spoke, how_we_met, why_stay_in_touch, current_asks, wants_help_with, ideal_referral, podcast_fit, recent_activity, private_notes";

function unavailableReviewQueue(reason: string) {
  return buildReviewQueueObservation({
    rows: [],
    exactCount: null,
    error: reason,
  });
}

export async function getLaunchData(context: TenantContext | null) {
  if (!context || context.role !== "operator") {
    return {
      context,
      contacts: [] as ContactOption[],
      contactCount: 0,
      jobs: [] as LaunchJobRow[],
      changes: [] as LaunchPendingChangeRow[],
      pendingReviewCount: 0,
      reviewQueue: unavailableReviewQueue("unauthorized"),
      audit: [] as LaunchAuditRow[],
      provenance: [] as LaunchProvenanceRow[],
      rehearsalActions: [] as LaunchRelationshipActionRow[],
      relationshipActionCount: 0,
      wantToKnowCount: 0,
      askRunCount: 0,
      askRunUndecidedCount: 0,
    };
  }

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const tenantId = context.tenantId;

  if (!supabase || !admin) {
    return {
      context,
      contacts: [] as ContactOption[],
      contactCount: 0,
      jobs: [] as LaunchJobRow[],
      changes: [] as LaunchPendingChangeRow[],
      pendingReviewCount: 0,
      reviewQueue: unavailableReviewQueue("unavailable"),
      audit: [] as LaunchAuditRow[],
      provenance: [] as LaunchProvenanceRow[],
      rehearsalActions: [] as LaunchRelationshipActionRow[],
      relationshipActionCount: 0,
      wantToKnowCount: 0,
      askRunCount: 0,
      askRunUndecidedCount: 0,
    };
  }

  const [
    contacts,
    contactCount,
    jobs,
    changes,
    reviewQueueRows,
    audit,
    provenance,
    rehearsalActions,
    relationshipActionCount,
    wantToKnowCount,
    askRuns,
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select(launchContactSelect)
      .eq("tenant_id", tenantId)
      .is("archived_at", null)
      .order("full_name", { ascending: true })
      .limit(1000),
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .is("archived_at", null),
    admin
      .from("jobs")
      .select("id, status, attempts, payload, result, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("pending_changes")
      .select(
        "id, contact_id, change_type, status, risk_level, source, reviewed_at, created_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("pending_changes")
      .select(
        "id, contact_id, change_type, payload, risk_level, source, created_at, replaces_pending_change_id, replaced_by_pending_change_id, superseded_at",
        { count: "exact" },
      )
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("audit_log")
      .select("action, actor_type, table_name, record_id, metadata")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("field_provenance")
      .select("field_name, source_type, source_ref, metadata")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("relationship_actions")
      .select("id, contact_id, title, status, source, metadata, created_at, completed_at")
      .eq("tenant_id", tenantId)
      .eq("source", launchRehearsalSource)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("relationship_actions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    supabase
      .from("want_to_know")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    supabase
      .from("ask_runs")
      .select("id, answer", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const askRunRows = ((askRuns.data ?? []) as unknown) as AskRunRow[];
  const reviewQueue = buildReviewQueueObservation({
    rows: ((reviewQueueRows.data ?? []) as unknown) as ReviewQueueRow[],
    exactCount: reviewQueueRows.count,
    error: reviewQueueRows.error,
  });

  return {
    context,
    contacts: ((contacts.data ?? []) as unknown) as ContactOption[],
    contactCount: contactCount.count ?? contacts.data?.length ?? 0,
    jobs: ((jobs.data ?? []) as unknown) as LaunchJobRow[],
    changes: ((changes.data ?? []) as unknown) as LaunchPendingChangeRow[],
    pendingReviewCount: reviewQueue.actionableCount ?? 0,
    reviewQueue,
    audit: ((audit.data ?? []) as unknown) as LaunchAuditRow[],
    provenance: ((provenance.data ?? []) as unknown) as LaunchProvenanceRow[],
    rehearsalActions:
      ((rehearsalActions.data ?? []) as unknown) as LaunchRelationshipActionRow[],
    relationshipActionCount: relationshipActionCount.count ?? 0,
    wantToKnowCount: wantToKnowCount.count ?? 0,
    askRunCount: askRuns.count ?? 0,
    askRunUndecidedCount: askRunRows.filter((run) => !hasAskRunDecision(run.answer))
      .length,
  };
}

export async function getPreviewData(context: TenantContext | null) {
  if (!context || context.role !== "operator") {
    return {
      context,
      contacts: 0,
      qualityAverage: 0,
      weakRecordCount: 0,
      highValueWeakCount: 0,
      pendingReview: 0,
      reviewQueue: unavailableReviewQueue("unauthorized"),
      openActions: 0,
      openPromises: 0,
      jobs: [] as LaunchJobRow[],
      changes: [] as LaunchPendingChangeRow[],
      audit: [] as LaunchAuditRow[],
      provenance: [] as LaunchProvenanceRow[],
      askRunCount: 0,
      askRunUndecidedCount: 0,
      relationshipActionCount: 0,
      wantToKnowCount: 0,
      rehearsalActions: [] as LaunchRelationshipActionRow[],
    };
  }

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  if (!supabase || !admin) {
    return {
      context,
      contacts: 0,
      qualityAverage: 0,
      weakRecordCount: 0,
      highValueWeakCount: 0,
      pendingReview: 0,
      reviewQueue: unavailableReviewQueue("unavailable"),
      openActions: 0,
      openPromises: 0,
      jobs: [] as LaunchJobRow[],
      changes: [] as LaunchPendingChangeRow[],
      audit: [] as LaunchAuditRow[],
      provenance: [] as LaunchProvenanceRow[],
      askRunCount: 0,
      askRunUndecidedCount: 0,
      relationshipActionCount: 0,
      wantToKnowCount: 0,
      rehearsalActions: [] as LaunchRelationshipActionRow[],
    };
  }

  const tenantId = context.tenantId;
  const [
    contacts,
    contactCount,
    pendingReviewRows,
    openActions,
    openPromises,
    jobs,
    changes,
    audit,
    provenance,
    askRuns,
    relationshipActionCount,
    wantToKnowCount,
    rehearsalActions,
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select(previewContactSelect)
      .eq("tenant_id", tenantId)
      .is("archived_at", null)
      .order("full_name", { ascending: true })
      .limit(1000),
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .is("archived_at", null),
    admin
      .from("pending_changes")
      .select(
        "id, contact_id, change_type, payload, risk_level, source, created_at, replaces_pending_change_id, replaced_by_pending_change_id, superseded_at",
        { count: "exact" },
      )
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("relationship_actions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "open"),
    supabase
      .from("promises")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "open"),
    admin
      .from("jobs")
      .select("id, status, attempts, payload, result")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("pending_changes")
      .select(
        "id, status, change_type, risk_level, source, contact_id, reviewed_at, created_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("audit_log")
      .select("action, actor_type, table_name, record_id, metadata")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("field_provenance")
      .select("field_name, source_type, source_ref, metadata")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("ask_runs")
      .select("id, answer", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("relationship_actions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    supabase
      .from("want_to_know")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
    supabase
      .from("relationship_actions")
      .select("id, status, source, metadata")
      .eq("tenant_id", tenantId)
      .eq("source", launchRehearsalSource)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const askRows = ((askRuns.data ?? []) as unknown) as AskRunRow[];
  const contactRows = ((contacts.data ?? []) as unknown) as QualityContact[];
  const quality = qualityStats(contactRows);
  const reviewQueue = buildReviewQueueObservation({
    rows: ((pendingReviewRows.data ?? []) as unknown) as ReviewQueueRow[],
    exactCount: pendingReviewRows.count,
    error: pendingReviewRows.error,
  });

  return {
    context,
    contacts: contactCount.count ?? contactRows.length,
    qualityAverage: quality.average,
    weakRecordCount: quality.weak,
    highValueWeakCount: quality.highValueWeak,
    pendingReview: reviewQueue.actionableCount ?? 0,
    reviewQueue,
    openActions: openActions.count ?? 0,
    openPromises: openPromises.count ?? 0,
    jobs: ((jobs.data ?? []) as unknown) as LaunchJobRow[],
    changes: ((changes.data ?? []) as unknown) as LaunchPendingChangeRow[],
    audit: ((audit.data ?? []) as unknown) as LaunchAuditRow[],
    provenance: ((provenance.data ?? []) as unknown) as LaunchProvenanceRow[],
    askRunCount: askRuns.count ?? askRows.length,
    askRunUndecidedCount: askRows.filter((run) => !hasAskRunDecision(run.answer))
      .length,
    relationshipActionCount: relationshipActionCount.count ?? 0,
    wantToKnowCount: wantToKnowCount.count ?? 0,
    rehearsalActions:
      ((rehearsalActions.data ?? []) as unknown) as LaunchRelationshipActionRow[],
  };
}
