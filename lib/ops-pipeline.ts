export type OpsPipelineJob = {
  id: string;
  tenant_id: string | null;
  job_type: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  run_after: string;
  created_at: string;
};

export type OpsPipelinePendingChange = {
  id: string;
  change_type: string;
  risk_level: string | null;
  source: string | null;
  created_at: string;
};

export type PipelineOrigin =
  | "manual_seed"
  | "manual_enrichment"
  | "quality_cleanup"
  | "approved_change"
  | "claude_project"
  | "test"
  | "other";

export function jobOrigin(job: OpsPipelineJob): PipelineOrigin {
  if (job.payload.test_mode === true) return "test";

  const trigger =
    typeof job.payload.trigger === "string" ? job.payload.trigger : "";
  const source = typeof job.payload.source === "string" ? job.payload.source : "";

  if (trigger === "manual_add") return "manual_seed";
  if (trigger === "manual_enrichment") return "manual_enrichment";
  if (trigger === "quality_cleanup") return "quality_cleanup";
  if (trigger === "approved_new_contact" || trigger === "approved_contact_enrichment") {
    return "approved_change";
  }
  if (source.includes("claude")) return "claude_project";
  return "other";
}

export function originLabel(origin: PipelineOrigin) {
  const labels = {
    manual_seed: "Manual seed",
    manual_enrichment: "Manual enrichment",
    quality_cleanup: "Quality cleanup",
    approved_change: "Approved change",
    claude_project: "Claude project",
    test: "Test loop",
    other: "Other",
  } satisfies Record<PipelineOrigin, string>;

  return labels[origin];
}

export function statusTone(status: string) {
  if (status === "running") return "hot";
  if (status === "queued") return "gold";
  if (status === "succeeded") return "cool";
  if (status === "failed") return "warn";
  return "";
}

export function jobBlockedOn(job: OpsPipelineJob) {
  const blockedOn = job.result.blocked_on;
  if (typeof blockedOn === "string" && blockedOn.trim()) {
    return blockedOn.replaceAll("_", " ");
  }

  const lastError = job.result.last_error;
  if (typeof lastError === "string" && lastError.trim()) {
    return "endpoint or retry error";
  }

  return job.status === "failed" ? "unclassified" : null;
}

export function pipelineStats({
  jobs,
  pendingChanges,
}: {
  jobs: OpsPipelineJob[];
  pendingChanges: OpsPipelinePendingChange[];
}) {
  const enrichmentJobs = jobs.filter((job) => job.job_type === "contact_enrichment");
  const productionJobs = enrichmentJobs.filter((job) => jobOrigin(job) !== "test");
  const activeProductionJobs = productionJobs.filter((job) =>
    ["queued", "running"].includes(job.status),
  );
  const blockedJobs = productionJobs.filter((job) => job.status === "failed");
  const pendingEnrichmentChanges = pendingChanges.filter((change) =>
    [
      "new_contact",
      "contact_enrichment",
      "field_update",
      "want_to_know_candidate",
    ].includes(
      change.change_type,
    ),
  );
  const highRiskPending = pendingEnrichmentChanges.filter(
    (change) => change.risk_level === "high",
  );

  const byOrigin = ([
    "manual_seed",
    "manual_enrichment",
    "quality_cleanup",
    "approved_change",
    "claude_project",
    "other",
  ] as PipelineOrigin[]).map((origin) => {
    const originJobs = productionJobs.filter((job) => jobOrigin(job) === origin);

    return {
      origin,
      label: originLabel(origin),
      total: originJobs.length,
      queued: originJobs.filter((job) => job.status === "queued").length,
      running: originJobs.filter((job) => job.status === "running").length,
      succeeded: originJobs.filter((job) => job.status === "succeeded").length,
      failed: originJobs.filter((job) => job.status === "failed").length,
    };
  });

  let nextAction = {
    label: "Pressure-test the import loop",
    detail:
      "Create or approve a small contact batch, then let Claude claim one enrichment job and return proposals.",
    href: "/claude-setup",
  };

  const runningJob = activeProductionJobs.find((job) => job.status === "running");
  const queuedJob = activeProductionJobs.find((job) => job.status === "queued");
  const blockedJob = blockedJobs[0];

  if (highRiskPending.length > 0) {
    nextAction = {
      label: "Review high-risk proposals",
      detail:
        "Clear trust, referral, private-note, and new-contact proposals before importing more volume.",
      href: "/changes",
    };
  } else if (runningJob) {
    nextAction = {
      label: "Complete the running handoff",
      detail:
        "Paste the Claude result back into the handoff page so the job closes with audit history.",
      href: `/ops/jobs/${runningJob.id}/handoff`,
    };
  } else if (queuedJob) {
    nextAction = {
      label: "Have Claude claim the next job",
      detail:
        "Use the Claude project endpoint flow to pull the next queued contact enrichment job.",
      href: "/claude-setup",
    };
  } else if (blockedJob) {
    nextAction = {
      label: "Resolve blocked enrichment",
      detail: `The latest blocked job is waiting on ${jobBlockedOn(blockedJob)}.`,
      href: `/ops/jobs/${blockedJob.id}`,
    };
  }

  return {
    activeProductionJobs,
    blockedJobs,
    byOrigin,
    highRiskPending,
    pendingEnrichmentChanges,
    productionJobs,
    nextAction,
  };
}
