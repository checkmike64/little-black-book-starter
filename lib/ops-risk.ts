import type { OverdueQueueObservation } from "./ops/overdue-queue.js";

export type OpsRiskAudit = {
  id: string;
  actor_type: string;
  action: string;
  table_name: string | null;
  record_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type OpsRiskUsage = {
  id: string;
  actor_type: string;
  event_type: string;
  quantity: number;
  unit: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type OpsRiskPending = {
  id: string;
  change_type: string;
  summary: string;
  risk_level: string | null;
  source: string | null;
  created_at: string;
};

export type OpsRiskJob = {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  run_after: string;
  locked_at: string | null;
  created_at: string;
};

export type OpsRiskItem = {
  key: string;
  label: string;
  detail: string;
  href: string;
  tone: "ok" | "warn" | "neutral";
  score: number;
};

function sinceHours(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - parsed) / 3_600_000);
}

function metadataId(value: Record<string, unknown>, key: string) {
  const id = value[key];
  return typeof id === "string" && id.length > 0 ? id : null;
}

function blockedReason(job: OpsRiskJob) {
  const blockedOn = job.result.blocked_on;
  if (typeof blockedOn === "string" && blockedOn.trim()) {
    return blockedOn.replaceAll("_", " ");
  }

  const lastError = job.result.last_error;
  if (typeof lastError === "string" && lastError.trim()) {
    return lastError.slice(0, 140);
  }

  return "unclassified blocker";
}

export function isStaleRunningJob(
  job: Pick<OpsRiskJob, "status" | "locked_at" | "created_at">,
  now = Date.now(),
  thresholdHours = 4,
) {
  if (job.status !== "running") return false;

  const referenceTime = job.locked_at ?? job.created_at;
  const parsed = Date.parse(referenceTime);
  if (!Number.isFinite(parsed)) return false;

  return Math.max(0, (now - parsed) / 3_600_000) >= thresholdHours;
}

