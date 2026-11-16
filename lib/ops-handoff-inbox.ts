export type OpsHandoffInboxJob = {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  run_after: string;
  locked_at?: string | null;
  created_at: string;
  commandActionCount?: number;
};

export type OpsHandoffInboxPendingChange = {
  id: string;
  summary: string;
  risk_level: string | null;
};

export type OpsHandoffLaneKey =
  | "needs_return"
  | "needs_review"
  | "needs_capture"
  | "closed";

export type OpsHandoffInboxItem = {
  key: string;
  lane: OpsHandoffLaneKey;
  jobId: string;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
  tone: "cool" | "gold" | "hot" | "warn";
  createdAt: string;
};

export type OpsHandoffInboxLane = {
  key: OpsHandoffLaneKey;
  label: string;
  detail: string;
  items: OpsHandoffInboxItem[];
};

function commandFocus(job: OpsHandoffInboxJob) {
  const focus = job.payload.command_focus;
  if (!focus || typeof focus !== "object" || Array.isArray(focus)) return null;
  return focus as Record<string, unknown>;
}

function commandLabel(job: OpsHandoffInboxJob) {
  const command = commandFocus(job);
  return typeof command?.label === "string" && command.label.trim()
    ? command.label.trim()
    : job.job_type.replaceAll("_", " ");
}

function contactId(job: OpsHandoffInboxJob) {
  return typeof job.payload.contact_id === "string" ? job.payload.contact_id : null;
}

function uuidList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function hasCommandOutput(job: OpsHandoffInboxJob) {
  return (
    (typeof job.result.command_output === "string" &&
      job.result.command_output.trim().length > 0) ||
    (typeof job.result.summary === "string" && job.result.summary.trim().length > 0)
  );
}

function commandOutputDismissed(job: OpsHandoffInboxJob) {
  const dismissedAt = job.result.command_output_dismissed_at;
  return typeof dismissedAt === "string" && dismissedAt.trim().length > 0;
}

function pendingById(pendingChanges: OpsHandoffInboxPendingChange[]) {
  return new Map(pendingChanges.map((change) => [change.id, change]));
}

function linkedOpenPendingChanges(
  job: OpsHandoffInboxJob,
  pendingLookup: Map<string, OpsHandoffInboxPendingChange>,
) {
  return uuidList(job.result.created_pending_change_ids)
    .map((id) => pendingLookup.get(id))
    .filter((change): change is OpsHandoffInboxPendingChange => Boolean(change));
}

function jobDetail(job: OpsHandoffInboxJob) {
  const contact = contactId(job);
  const attempt = `attempt ${job.attempts}`;
  return contact ? `${contact.slice(0, 8)} · ${attempt}` : attempt;
}

function inboxItemForJob(
  job: OpsHandoffInboxJob,
  pendingLookup: Map<string, OpsHandoffInboxPendingChange>,
): OpsHandoffInboxItem {
  const openPending = linkedOpenPendingChanges(job, pendingLookup);
  const command = commandFocus(job);

  if (["queued", "running", "failed"].includes(job.status)) {
    const running = job.status === "running";
    const failed = job.status === "failed";
    return {
      key: `job:${job.id}`,
      lane: "needs_return",
      jobId: job.id,
      title: failed ? `Blocked: ${commandLabel(job)}` : commandLabel(job),
      detail: failed
        ? "Resolve the blocker, retry, or close the handoff intentionally."
        : running
          ? "Claude has claimed this job; paste the result back into the handoff."
          : "Queued for Claude claim.",
      href: `/ops/jobs/${job.id}/handoff`,
      actionLabel: failed ? "Inspect blocker" : running ? "Return job" : "Open handoff",
      tone: failed ? "warn" : running ? "hot" : "gold",
      createdAt: job.created_at,
    };
  }

  if (openPending.length > 0) {
    return {
      key: `job:${job.id}`,
      lane: "needs_review",
      jobId: job.id,
      title: commandLabel(job),
      detail: `${openPending.length} linked proposal${openPending.length === 1 ? "" : "s"} waiting for review.`,
      href: "/changes",
      actionLabel: "Review changes",
      tone: "warn",
      createdAt: job.created_at,
    };
  }

  if (
    command &&
    job.status === "succeeded" &&
    hasCommandOutput(job) &&
    !commandOutputDismissed(job) &&
    (job.commandActionCount ?? 0) === 0
  ) {
    return {
      key: `job:${job.id}`,
      lane: "needs_capture",
      jobId: job.id,
      title: commandLabel(job),
      detail: "Claude returned command output that still needs a movement action or dismissal.",
      href: `/ops/jobs/${job.id}#track-action`,
      actionLabel: "Capture or dismiss",
      tone: "warn",
      createdAt: job.created_at,
    };
  }

  return {
    key: `job:${job.id}`,
    lane: "closed",
    jobId: job.id,
    title: commandLabel(job),
    detail: command
      ? `Command closed with ${job.commandActionCount ?? 0} captured action${
          (job.commandActionCount ?? 0) === 1 ? "" : "s"
        }.`
      : `Closed ${job.job_type.replaceAll("_", " ")} · ${jobDetail(job)}.`,
    href: `/ops/jobs/${job.id}`,
    actionLabel: "Inspect job",
    tone: "cool",
    createdAt: job.created_at,
  };
}

const laneDetails = {
  needs_return: {
    label: "Needs return",
    detail: "Queued, running, or blocked handoffs that need operator attention.",
  },
  needs_review: {
    label: "Needs review",
    detail: "Completed jobs with linked proposals still waiting in Changes.",
  },
  needs_capture: {
    label: "Needs capture",
    detail: "Completed command outputs that need a movement action or dismissal.",
  },
  closed: {
    label: "Closed",
    detail: "Recently completed jobs with no immediate operator action.",
  },
} satisfies Record<OpsHandoffLaneKey, { label: string; detail: string }>;

export function buildOpsHandoffInbox({
  jobs,
  pendingChanges,
}: {
  jobs: OpsHandoffInboxJob[];
  pendingChanges: OpsHandoffInboxPendingChange[];
}) {
  const pendingLookup = pendingById(pendingChanges);
  const items = jobs.map((job) => inboxItemForJob(job, pendingLookup));
  const laneOrder: OpsHandoffLaneKey[] = [
    "needs_return",
    "needs_review",
    "needs_capture",
    "closed",
  ];

  const lanes: OpsHandoffInboxLane[] = laneOrder.map((key) => ({
    key,
    ...laneDetails[key],
    items: items
      .filter((item) => item.lane === key)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
  }));

  const nextItem =
    lanes.find((lane) => lane.key !== "closed" && lane.items.length > 0)?.items[0] ??
    lanes.find((lane) => lane.key === "closed")?.items[0] ??
    null;

  return {
    lanes,
    nextItem,
    counts: Object.fromEntries(
      lanes.map((lane) => [lane.key, lane.items.length]),
    ) as Record<OpsHandoffLaneKey, number>,
  };
}
