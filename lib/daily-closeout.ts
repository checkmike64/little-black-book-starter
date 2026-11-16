export type CloseoutInteraction = {
  id: string;
  occurred_at: string;
  title: string | null;
  summary: string | null;
  interaction_type: string;
  interaction_contacts?: Array<{
    contacts?: {
      full_name: string | null;
    } | null;
  }>;
};

export type CloseoutPromise = {
  id: string;
  promise_text: string;
  status: string;
  completed_at: string | null;
  contacts?: {
    id?: string | null;
    full_name: string | null;
  } | null;
};

export type CloseoutRelationshipAction = {
  id: string;
  title: string;
  action_type: string;
  status: string;
  completed_at: string | null;
  contacts?: {
    id?: string | null;
    full_name: string | null;
  } | null;
};

export type CloseoutCommandJob = {
  id: string;
  job_type: string;
  status: string;
  result: Record<string, unknown>;
};

export type DailyCloseoutItem = {
  key: string;
  label: string;
  title: string;
  detail: string;
  href: string;
  tone: "hot" | "gold" | "cool";
};

export type DailyCloseoutSummary = {
  headline: string;
  detail: string;
  status: "clear" | "progress" | "needs_review";
  tone: "hot" | "gold" | "cool";
  counts: {
    interactions: number;
    promises: number;
    relationshipActions: number;
    commandJobs: number;
    totalClosed: number;
  };
  items: DailyCloseoutItem[];
  nextAction: {
    label: string;
    href: string;
    detail: string;
  };
};

function participantNames(interaction: CloseoutInteraction) {
  const names =
    interaction.interaction_contacts
      ?.map((item) => item.contacts?.full_name)
      .filter((name): name is string => Boolean(name)) ?? [];

  return names.length > 0 ? names.join(", ") : "No matched contacts";
}

function commandSummary(job: CloseoutCommandJob) {
  const summary = job.result.summary;
  const commandOutput = job.result.command_output;
  if (typeof summary === "string" && summary.trim()) return summary.trim();
  if (typeof commandOutput === "string" && commandOutput.trim()) {
    return commandOutput.trim().replace(/\s+/g, " ").slice(0, 160);
  }
  return "Claude completed the handoff.";
}

function commandNeedsReview(job: CloseoutCommandJob) {
  const pending = job.result.created_pending_change_ids;
  return Array.isArray(pending) && pending.length > 0;
}

export function buildDailyCloseoutSummary({
  commandJobs,
  interactions,
  promises,
  relationshipActions,
  unresolvedDecisions,
}: {
  commandJobs: CloseoutCommandJob[];
  interactions: CloseoutInteraction[];
  promises: CloseoutPromise[];
  relationshipActions: CloseoutRelationshipAction[];
  unresolvedDecisions: number;
}): DailyCloseoutSummary {
  const interactionItems = interactions.slice(0, 3).map((interaction): DailyCloseoutItem => ({
    key: `interaction:${interaction.id}`,
    label: "Logged",
    title: interaction.title ?? interaction.summary ?? "Interaction logged",
    detail: `${interaction.interaction_type} · ${participantNames(interaction)}`,
    href: "/dashboard",
    tone: "cool",
  }));
  const promiseItems = promises.slice(0, 3).map((promise): DailyCloseoutItem => ({
    key: `promise:${promise.id}`,
    label: promise.status === "completed" ? "Promise done" : "Promise closed",
    title: promise.promise_text,
    detail: promise.contacts?.full_name ?? "No contact linked",
    href: promise.contacts?.id ? `/contacts/${promise.contacts.id}` : "/promises?filter=closed",
    tone: "cool",
  }));
  const actionItems = relationshipActions.slice(0, 3).map((action): DailyCloseoutItem => ({
    key: `action:${action.id}`,
    label: action.status === "done" ? "Move done" : "Move skipped",
    title: action.title,
    detail: `${action.contacts?.full_name ?? "No contact linked"} · ${action.action_type.replaceAll("_", " ")}`,
    href: action.contacts?.id ? `/contacts/${action.contacts.id}` : "/movement?view=closed",
    tone: action.status === "done" ? "cool" : "gold",
  }));
  const commandItems = commandJobs.slice(0, 3).map((job): DailyCloseoutItem => ({
    key: `command:${job.id}`,
    label: commandNeedsReview(job) ? "Claude review" : "Claude done",
    title: job.job_type.replaceAll("_", " "),
    detail: commandSummary(job),
    href: `/ops/jobs/${job.id}`,
    tone: commandNeedsReview(job) ? "gold" : "cool",
  }));
  const items = [...promiseItems, ...actionItems, ...interactionItems, ...commandItems].slice(0, 8);
  const totalClosed =
    interactions.length + promises.length + relationshipActions.length + commandJobs.length;
  const needsReview =
    unresolvedDecisions > 0 || commandJobs.some(commandNeedsReview);
  const status = needsReview ? "needs_review" : totalClosed > 0 ? "progress" : "clear";

  return {
    headline:
      status === "needs_review"
        ? "Close the day by resolving review decisions"
        : status === "progress"
          ? "Today has relationship movement logged"
          : "No completed movement logged today",
    detail:
      status === "needs_review"
        ? "Some completed work still needs approval or an Ask decision before it should drive follow-up."
        : status === "progress"
          ? `${totalClosed} item${totalClosed === 1 ? "" : "s"} closed or logged today.`
          : "Work one useful touch, promise, or Ask result before closeout.",
    status,
    tone: status === "needs_review" ? "gold" : status === "progress" ? "cool" : "hot",
    counts: {
      interactions: interactions.length,
      promises: promises.length,
      relationshipActions: relationshipActions.length,
      commandJobs: commandJobs.length,
      totalClosed,
    },
    items,
    nextAction:
      unresolvedDecisions > 0
        ? {
            label: "Review Ask runs",
            href: "/ask?saved=needs_decision",
            detail: `${unresolvedDecisions} saved Ask run${unresolvedDecisions === 1 ? "" : "s"} still need a decision.`,
          }
        : commandJobs.some(commandNeedsReview)
          ? {
              label: "Review changes",
              href: "/changes",
              detail: "Completed Claude output created reviewable changes.",
            }
          : totalClosed > 0
            ? {
                label: "Open movement",
                href: "/movement?view=closed",
                detail: "Inspect recently closed relationship actions.",
              }
            : {
                label: "Work today plan",
                href: "/dashboard",
                detail: "Log one useful relationship move before closing out.",
              },
  };
}
