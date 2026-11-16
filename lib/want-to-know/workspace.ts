import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant-context";

export type WantToKnowProgramStatus = "active" | "paused" | "archived";
export type WantToKnowRelationshipStatus = WantToKnowProgramStatus;

export type WantToKnowProgram = {
  id: string;
  program_key: string;
  name: string;
  legacy_bucket_name: string | null;
  lane: string | null;
  goal: string | null;
  look_for: string | null;
  intensity: "Low" | "Medium" | "High";
  policy: Record<string, unknown>;
  status: WantToKnowProgramStatus;
  sort_order: number;
  provenance: Record<string, unknown>;
  paused_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WantToKnowWorkspaceCandidate = {
  id: string;
  program_id: string | null;
  full_name: string;
  email: string | null;
  company: string | null;
  linkedin: string | null;
  bucket: string | null;
  lane: string | null;
  stage: "watching" | "researching" | "warming" | "ready" | "graduated";
  relationship_status: WantToKnowRelationshipStatus;
  relationship_priority: "high" | "standard" | "watch";
  source: string | null;
  why: string | null;
  dossier: Record<string, unknown>;
  engagement_count: number;
  engagement_target_per_month: number | null;
  engagement_focus: string | null;
  last_touch: string | null;
  owner_selected_at: string;
  paused_at: string | null;
  archived_at: string | null;
  added_at: string;
  updated_at: string;
};

export type WantToKnowEvent = {
  id: string;
  program_id: string | null;
  event_type: string;
  is_touch: boolean;
  occurred_at: string;
  title: string | null;
  summary: string | null;
  channel: string | null;
  direction: "inbound" | "outbound" | "mutual" | "system" | null;
  source: string;
  source_ref: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
};

export type WantToKnowSignal = {
  id: string;
  signal_type: string;
  classification: string | null;
  summary: string;
  source: string | null;
  source_url: string | null;
  published_at: string | null;
  observed_at: string;
  recommended_action: string | null;
  why_now: string | null;
  priority_score: number;
  dismissed_at: string | null;
  engaged_at: string | null;
};

export type WantToKnowContentItem = {
  id: string;
  platform: string | null;
  content_type: string;
  source_url: string;
  title: string | null;
  content: string | null;
  classification: string | null;
  relevance: string | null;
  published_at: string;
  observed_at: string;
  status: "available" | "promoted" | "dismissed" | "expired";
  provider: string | null;
  match_status: "matched" | "unmatched" | "conflict" | "rejected";
};

export type WantToKnowCategoryWorkspace = {
  program: WantToKnowProgram | null;
  candidates: WantToKnowWorkspaceCandidate[];
  counts: {
    active: number;
    paused: number;
    archived: number;
    total: number;
  };
};

const programFields = [
  "id",
  "program_key",
  "name",
  "legacy_bucket_name",
  "lane",
  "goal",
  "look_for",
  "intensity",
  "policy",
  "status",
  "sort_order",
  "provenance",
  "paused_at",
  "archived_at",
  "created_at",
  "updated_at",
].join(", ");

const candidateFields = [
  "id",
  "program_id",
  "full_name",
  "email",
  "company",
  "linkedin",
  "bucket",
  "lane",
  "stage",
  "relationship_status",
  "relationship_priority",
  "source",
  "why",
  "dossier",
  "engagement_count",
  "engagement_target_per_month",
  "engagement_focus",
  "last_touch",
  "owner_selected_at",
  "paused_at",
  "archived_at",
  "added_at",
  "updated_at",
].join(", ");

function statusCounts(candidates: WantToKnowWorkspaceCandidate[]) {
  const active = candidates.filter((candidate) => candidate.relationship_status === "active").length;
  const paused = candidates.filter((candidate) => candidate.relationship_status === "paused").length;
  const archived = candidates.filter((candidate) => candidate.relationship_status === "archived").length;
  return { active, paused, archived, total: candidates.length };
}

export async function getWantToKnowCategoryWorkspace(options: {
  includeArchived?: boolean;
  programId?: string | null;
} = {}) {
  const [supabase, context] = await Promise.all([
    createSupabaseServerClient(),
    getTenantContext(),
  ]);

  if (!supabase || !context) {
    return {
      categories: [] as WantToKnowCategoryWorkspace[],
      count: 0,
      setupMode: true,
    };
  }

  let candidateQuery = supabase
    .from("want_to_know")
    .select(candidateFields)
    .eq("tenant_id", context.tenantId)
    .not("owner_selected_at", "is", null)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (!options.includeArchived) {
    candidateQuery = candidateQuery.neq("relationship_status", "archived");
  }
  if (options.programId) {
    candidateQuery = candidateQuery.eq("program_id", options.programId);
  }

  const [programResult, candidateResult] = await Promise.all([
    supabase
      .from("want_to_know_programs")
      .select(programFields)
      .eq("tenant_id", context.tenantId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    candidateQuery,
  ]);

  const programs = (programResult.data ?? []) as unknown as WantToKnowProgram[];
  const candidates = (candidateResult.data ?? []) as unknown as WantToKnowWorkspaceCandidate[];
  const visiblePrograms = options.programId
    ? programs.filter((program) => program.id === options.programId)
    : programs;
  const categories: WantToKnowCategoryWorkspace[] = visiblePrograms.map((program) => {
    const rows = candidates.filter((candidate) => candidate.program_id === program.id);
    return { program, candidates: rows, counts: statusCounts(rows) };
  });
  const unassigned = candidates.filter((candidate) => !candidate.program_id);

  if (unassigned.length > 0 && !options.programId) {
    categories.push({
      program: null,
      candidates: unassigned,
      counts: statusCounts(unassigned),
    });
  }

  return {
    categories,
    count: candidates.length,
    setupMode: false,
  };
}

export async function getWantToKnowCandidateDetail(id: string) {
  const [supabase, context] = await Promise.all([
    createSupabaseServerClient(),
    getTenantContext(),
  ]);
  if (!supabase || !context) return null;

  const { data: candidateData, error: candidateError } = await supabase
    .from("want_to_know")
    .select(candidateFields)
    .eq("tenant_id", context.tenantId)
    .eq("id", id)
    .not("owner_selected_at", "is", null)
    .maybeSingle();

  if (candidateError || !candidateData) return null;
  const candidate = candidateData as unknown as WantToKnowWorkspaceCandidate;

  const [programResult, signalResult, contentResult, eventResult] = await Promise.all([
    candidate.program_id
      ? supabase
          .from("want_to_know_programs")
          .select(programFields)
          .eq("tenant_id", context.tenantId)
          .eq("id", candidate.program_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("signals")
      .select(
        "id, signal_type, classification, summary, source, source_url, published_at, observed_at, recommended_action, why_now, priority_score, dismissed_at, engaged_at",
      )
      .eq("tenant_id", context.tenantId)
      .eq("want_to_know_id", candidate.id)
      .order("observed_at", { ascending: false })
      .limit(50),
    supabase
      .from("content_items")
      .select(
        "id, platform, content_type, source_url, title, content, classification, relevance, published_at, observed_at, status, provider, match_status",
      )
      .eq("tenant_id", context.tenantId)
      .eq("want_to_know_id", candidate.id)
      .order("published_at", { ascending: false })
      .limit(50),
    supabase
      .from("want_to_know_events")
      .select(
        "id, program_id, event_type, is_touch, occurred_at, title, summary, channel, direction, source, source_ref, metadata, created_by, created_at",
      )
      .eq("tenant_id", context.tenantId)
      .eq("want_to_know_id", candidate.id)
      .order("occurred_at", { ascending: false })
      .limit(100),
  ]);

  const signals = (signalResult.data ?? []) as unknown as WantToKnowSignal[];
  const content = (contentResult.data ?? []) as unknown as WantToKnowContentItem[];
  const events = (eventResult.data ?? []) as unknown as WantToKnowEvent[];

  return {
    candidate,
    program: (programResult.data as unknown as WantToKnowProgram | null) ?? null,
    signals,
    content,
    events,
    evidenceCounts: {
      signals: signals.length,
      content: content.length,
      events: events.length,
      touches: events.filter((event) => event.is_touch).length,
    },
  };
}
