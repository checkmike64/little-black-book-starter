export type DecisionPendingChange = {
  id: string;
  change_type: string;
  summary: string;
  risk_level: string | null;
  source: string | null;
  created_at: string;
};

export type DecisionCommandJob = {
  id: string;
  job_type: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  created_at: string;
  trackedAction?: {
    id: string;
    status: string;
  } | null;
};

export type DailyDecisionQueueItem = {
  key: string;
  label: string;
  title: string;
  detail: string;
  reason: string;
  href: string;
  action: string;
  tone: "hot" | "gold" | "cool" | "warn";
  score: number;
};

export type DailyDecisionQueue = {
  status: "clear" | "review" | "urgent";
  tone: "hot" | "gold" | "cool" | "warn";
  headline: string;
  detail: string;
  nextAction: {
    label: string;
    href: string;
    detail: string;
  };
  items: DailyDecisionQueueItem[];
  counts: {
    pendingChanges: number;
    highRiskChanges: number;
    askDecisions: number;
    commandOutputs: number;
    total: number;
  };
};

type DailyDecisionQueueInput = {
  pendingChanges: DecisionPendingChange[];
  askRunUndecidedCount: number;
  commandJobs?: DecisionCommandJob[];
};

type CommandOutputActionPriority = "high" | "normal";

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanTextLimit(value: unknown, maxLength: number) {
  const clean = cleanText(value)?.replace(/\s+/g, " ").slice(0, maxLength);
  return clean || null;
}

function firstSentence(value: unknown, maxLength = 140) {
  const clean = cleanTextLimit(value, maxLength);
  if (!clean) return null;
  return (clean.match(/^[^.!?]+[.!?]/)?.[0] ?? clean).trim();
}

function commandOutputActionType(intent: string | null) {
  if (intent === "verify_referral_lane") return "referral";
  if (intent === "build_intro_map") return "introduction";
  if (intent === "prep_for_call") return "follow_up";
  return "claude_draft";
}

function commandOutputActionPriority({
  commandOutput,
  followUpNeeded,
  verificationSummary,
}: {
  commandOutput: string | null;
  followUpNeeded: string | null;
  verificationSummary: string | null;
}): CommandOutputActionPriority {
  const text = [commandOutput, followUpNeeded, verificationSummary]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /verify|confirm|owner|risk|guardrail|before sending|before outreach/.test(text)
    ? "high"
    : "normal";
}

function commandOutputActionTitle({
  commandIntent,
  commandLabel,
  commandOutput,
  followUpNeeded,
}: {
  commandIntent: string | null;
  commandLabel: string | null;
  commandOutput: string | null;
  followUpNeeded: string | null;
}) {
  const nextStep = firstSentence(followUpNeeded) ?? firstSentence(commandOutput);
  if (nextStep) return nextStep;

  const label = cleanTextLimit(commandLabel, 80) ?? "Claude command";
  if (commandIntent === "verify_referral_lane") return "Review referral lane";
  if (commandIntent === "build_intro_map") return "Review intro map";
  if (commandIntent === "prep_for_call") return "Use call prep";
  return label;
}

function commandOutputDismissed(result: Record<string, unknown>) {
  return Boolean(cleanText(result.command_output_dismissed_at));
}

function commandFocus(job: DecisionCommandJob) {
  const focus = job.payload.command_focus;
  if (!focus || typeof focus !== "object" || Array.isArray(focus)) return null;
  return focus as Record<string, unknown>;
}

function commandOutput(job: DecisionCommandJob) {
  return cleanText(job.result.command_output) ?? cleanText(job.result.summary);
}

function commandDecisionPriority(priority: CommandOutputActionPriority) {
  return priority === "high" ? 86 : 72;
}

function pendingChangeItem(change: DecisionPendingChange): DailyDecisionQueueItem {
  const highRisk = change.risk_level === "high";
  const newContact = change.change_type === "new_contact";

  return {
    key: `change:${change.id}`,
    label: highRisk ? "Verify update" : newContact ? "New person" : "Review update",
    title: change.summary,
    detail: `${change.change_type.replaceAll("_", " ")}${
      change.source ? ` · ${change.source}` : ""
    }`,
    reason: highRisk
      ? "High-risk changes need owner judgment before the book treats them as true."
      : newContact
        ? "New contacts should be duplicate-checked and enriched before they enter normal workflows."
        : "Claude-suggested updates should be approved or rejected while the context is fresh.",
    href: `/changes/${change.id}`,
    action: highRisk || newContact ? "Inspect change" : "Review change",
    tone: highRisk ? "warn" : "gold",
    score: highRisk ? 96 : newContact ? 82 : 70,
  };
}

