import type {
  ProspectingBucketConfig,
  ProspectingBucketMap,
  ProspectingIntensity,
} from "./prospecting-buckets.js";

export type ProspectingStage =
  | "watching"
  | "researching"
  | "warming"
  | "ready"
  | "graduated";

export type ProspectingOpsCandidate = {
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
  last_touch: string | null;
  priority: number;
  action: string;
  intensity: ProspectingIntensity;
  staleDays: number | null;
};

export type ProspectingBucketHealthStatus =
  | "seed"
  | "research"
  | "warm"
  | "owner_decision"
  | "stale"
  | "steady";

export type ProspectingBucketHealth = {
  status: ProspectingBucketHealthStatus;
  label: string;
  tone: "hot" | "gold" | "cool";
  nextAction: string;
};

export type ProspectingBucketSetupStatus =
  | "configured"
  | "pending_review"
  | "needs_seed"
  | "needs_config";

export type ProspectingBucketSetupRow = {
  bucket: string;
  source: "client" | "default";
  status: ProspectingBucketSetupStatus;
  label: string;
  tone: "hot" | "gold" | "cool";
  activeCount: number;
  pendingProposalCount: number;
  goal: string;
  lookFor: string;
  action: string;
};

export const prospectingStages: ProspectingStage[] = [
  "watching",
  "warming",
  "ready",
  "graduated",
];

export function stageLabel(stage: ProspectingStage) {
  if (stage === "researching") return "Watching";
  if (stage === "ready") return "Add to Book";
  if (stage === "graduated") return "In the Book";
  return stage.replace(/^\w/, (letter) => letter.toUpperCase());
}

export function stageInstruction(stage: ProspectingStage) {
  if (stage === "watching" || stage === "researching") return "Watch and research until a real signal makes a useful touch possible.";
  if (stage === "warming") return "Find one useful, low-friction touch.";
  if (stage === "ready") return "Ask the owner if this should graduate.";
  return "Keep as history unless new context appears.";
}

export function configuredBucket(
  bucket: string | null,
  bucketMap: ProspectingBucketMap,
): ProspectingBucketConfig {
  return bucketMap[bucket ?? ""] ?? {
    name: bucket ?? "Uncategorized",
    goal: bucket
      ? `Clarify what this ${bucket} prospecting bucket is meant to accomplish.`
      : "Clarify why this person belongs on the outer ring.",
    look_for: bucket
      ? "Source-backed signals, mutual context, timing, fit, and a specific reason to engage."
      : "Relationship signal, mutual context, and a specific reason to engage.",
    intensity: "Low",
    lane: "",
  };
}

