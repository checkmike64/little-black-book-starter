import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TenantContext } from "@/lib/tenant-context";
import { isValidUuid } from "@/lib/uuid";

export type JobDetail = {
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
  updated_at: string;
};

export type ContactSummary = {
  id: string;
  full_name: string;
  company_name: string | null;
  email: string | null;
  one_line_summary: string | null;
};

export type AuditRow = {
  id: string;
  actor_type: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
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

export type PendingChangeRow = {
  id: string;
  idempotency_key: string | null;
  change_type: string;
  payload: Record<string, unknown>;
  summary: string;
  status: string;
  risk_level: string | null;
  source: string | null;
  created_at: string;
};

export type InteractionRow = {
  id: string;
  occurred_at: string;
  interaction_type: string;
  title: string | null;
  summary: string;
  source: string | null;
  created_at: string;
};

export type RelationshipActionRow = {
  id: string;
  title: string;
  action_type: string;
  status: string;
  priority: string;
  due_on: string | null;
  notes: string | null;
  created_at: string;
};

function uuidArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((item): item is string => typeof item === "string")),
  ).filter(isValidUuid);
}

export async function getJobDetail({
  id,
  context,
}: {
  id: string;
  context: TenantContext | null;
}) {
  if (!context || context.role !== "operator") {
    return {
      setupMode: false,
      job: null,
      contact: null,
      audit: [] as AuditRow[],
      usage: [] as UsageRow[],
      pendingChanges: [] as PendingChangeRow[],
      interactions: [] as InteractionRow[],
      commandActions: [] as RelationshipActionRow[],
    };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      setupMode: true,
      job: null,
      contact: null,
      audit: [] as AuditRow[],
      usage: [] as UsageRow[],
      pendingChanges: [] as PendingChangeRow[],
      interactions: [] as InteractionRow[],
      commandActions: [] as RelationshipActionRow[],
    };
  }

  const { data: job } = await admin
    .from("jobs")
    .select(
      "id, tenant_id, job_type, status, attempts, payload, result, run_after, locked_at, created_at, updated_at",
    )
    .eq("tenant_id", context.tenantId)
    .eq("id", id)
    .maybeSingle();

  const typedJob = (job as JobDetail | null) ?? null;
  if (!typedJob) {
    return {
      setupMode: false,
      job: null,
      contact: null,
      audit: [] as AuditRow[],
      usage: [] as UsageRow[],
      pendingChanges: [] as PendingChangeRow[],
      interactions: [] as InteractionRow[],
      commandActions: [] as RelationshipActionRow[],
    };
  }

  const contactId =
    typeof typedJob.payload.contact_id === "string" &&
    isValidUuid(typedJob.payload.contact_id)
      ? typedJob.payload.contact_id
      : null;
  const pendingChangeIds = uuidArray(typedJob.result.created_pending_change_ids);
  const interactionIds = uuidArray(typedJob.result.created_interaction_ids);

  const [
    contactResult,
    auditResult,
    pendingResult,
    interactionResult,
    commandActionsResult,
  ] = await Promise.all([
    contactId
      ? admin
          .from("contacts")
          .select("id, full_name, company_name, email, one_line_summary")
          .eq("tenant_id", context.tenantId)
          .eq("id", contactId)
          .maybeSingle()
      : { data: null },
    admin
      .from("audit_log")
      .select("id, actor_type, action, before, after, metadata, created_at")
      .eq("tenant_id", context.tenantId)
      .eq("record_id", typedJob.id)
      .order("created_at", { ascending: true })
      .limit(20),
    pendingChangeIds.length > 0
      ? admin
          .from("pending_changes")
          .select(
            "id, idempotency_key, change_type, payload, summary, status, risk_level, source, created_at",
          )
          .eq("tenant_id", context.tenantId)
          .in("id", pendingChangeIds)
          .order("created_at", { ascending: false })
      : { data: [] },
    interactionIds.length > 0
      ? admin
          .from("interactions")
          .select(
            "id, occurred_at, interaction_type, title, summary, source, created_at",
          )
          .eq("tenant_id", context.tenantId)
          .in("id", interactionIds)
          .order("occurred_at", { ascending: false })
      : { data: [] },
    admin
      .from("relationship_actions")
      .select("id, title, action_type, status, priority, due_on, notes, created_at")
      .eq("tenant_id", context.tenantId)
      .eq("metadata->>job_id", typedJob.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const pendingChanges =
    ((pendingResult.data ?? []) as unknown) as PendingChangeRow[];
  const pendingIdempotencyKeys = Array.from(
    new Set(
      pendingChanges
        .map((change) => change.idempotency_key)
        .filter((key): key is string => Boolean(key)),
    ),
  );

  const [usageByJobResult, usageByPendingKeyResult] = await Promise.all([
    admin
      .from("usage_events")
      .select("id, actor_type, event_type, quantity, unit, metadata, created_at")
      .eq("tenant_id", context.tenantId)
      .eq("metadata->>job_id", typedJob.id)
      .order("created_at", { ascending: true })
      .limit(20),
    pendingIdempotencyKeys.length > 0
      ? admin
          .from("usage_events")
          .select("id, actor_type, event_type, quantity, unit, metadata, created_at")
          .eq("tenant_id", context.tenantId)
          .in("metadata->>idempotency_key", pendingIdempotencyKeys)
          .order("created_at", { ascending: true })
          .limit(20)
      : { data: [] },
  ]);

  const usageById = new Map<string, UsageRow>();
  for (const event of [
    ...((((usageByJobResult.data ?? []) as unknown) as UsageRow[])),
    ...((((usageByPendingKeyResult.data ?? []) as unknown) as UsageRow[])),
  ]) {
    usageById.set(event.id, event);
  }

  const usage = Array.from(usageById.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  return {
    setupMode: false,
    job: typedJob,
    contact: (contactResult.data as ContactSummary | null) ?? null,
    audit: ((auditResult.data ?? []) as unknown) as AuditRow[],
    usage,
    pendingChanges,
    interactions: ((interactionResult.data ?? []) as unknown) as InteractionRow[],
    commandActions:
      ((commandActionsResult.data ?? []) as unknown) as RelationshipActionRow[],
  };
}
