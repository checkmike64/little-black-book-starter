import { type QualityContact } from "@/lib/data-quality";
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

export type JobRow = {
  id: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
};

export type PendingChangeRow = {
  id: string;
  contact_id: string | null;
  change_type: string;
  status: string;
  risk_level: string | null;
  source: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type AuditRow = {
  action: string;
  actor_type: string;
  table_name: string | null;
  record_id: string | null;
  metadata: Record<string, unknown>;
};

export type ProvenanceRow = {
  field_name: string;
  source_type: string;
  source_ref: string | null;
  metadata: Record<string, unknown>;
};

export type RelationshipActionRow = {
  id: string;
  status: string;
  source: string | null;
  metadata: Record<string, unknown> | null;
};

export type AskRunRow = {
  id: string;
  answer: Record<string, unknown> | null;
};

const contactSelect =
  "id, tenant_id, full_name, email, company_name, role_title, trust_level, relationship_strength, relationship_type, last_spoke, how_we_met, why_stay_in_touch, current_asks, wants_help_with, ideal_referral, podcast_fit, recent_activity, private_notes";

export async function getOwnerHandoffExportData(context: TenantContext | null) {
  if (!context || context.role !== "operator") return null;

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return null;
  const tenantId = context.tenantId;

  const [
    contacts,
    contactCount,
    jobs,
    changes,
    pendingReviewRows,
    audit,
    provenance,
    rehearsalActions,
    relationshipActionCount,
    openActionCount,
    openPromiseCount,
    wantToKnowCount,
    askRuns,
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select(contactSelect)
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
      .select("id, status, attempts, payload, result")
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
      .select("id, status, source, metadata")
      .eq("tenant_id", tenantId)
      .eq("source", launchRehearsalSource)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("relationship_actions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId),
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

  const contactRows = ((contacts.data ?? []) as unknown) as ContactOption[];
  const askRunRows = ((askRuns.data ?? []) as unknown) as AskRunRow[];
  const reviewQueue = buildReviewQueueObservation({
    rows: ((pendingReviewRows.data ?? []) as unknown) as ReviewQueueRow[],
    exactCount: pendingReviewRows.count,
    error: pendingReviewRows.error,
  });

  return {
    askRunCount: askRuns.count ?? askRunRows.length,
    askRunRows,
    auditRows: ((audit.data ?? []) as unknown) as AuditRow[],
    changeRows: ((changes.data ?? []) as unknown) as PendingChangeRow[],
    contactCount: contactCount.count ?? contactRows.length,
    contactRows,
    jobRows: ((jobs.data ?? []) as unknown) as JobRow[],
    openActionCount: openActionCount.count ?? 0,
    openPromiseCount: openPromiseCount.count ?? 0,
    pendingReviewCount: reviewQueue.actionableCount ?? 0,
    reviewQueue,
    provenanceRows: ((provenance.data ?? []) as unknown) as ProvenanceRow[],
    rehearsalRows:
      ((rehearsalActions.data ?? []) as unknown) as RelationshipActionRow[],
    relationshipActionCount: relationshipActionCount.count ?? 0,
    wantToKnowCount: wantToKnowCount.count ?? 0,
  };
}