function commandJobItem(job: DecisionCommandJob): DailyDecisionQueueItem | null {
  const focus = commandFocus(job);
  const output = commandOutput(job);
  if (
    !focus ||
    job.status !== "succeeded" ||
    !output ||
    job.trackedAction?.id ||
    commandOutputDismissed(job.result)
  ) {
    return null;
  }

  const commandIntent = cleanText(focus.intent);
  const commandLabel = cleanText(focus.label);
  const followUpNeeded = cleanText(job.result.follow_up_needed);
  const verificationSummary = cleanText(job.result.verification_summary);
  const recommendation = {
    actionType: commandOutputActionType(commandIntent),
    priority: commandOutputActionPriority({
      commandOutput: output,
      followUpNeeded,
      verificationSummary,
    }),
    title: commandOutputActionTitle({
      commandIntent,
      commandLabel,
      commandOutput: output,
      followUpNeeded,
    }),
  };

  return {
    key: `command:${job.id}`,
    label:
      recommendation.priority === "high" ? "Capture Claude output" : "Claude output",
    title: recommendation.title,
    detail: `${recommendation.actionType.replaceAll("_", " ")} · untracked command output`,
    reason:
      recommendation.priority === "high"
        ? "Claude found a usable move with verification language; capture or dismiss it before it sits outside the action loop."
        : "Claude returned usable relationship output that should become a tracked move or be deliberately dismissed.",
    href: `/ops/jobs/${job.id}`,
    action: "Capture or dismiss",
    tone: recommendation.priority === "high" ? "warn" : "gold",
    score: commandDecisionPriority(recommendation.priority),
  };
}

function askDecisionItem(count: number): DailyDecisionQueueItem | null {
  if (count <= 0) return null;

  return {
    key: "ask:decisions",
    label: "Ask decision",
    title: "Close saved Ask decisions",
    detail: `${count} saved Ask run${count === 1 ? "" : "s"} need follow-up or no-action decisions.`,
    reason:
      "Ask results should either become relationship work or be marked no-action so the book stays clean.",
    href: "/ask?saved=needs_decision",
    action: "Review Ask runs",
    tone: count >= 3 ? "warn" : "gold",
    score: count >= 3 ? 88 : 78,
  };
}

export function buildDailyDecisionQueue({
  pendingChanges,
  askRunUndecidedCount,
  commandJobs = [],
}: DailyDecisionQueueInput): DailyDecisionQueue {
  const changeItems = pendingChanges.map(pendingChangeItem);
  const commandItems = commandJobs
    .map(commandJobItem)
    .filter((item): item is DailyDecisionQueueItem => Boolean(item));
  const askItem = askDecisionItem(askRunUndecidedCount);

  const items = [...changeItems, ...(askItem ? [askItem] : []), ...commandItems]
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 6);

  const highRiskChanges = pendingChanges.filter(
    (change) => change.risk_level === "high",
  ).length;
  const total = pendingChanges.length + askRunUndecidedCount + commandItems.length;

  if (items.length === 0) {
    return {
      status: "clear",
      tone: "cool",
      headline: "No owner decisions are waiting",
      detail:
        "Pending changes, saved Ask runs, and Claude command outputs are clear.",
      nextAction: {
        label: "Ask the book",
        href: "/ask",
        detail: "Create one useful relationship path when there is no review queue.",
      },
      items: [],
      counts: {
        pendingChanges: 0,
        highRiskChanges: 0,
        askDecisions: 0,
        commandOutputs: 0,
        total: 0,
      },
    };
  }

  const urgent = highRiskChanges > 0 || commandItems.some((item) => item.tone === "warn");
  const top = items[0];

  return {
    status: urgent ? "urgent" : "review",
    tone: urgent ? "warn" : "gold",
    headline: urgent
      ? "Owner judgment is needed before the book moves on"
      : "Review queue is ready for clean decisions",
    detail:
      "Approve, reject, capture, or dismiss the work that came in through Claude and Ask.",
    nextAction: {
      label: top.action,
      href: top.href,
      detail: top.reason,
    },
    items,
    counts: {
      pendingChanges: pendingChanges.length,
      highRiskChanges,
      askDecisions: askRunUndecidedCount,
      commandOutputs: commandItems.length,
      total,
    },
  };
}