export function buildOpsRiskSummary({
  audit,
  usage,
  pending,
  jobs,
  overdueQueue,
  readHealth,
}: {
  audit: OpsRiskAudit[];
  usage: OpsRiskUsage[];
  pending: OpsRiskPending[];
  jobs: OpsRiskJob[];
  overdueQueue: OverdueQueueObservation;
  readHealth: {
    complete: boolean;
    failedLabels: string[];
  };
}) {
  const highRiskPending = pending.filter((row) => row.risk_level === "high");
  const blockedJobs = jobs.filter((job) => job.status === "failed");
  const staleRunningJobs = jobs.filter((job) => isStaleRunningJob(job));
  const retryJobs = jobs.filter(
    (job) => job.status === "queued" && job.attempts > 1,
  );
  const recentClaudeWrites = audit.filter(
    (row) => row.actor_type === "claude" && sinceHours(row.created_at) <= 24,
  );
  const recentClientWrites = audit.filter(
    (row) => row.actor_type === "client" && sinceHours(row.created_at) <= 24,
  );
  const recentJobUsage = usage.filter(
    (row) =>
      row.event_type.startsWith("job_") && sinceHours(row.created_at) <= 24,
  );
  const queueObservationComplete =
    readHealth.complete && overdueQueue.state === "complete";
  const overdueQueueItem: OpsRiskItem = !queueObservationComplete
    ? {
        key: "operational-data-unknown",
        label: "Operational health is unknown",
        detail:
          readHealth.failedLabels.length > 0
            ? `Could not verify ${readHealth.failedLabels.join(", ")}. Missing observations are not treated as clear.`
            : "The overdue queued-job count and oldest due row are inconsistent. Missing observations are not treated as clear.",
        href: "/ops",
        tone: "warn",
        score: 100,
      }
    : (overdueQueue.overdueProductionCount ?? 0) > 0
      ? {
          key: "overdue-queued-jobs",
          label: "Overdue queued jobs",
          detail: `${overdueQueue.overdueProductionCount} production job${
            overdueQueue.overdueProductionCount === 1 ? " is" : "s are"
          } overdue; the oldest has been due since ${overdueQueue.oldestDueAt}. Attempts 0 and 1 are included.`,
          href: overdueQueue.oldestDueJobId
            ? `/ops/jobs/${overdueQueue.oldestDueJobId}`
            : "/ops",
          tone: "warn",
          score: 98,
        }
      : {
          key: "overdue-queue-clear",
          label: "Queued jobs are on schedule",
          detail:
            (overdueQueue.overdueControlledTestCount ?? 0) > 0
              ? `No production jobs are overdue. ${overdueQueue.overdueControlledTestCount} controlled test job${
                  overdueQueue.overdueControlledTestCount === 1 ? " was" : "s were"
                } excluded.`
              : "No production jobs are overdue at the captured queue cutoff.",
          href: "/ops",
          tone: "ok",
          score: 10,
        };

  const items = [
    overdueQueueItem,
    highRiskPending.length > 0
      ? {
          key: "high-risk-pending",
          label: "High-risk review backlog",
          detail: `${highRiskPending.length} proposal${
            highRiskPending.length === 1 ? "" : "s"
          } need detailed approval.`,
          href: "/changes",
          tone: "warn",
          score: 95,
        }
      : {
          key: "high-risk-clear",
          label: "High-risk reviews clear",
          detail: "No high-risk Claude proposals are waiting.",
          href: "/changes",
          tone: "ok",
          score: 20,
        },
    blockedJobs.length > 0
      ? {
          key: "blocked-jobs",
          label: "Blocked enrichment jobs",
          detail: `${blockedJobs.length} blocked; latest is waiting on ${blockedReason(
            blockedJobs[0],
          )}.`,
          href: `/ops/jobs/${blockedJobs[0].id}`,
          tone: "warn",
          score: 88,
        }
      : {
          key: "blocked-clear",
          label: "No blocked jobs",
          detail: "The visible enrichment queue has no failed jobs.",
          href: "/ops",
          tone: "ok",
          score: 10,
        },
    staleRunningJobs.length > 0
      ? {
          key: "stale-running",
          label: "Running handoff may be stale",
          detail: `${staleRunningJobs.length} running job${
            staleRunningJobs.length === 1 ? "" : "s"
          } have been open for more than four hours.`,
          href: `/ops/jobs/${staleRunningJobs[0].id}/handoff`,
          tone: "warn",
          score: 78,
        }
      : {
          key: "handoff-fresh",
          label: "Running handoffs look fresh",
          detail: "No long-running Claude handoffs are visible.",
          href: "/ops",
          tone: "ok",
          score: 10,
        },
    retryJobs.length > 0
      ? {
          key: "retry-jobs",
          label: "Retry pressure",
          detail: `${retryJobs.length} queued job${
            retryJobs.length === 1 ? "" : "s"
          } already retried at least once.`,
          href: `/ops/jobs/${retryJobs[0].id}`,
          tone: "warn",
          score: 65,
        }
      : {
          key: "retry-clear",
          label: "Retry pressure low",
          detail: "No queued jobs are currently in retry mode.",
          href: "/ops",
          tone: "ok",
          score: 5,
        },
    {
      key: "claude-write-volume",
      label: "24-hour Claude write activity",
      detail: `${recentClaudeWrites.length} audit row${
        recentClaudeWrites.length === 1 ? "" : "s"
      } and ${recentJobUsage.length} job event${
        recentJobUsage.length === 1 ? "" : "s"
      } in the last day.`,
      href: "/ops",
      tone: recentClaudeWrites.length > 30 ? "warn" : "neutral",
      score: recentClaudeWrites.length > 30 ? 60 : 25,
    },
    {
      key: "client-write-volume",
      label: "24-hour owner/operator activity",
      detail: `${recentClientWrites.length} client-side audited action${
        recentClientWrites.length === 1 ? "" : "s"
      } in the last day.`,
      href: "/ops",
      tone: "neutral",
      score: 20,
    },
  ] satisfies OpsRiskItem[];

  const sortedItems = [...items].sort(
    (a, b) => b.score - a.score || a.label.localeCompare(b.label),
  );

  const warningCount = sortedItems.filter((item) => item.tone === "warn").length;
  const topWarning = sortedItems.find((item) => item.tone === "warn") ?? null;
  const latestClaudeJobId =
    overdueQueue.oldestDueJobId ??
    metadataId(recentJobUsage[0]?.metadata ?? {}, "job_id") ??
    jobs.find((job) => ["queued", "running", "failed"].includes(job.status))
      ?.id ??
    null;

  return {
    items: sortedItems,
    warningCount,
    status: warningCount > 0 ? "Review" : "Clear",
    nextAction: topWarning
      ? {
          label: topWarning.label,
          detail: topWarning.detail,
          href: topWarning.href,
        }
      : {
          label: "Operational posture is clean",
          detail:
            "No immediate risks are visible in the current audit, usage, or job window.",
          href: latestClaudeJobId ? `/ops/jobs/${latestClaudeJobId}` : "/ops",
        },
  };
}