export function dossierValue(
  dossier: Record<string, unknown> | null,
  key: string,
) {
  const value = dossier?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function stageColumns(candidates: ProspectingOpsCandidate[]) {
  return prospectingStages.map((stage) => {
    const rows = candidates
      .filter((candidate) => candidate.stage === stage || (stage === "watching" && candidate.stage === "researching"))
      .sort((a, b) => b.priority - a.priority || a.full_name.localeCompare(b.full_name));

    return {
      stage,
      label: stageLabel(stage),
      instruction: stageInstruction(stage),
      rows,
    };
  });
}

export function nextStageOptions(stage: ProspectingStage) {
  if (stage === "watching" || stage === "researching") return ["warming", "ready"] as ProspectingStage[];
  if (stage === "warming") return ["ready", "watching"] as ProspectingStage[];
  if (stage === "ready") return ["warming", "graduated", "watching"] as ProspectingStage[];
  return ["ready", "warming"] as ProspectingStage[];
}

export function bucketOperatingRows(
  candidates: ProspectingOpsCandidate[],
  bucketMap: ProspectingBucketMap,
) {
  const buckets = Array.from(
    new Set([
      ...Object.keys(bucketMap),
      ...candidates
        .map((candidate) => candidate.bucket)
        .filter((bucket): bucket is string => Boolean(bucket)),
    ]),
  ).sort((a, b) => a.localeCompare(b));

  return buckets.map((bucket) => {
    const rows = candidates.filter((candidate) => candidate.bucket === bucket);
    const active = rows.filter((candidate) => candidate.stage !== "graduated");
    const watching = active.filter((candidate) => candidate.stage === "watching" || candidate.stage === "researching");
    const warming = active.filter((candidate) => candidate.stage === "warming");
    const ready = active.filter((candidate) => candidate.stage === "ready");
    const stale = active.filter(
      (candidate) => candidate.staleDays !== null && candidate.staleDays > 21,
    );
    const topCandidate = [...active].sort((a, b) => b.priority - a.priority)[0] ?? null;
    const config = configuredBucket(bucket, bucketMap);
    const health = bucketOperatingHealth({
      activeCount: active.length,
      readyCount: ready.length,
      staleCount: stale.length,
      warmingCount: warming.length,
    });
    const pressure =
      ready.length > 0
        ? "Owner decision"
        : warming.length > 0
          ? "Warm carefully"
          : active.length > 0
              ? "Watch"
              : "Seed";

    return {
      bucket,
      active,
      config,
      health,
      pressure,
      ready,
      watching,
      rows,
      stale,
      topCandidate,
      warming,
    };
  });
}

export type ProspectingBucketOperatingRow = ReturnType<
  typeof bucketOperatingRows
>[number];

export function buildProspectingBucketSetupRows({
  rows,
  customBucketNames,
  pendingProposalBuckets,
}: {
  rows: ProspectingBucketOperatingRow[];
  customBucketNames: string[];
  pendingProposalBuckets: string[];
}): ProspectingBucketSetupRow[] {
  const custom = new Set(customBucketNames);
  const pendingCounts = pendingProposalBuckets.reduce((counts, bucket) => {
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  return rows
    .map((row) => {
      const goal = row.config.goal.trim();
      const lookFor = row.config.look_for.trim();
      const pendingProposalCount = pendingCounts.get(row.bucket) ?? 0;
      const activeCount = row.active.length;
      const missingConfig = !goal || !lookFor;
      const source = custom.has(row.bucket) ? "client" : "default";
      const status: ProspectingBucketSetupStatus = missingConfig
        ? "needs_config"
        : pendingProposalCount > 0
          ? "pending_review"
          : activeCount > 0
            ? "configured"
            : "needs_seed";

      return {
        bucket: row.bucket,
        source,
        status,
        label:
          status === "needs_config"
            ? "Needs config"
            : status === "pending_review"
              ? "Pending review"
              : status === "configured"
                ? "Live"
                : "Seed",
        tone:
          status === "configured"
            ? "cool"
            : status === "pending_review"
              ? "gold"
              : "hot",
        activeCount,
        pendingProposalCount,
        goal: goal || "No bucket goal stored.",
        lookFor: lookFor || "No source criteria stored.",
        action:
          status === "needs_config"
            ? "Capture the bucket goal and source criteria before adding candidates."
            : status === "pending_review"
              ? "Review pending candidate proposals before adding more research volume."
              : status === "configured"
                ? row.health.nextAction
                : "Seed one verified candidate only if this bucket matches this Book's goal.",
      } satisfies ProspectingBucketSetupRow;
    })
    .sort(
      (a, b) =>
        Number(b.source === "client") - Number(a.source === "client") ||
        statusRank(a.status) - statusRank(b.status) ||
        a.bucket.localeCompare(b.bucket),
    );
}

function statusRank(status: ProspectingBucketSetupStatus) {
  if (status === "needs_config") return 1;
  if (status === "pending_review") return 2;
  if (status === "needs_seed") return 3;
  return 4;
}

export function bucketOperatingHealth({
  activeCount,
  readyCount,
  staleCount,
  warmingCount,
}: {
  activeCount: number;
  readyCount: number;
  staleCount: number;
  warmingCount: number;
}): ProspectingBucketHealth {
  if (readyCount > 0) {
    return {
      status: "owner_decision",
      label: "Owner decision",
      tone: "hot",
      nextAction: "Ask the owner whether ready candidates should graduate, pause, or stay warm.",
    };
  }

  if (staleCount > 0) {
    return {
      status: "stale",
      label: "Refresh needed",
      tone: "gold",
      nextAction: "Have Claude refresh stale candidates and either find a real signal or move them back to watching.",
    };
  }

  if (warmingCount > 0) {
    return {
      status: "warm",
      label: "Warm carefully",
      tone: "gold",
      nextAction: "Find one useful touch per warming candidate without forcing a pitch.",
    };
  }

  if (activeCount === 0) {
    return {
      status: "seed",
      label: "Seed",
      tone: "hot",
      nextAction: "Seed one or two verified candidates only if this bucket matches this Book's goal.",
    };
  }

  return {
    status: "steady",
    label: "Watching",
    tone: "cool",
    nextAction: "Keep watching and researching until a real signal makes a useful touch possible.",
  };
}

export function buildBucketOperatingPrompt({
  bucket,
  candidates,
  config,
}: {
  bucket: string;
  candidates: ProspectingOpsCandidate[];
  config: ProspectingBucketConfig;
}) {
  const active = candidates
    .filter((candidate) => candidate.stage !== "graduated")
    .slice(0, 10);
  const health = bucketOperatingHealth({
    activeCount: active.length,
    readyCount: active.filter((candidate) => candidate.stage === "ready").length,
    staleCount: active.filter(
      (candidate) => candidate.staleDays !== null && candidate.staleDays > 21,
    ).length,
    warmingCount: active.filter((candidate) => candidate.stage === "warming").length,
  });

  return [
    `Run the ${bucket} prospecting bucket for Little Black Book.`,
    "",
    `Goal: ${config.goal}`,
    `Look for: ${config.look_for}`,
    `Lane: ${config.lane || "purpose-specific"}`,
    `Intensity: ${config.intensity}`,
    `Current bucket health: ${health.label}`,
    `Next action: ${health.nextAction}`,
    "",
    "Current candidates:",
    ...(active.length
      ? active.map((candidate, index) => {
          const nextTouch =
            dossierValue(candidate.dossier, "next_touch") || candidate.action;
          return `${index + 1}. ${candidate.full_name}${candidate.company ? `, ${candidate.company}` : ""} - stage ${candidate.stage}; reason: ${candidate.why ?? "not stored"}; next touch: ${nextTouch}`;
        })
      : ["No active candidates are stored in this bucket yet."]),
    "",
    "Return:",
    "- who to research next",
    "- who to warm now",
    "- who should pause",
    "- who needs owner verification",
    "- no new candidates; the owner controls Want to Know membership",
    "",
    "Do not create Book contacts directly. Graduation must go through Changes.",
  ].join("\n");
}

export function buildCandidateResearchPacket({
  candidate,
  config,
}: {
  candidate: ProspectingOpsCandidate;
  config: ProspectingBucketConfig;
}) {
  return [
    `Research packet: ${candidate.full_name}`,
    "",
    `Bucket: ${candidate.bucket ?? config.name}`,
    `Lane: ${candidate.lane || config.lane || "purpose-specific"}`,
    `Stage: ${candidate.stage}`,
    `Company: ${candidate.company ?? "Unknown"}`,
    `Source: ${candidate.source ?? "Not stored"}`,
    `Why: ${candidate.why ?? "Not stored"}`,
    "",
    `Goal: ${dossierValue(candidate.dossier, "goal") || config.goal}`,
    `Look for: ${dossierValue(candidate.dossier, "look_for") || config.look_for}`,
    `Next touch: ${dossierValue(candidate.dossier, "next_touch") || candidate.action}`,
    "",
    "Claude task:",
    "1. Verify the person belongs in this bucket.",
    "2. Check source-backed relevance and obvious duplicates.",
    "3. Recommend one next action: watch, research, warm, ready, graduate, or dismiss.",
    "4. If a database write is needed, route it through pending changes unless it is a purely mechanical touch update.",
  ].join("\n");
}
