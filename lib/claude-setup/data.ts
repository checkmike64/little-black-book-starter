import {
  buildClaudeImportReceipt,
  type ClaudeImportAuditRow,
  type ClaudeImportInteraction,
  type ClaudeImportJob,
  type ClaudeImportPendingChange,
  type ClaudeImportProvenanceRow,
} from "@/lib/claude-import-receipt";
import {
  buildIntakeRevisionHistory,
  type IntakeRevisionAuditRow,
} from "@/lib/intake-revisions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function getSetupRevisionRows({
  limit,
  tenantId,
}: {
  limit: number;
  tenantId: string | undefined;
}) {
  const supabase = await createSupabaseServerClient();
  if (!supabase || !tenantId) return [];

  const { data } = await supabase
    .from("audit_log")
    .select("id, actor_type, actor_user_id, action, before, after, created_at")
    .eq("tenant_id", tenantId)
    .in("action", ["tenant.intake.updated", "tenant.settings.updated"])
    .order("created_at", { ascending: false })
    .limit(limit);

  return buildIntakeRevisionHistory(
    ((data ?? []) as unknown) as IntakeRevisionAuditRow[],
  );
}

export async function getSetupRevisions(tenantId: string | undefined) {
  return getSetupRevisionRows({ tenantId, limit: 5 });
}

export async function getLatestSetupRevision(tenantId: string | undefined) {
  return (await getSetupRevisionRows({ tenantId, limit: 1 }))[0] ?? null;
}

export async function getClaudeImportReceipt(tenantId: string | undefined) {
  const supabase = await createSupabaseServerClient();
  if (!supabase || !tenantId) {
    return buildClaudeImportReceipt({
      jobs: [],
      pendingChanges: [],
      audit: [],
      provenance: [],
      interactions: [],
    });
  }

  const [jobs, pendingChanges, audit, provenance, interactions] =
    await Promise.all([
      supabase
        .from("jobs")
        .select("id, status, result, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("pending_changes")
        .select("id, status, change_type, risk_level, source, payload, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("audit_log")
        .select("actor_type, action, metadata, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("field_provenance")
        .select("field_name, source_type, source_ref, metadata, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("interactions")
        .select("id, source, source_ref, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  return buildClaudeImportReceipt({
    jobs: ((jobs.data ?? []) as unknown) as ClaudeImportJob[],
    pendingChanges:
      ((pendingChanges.data ?? []) as unknown) as ClaudeImportPendingChange[],
    audit: ((audit.data ?? []) as unknown) as ClaudeImportAuditRow[],
    provenance:
      ((provenance.data ?? []) as unknown) as ClaudeImportProvenanceRow[],
    interactions:
      ((interactions.data ?? []) as unknown) as ClaudeImportInteraction[],
  });
}
