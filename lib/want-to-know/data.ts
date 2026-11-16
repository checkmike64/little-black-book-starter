import {
  type ProspectingBucketConfig,
  type ProspectingBucketMap,
} from "@/lib/prospecting-buckets";
import {
  configuredBucket,
  type ProspectingOpsCandidate,
  type ProspectingStage,
} from "@/lib/prospecting-ops";
import { pendingChangePayloadBody } from "@/lib/pending-change-inspection";
import { sampleWantToKnow } from "@/lib/sample-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type WantToKnowRow = {
  id: string;
  full_name: string;
  bucket: string | null;
  lane: string | null;
  stage: ProspectingStage;
  company: string | null;
  source: string | null;
  why: string | null;
  linkedin: string | null;
  dossier: Record<string, unknown> | null;
  engagement_count: number | null;
  engagement_target_per_month: number | null;
  engagement_focus: string | null;
  relationship_priority: "high" | "standard" | "watch";
  owner_selected_at: string;
  last_touch: string | null;
  added_at: string;
};

export type Candidate = WantToKnowRow & ProspectingOpsCandidate;

type PendingProspectingChangeRow = {
  id: string;
  change_type: string;
  summary: string;
  payload: Record<string, unknown>;
  risk_level: string | null;
  source: string | null;
  created_at: string;
};

export type PendingProspectingProposal = PendingProspectingChangeRow & {
  candidate: Record<string, unknown>;
  bucket: string;
  fullName: string;
};

const stageOrder: Record<ProspectingStage, number> = {
  watching: 1,
  researching: 1,
  warming: 3,
  ready: 4,
  graduated: 5,
};

function daysSince(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 1000 / 60 / 60 / 24));
}

function cleanString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function pendingProposalCandidate(row: PendingProspectingChangeRow) {
  return pendingChangePayloadBody({
    change_type: row.change_type,
    payload: row.payload,
    risk_level: row.risk_level,
  });
}

function pendingProposalDisplay(row: PendingProspectingChangeRow): PendingProspectingProposal {
  const candidate = pendingProposalCandidate(row);
  const bucket = cleanString(candidate.bucket, "Uncategorized");
  const fullName =
    cleanString(candidate.full_name) ||
    cleanString(candidate.name) ||
    "Unnamed candidate";

  return {
    ...row,
    bucket,
    candidate,
    fullName,
  };
}

export function bucketConfig(
  bucket: string | null,
  bucketMap: ProspectingBucketMap,
): ProspectingBucketConfig {
  return configuredBucket(bucket, bucketMap);
}

function candidatePriority(
  row: WantToKnowRow,
  bucketMap: ProspectingBucketMap,
): Candidate {
  const staleDays = daysSince(row.last_touch);
  const config = bucketConfig(row.bucket, bucketMap);
  let priority = stageOrder[row.stage] * 20;

  if (row.relationship_priority === "high") priority += 40;
  if (row.relationship_priority === "watch") priority -= 12;

  if (row.stage === "ready") priority += 30;
  if (row.stage === "warming") priority += 18;
  if (row.lane === "client") priority += 10;
  if ((row.engagement_count ?? 0) >= 3) priority += 8;
  if (staleDays !== null && staleDays > 14 && row.stage !== "graduated") {
    priority += 8;
  }
  if (row.why) priority += 4;

  const action =
    row.stage === "ready"
      ? "Ask the owner to verify whether this person should graduate into the book."
      : row.stage === "warming"
        ? "Have Claude find the next useful touch and keep the outreach light."
        : row.stage === "graduated"
            ? "Keep out of the warming queue unless new context appears."
            : "Watch and research until a clear signal makes a useful touch possible.";

  return {
    ...row,
    priority,
    action,
    intensity: config.intensity,
    staleDays,
  };
}

export async function getWantToKnow(bucketMap: ProspectingBucketMap) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    const candidates = (sampleWantToKnow as unknown as WantToKnowRow[])
      .map((row) => candidatePriority(row, bucketMap))
      .sort((a, b) => b.priority - a.priority);

    return { candidates, count: candidates.length, setupMode: true };
  }

  const { data, count } = await supabase
    .from("want_to_know")
    .select(
      "id, full_name, bucket, lane, stage, company, source, why, linkedin, dossier, engagement_count, engagement_target_per_month, engagement_focus, relationship_priority, owner_selected_at, last_touch, added_at",
      { count: "exact" },
    )
    .not("owner_selected_at", "is", null)
    .order("updated_at", { ascending: false })
    .limit(200);

  const candidates = (((data ?? []) as unknown) as WantToKnowRow[])
    .map((row) => candidatePriority(row, bucketMap))
    .sort((a, b) => b.priority - a.priority || a.full_name.localeCompare(b.full_name));

  return {
    candidates,
    count: count ?? candidates.length,
    setupMode: false,
  };
}

export async function getPendingProspectingProposals() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return [] as PendingProspectingProposal[];
  }

  const { data } = await supabase
    .from("pending_changes")
    .select("id, change_type, summary, payload, risk_level, source, created_at")
    .eq("status", "pending")
    .eq("change_type", "want_to_know_candidate")
    .order("created_at", { ascending: false })
    .limit(20);

  return (((data ?? []) as unknown) as PendingProspectingChangeRow[]).map(
    pendingProposalDisplay,
  );
}
