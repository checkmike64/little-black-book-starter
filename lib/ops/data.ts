import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TenantContext } from "@/lib/tenant-context";
import { buildDataLoadHealth } from "@/lib/data-load-health";
import {
  buildOverdueQueueObservation,
  overdueQueueCutoffAt,
} from "@/lib/ops/overdue-queue";
import {
  buildReviewQueueObservation,
  type ReviewQueueRow,
} from "@/lib/review-queue-observation";

export type AuditRow = {
  id: string;
  actor_type: string;
  action: string;
  table_name: string | null;
  record_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type UsageRow = {
  id: string;
  actor_type: string;
  event_type: string;
  quantity: number;
  unit: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type PendingRow = ReviewQueueRow & {
  summary: string;
};

export type AcceptanceChangeRow = {
  id: string;
  contact_id: string | null;
  change_type: string;
  status: string;
  risk_level: string | null;
  source: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type ProvenanceRow = {
  field_name: string;
  source_type: string;
  source_ref: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type JobRow = {
  id: string;
  tenant_id: string | null;
  job_type: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  run_after: string;
  locked_at: string | null;
  created_at: string;
  commandActionCount?: number;
};

export type ContactOption = {
  id: string;
  tenant_id: string | null;
  full_name: string;
  company_name: string | null;
  email: string | null;
};

type CommandActionLinkRow = {
  id: string;
  metadata: Record<string, unknown>;
};

export async function getOpsData(context: TenantContext | null) {
  if (!context || context.role !== "operator") {
    const loadHealth = buildDataLoadHealth("Operations", [
      {
        key: "operator-context",
        label: "operator context",
        error: "unauthorized",
        blocksSurface: true,
      },
    ]);
    return {
      setupMode: true,
      audit: [] as AuditRow[],
      usage: [] as UsageRow[],
      pending: [] as PendingRow[],
      jobs: [] as JobRow[],
      contacts: [] as ContactOption[],
      acceptanceChanges: [] as AcceptanceChangeRow[],
      provenance: [] as ProvenanceRow[],
      pendingCount: null,
      claudeWriteCount: 0,
      queuedJobCount: null,
      reviewQueue: buildReviewQueueObservation({
        rows: [],
        exactCount: null,
        error: "unauthorized",
      }),
      overdueQueue: buildOverdueQueueObservation({
        cutoffAt: overdueQueueCutoffAt(),
        totalDueCount: null,
        controlledTestDueCount: null,
        oldestProductionDue: null,
        totalCountError: "unavailable",
      }),
      loadHealth,
    };
  }

  // The operator allowlist can promote a stored owner to the effective operator
  // role. Only create the service client after that role is established, then
  // scope every read to the validated tenant instead of relying on stored-role
  // browser RLS.
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    const loadHealth = buildDataLoadHealth("Operations", [
      {
        key: "database",
        label: "private database",
        error: "unavailable",
        blocksSurface: true,
      },
    ]);
    return {
      setupMode: true,
      audit: [] as AuditRow[],
      usage: [] as UsageRow[],
      pending: [] as PendingRow[],
      jobs: [] as JobRow[],
      contacts: [] as ContactOption[],
      acceptanceChanges: [] as AcceptanceChangeRow[],
      provenance: [] as ProvenanceRow[],
      pendingCount: null,
      claudeWriteCount: 0,
      queuedJobCount: null,
      reviewQueue: buildReviewQueueObservation({
        rows: [],
        exactCount: null,
        error: "unavailable",
      }),
      overdueQueue: buildOverdueQueueObservation({
        cutoffAt: overdueQueueCutoffAt(),
        totalDueCount: null,
        controlledTestDueCount: null,
        oldestProductionDue: null,
        totalCountError: "unavailable",
      }),
      loadHealth,
    };
  }

  const tenantId = context.tenantId;

  // All overdue observations use one captured boundary so count and oldest-row
  // queries cannot disagree merely because the clock advanced between reads.
  const queueCutoffAt = overdueQueueCutoffAt();

  const [
    audit,
    usage,
    pending,
    jobs,
    contacts,
    acceptanceChanges,
    provenance,
    commandActionLinks,
    claudeWrites,
    queuedJobs,
    totalDueQueuedJobs,
    controlledTestDueQueuedJobs,
    oldestProductionDueJob,
  ] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, actor_type, action, table_name, record_id, metadata, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("usage_events")
      .select("id, actor_type, event_type, quantity, unit, metadata, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("pending_changes")
      .select(
        "id, contact_id, change_type, summary, payload, risk_level, source, created_at, replaces_pending_change_id, replaced_by_pending_change_id, superseded_at",
        { count: "exact" },
      )
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("jobs")
      .select(
        "id, tenant_id, job_type, status, attempts, payload, result, run_after, locked_at, created_at",
      )
      .eq("tenant_id", tenantId)
      .in("status", ["queued", "running", "succeeded", "failed"])
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("contacts")
      .select("id, tenant_id, full_name, company_name, email")
      .eq("tenant_id", tenantId)
      .is("archived_at", null)
      .order("full_name", { ascending: true })
      .limit(200),
    supabase
      .from("pending_changes")
      .select("id, contact_id, change_type, status, risk_level, source, reviewed_at, created_at")
      .eq("tenant_id", tenantId)
      .in("source", [
        "ops_enrichment_dry_run",
        "ops_acceptance_low_risk",
        "ops_prospecting_test",
      ])
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("field_provenance")
      .select("field_name, source_type, source_ref, metadata, created_at")
      .eq("tenant_id", tenantId)
      .eq("source_type", "claude")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("relationship_actions")
      .select("id, metadata")
      .eq("tenant_id", tenantId)
      .eq("source", "claude_command_output")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("actor_type", "claude"),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("status", ["queued", "running"]),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "queued")
      .lte("run_after", queueCutoffAt),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "queued")
      .lte("run_after", queueCutoffAt)
      .contains("payload", { test_mode: true }),
    supabase
      .from("jobs")
      .select("id, run_after")
      .eq("tenant_id", tenantId)
      .eq("status", "queued")
      .lte("run_after", queueCutoffAt)
      .not("payload", "cs", JSON.stringify({ test_mode: true }))
      .order("run_after", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const overdueQueue = buildOverdueQueueObservation({
    cutoffAt: queueCutoffAt,
    totalDueCount: totalDueQueuedJobs.count,
    controlledTestDueCount: controlledTestDueQueuedJobs.count,
    oldestProductionDue:
      (oldestProductionDueJob.data as {
        id: string;
        run_after: string;
      } | null) ?? null,
    totalCountError: totalDueQueuedJobs.error,
    controlledTestCountError: controlledTestDueQueuedJobs.error,
    oldestDueError: oldestProductionDueJob.error,
  });
  const pendingRows = ((pending.data ?? []) as unknown) as PendingRow[];
  const reviewQueue = buildReviewQueueObservation({
    rows: pendingRows,
    exactCount: pending.count,
    error: pending.error,
  });
  const loadHealth = buildDataLoadHealth("Operations", [
    { key: "audit", label: "audit activity", error: audit.error },
    { key: "usage", label: "usage activity", error: usage.error },
    { key: "pending", label: "pending reviews", error: pending.error },
    { key: "jobs", label: "recent jobs", error: jobs.error },
    { key: "contacts", label: "contacts", error: contacts.error },
    {
      key: "acceptance-changes",
      label: "acceptance changes",
      error: acceptanceChanges.error,
    },
    { key: "provenance", label: "field provenance", error: provenance.error },
    {
      key: "command-actions",
      label: "command actions",
      error: commandActionLinks.error,
    },
    {
      key: "review-queue",
      label: "review queue inventory",
      error: reviewQueue.state === "complete" ? null : reviewQueue.reason,
    },
    {
      key: "claude-write-count",
      label: "Claude write count",
      error: claudeWrites.error,
    },
    {
      key: "queued-job-count",
      label: "active job count",
      error: queuedJobs.error,
    },
    {
      key: "overdue-queue",
      label: "overdue queued-job observation",
      error: overdueQueue.state === "complete" ? null : overdueQueue.reason,
    },
  ]);

  const commandActionCountsByJobId = new Map<string, number>();
  (((commandActionLinks.data ?? []) as unknown) as CommandActionLinkRow[]).forEach(
    (action) => {
      const jobId = action.metadata.job_id;
      if (typeof jobId === "string") {
        commandActionCountsByJobId.set(
          jobId,
          (commandActionCountsByJobId.get(jobId) ?? 0) + 1,
        );
      }
    },
  );
  const enrichedJobs = (((jobs.data ?? []) as unknown) as JobRow[]).map((job) => ({
    ...job,
    commandActionCount: commandActionCountsByJobId.get(job.id) ?? 0,
  }));

  return {
    setupMode: false,
    audit: (audit.data ?? []) as AuditRow[],
    usage: ((usage.data ?? []) as unknown) as UsageRow[],
    pending: pendingRows,
    jobs: enrichedJobs,
    contacts: ((contacts.data ?? []) as unknown) as ContactOption[],
    acceptanceChanges:
      ((acceptanceChanges.data ?? []) as unknown) as AcceptanceChangeRow[],
    provenance: ((provenance.data ?? []) as unknown) as ProvenanceRow[],
    pendingCount: reviewQueue.totalCount,
    claudeWriteCount: claudeWrites.count ?? 0,
    queuedJobCount: queuedJobs.error ? null : (queuedJobs.count ?? null),
    reviewQueue,
    overdueQueue,
    loadHealth,
  };
}
