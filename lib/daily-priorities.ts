import { promiseLaneHref, promisePrimaryHref } from "../runtime/promise-routes.js";

export type DailyContact = {
  id: string;
  full_name: string;
  company_name: string | null;
  role_title: string[] | null;
  trust_level: string | null;
  relationship_strength: string | null;
  relationship_type: string[] | null;
  email: string | null;
  last_spoke: string | null;
  current_asks?: string | null;
  wants_help_with?: string | null;
  ideal_referral?: string | null;
  podcast_fit?: string | null;
  recent_activity?: string | null;
};

export type DailyPromise = {
  id: string;
  promise_text: string;
  direction: string;
  due_on: string | null;
  contacts?: {
    id?: string | null;
    full_name: string | null;
  } | null;
};

export type DailyPendingChange = {
  id: string;
  change_type: string;
  summary: string;
  risk_level: string | null;
  source: string | null;
  created_at: string;
};

export type DailyJob = {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  run_after: string;
  created_at: string;
};

export type DailyRelationshipAction = {
  id: string;
  title: string;
  action_type: string;
  status: string;
  priority: string;
  due_on: string | null;
  metadata?: Record<string, unknown> | null;
  source?: string | null;
  contacts?: {
    id?: string | null;
    full_name: string | null;
  } | null;
};

export type DailyCommandJob = {
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

export type DailyPriority = {
  key: string;
  eyebrow: string;
  title: string;
  detail: string;
  reason: string;
  href: string;
  action: string;
  tone: "hot" | "gold" | "cool" | "warn";
  score: number;
  contactId?: string | null;
  secondaryAction?: string;
  secondaryHref?: string;
  suggestedActionType?: string;
  suggestedPriority?: string;
};

type DailyPriorityInput = {
  contacts: DailyContact[];
  openPromises: DailyPromise[];
  pendingChanges: DailyPendingChange[];
  activeJobs: DailyJob[];
  relationshipActions?: DailyRelationshipAction[];
  commandJobs?: DailyCommandJob[];
};

type RelationshipActionLane =
  | "overdue"
  | "due_today"
  | "due_soon"
  | "scheduled"
  | "unscheduled"
  | "closed";

const highLeverageActionTypes = new Set([
  "promise",
  "introduction",
  "referral",
  "owner_verification",
  "claude_draft",
]);
const claudeActionSources = new Set(["claude_command_output", "claude_command", "command_job"]);

export function promiseIdFromPriorityKey(key: string) {
  return key.startsWith("promise:") ? key.slice("promise:".length) || null : null;
}

function isClaudeRelationshipAction(action: DailyRelationshipAction) {
  return (
    (action.source ? claudeActionSources.has(action.source) : false) ||
    typeof action.metadata?.job_id === "string" ||
    typeof action.metadata?.command_label === "string"
  );
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dayDelta(value: string | null | undefined) {
  const parsed = parseDate(value);
  if (parsed === null) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(parsed);
  target.setHours(0, 0, 0, 0);

  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function relationshipActionLane(action: DailyRelationshipAction): RelationshipActionLane {
  if (["done", "skipped"].includes(action.status)) return "closed";

  const delta = dayDelta(action.due_on);
  if (delta === null) return "unscheduled";
  if (delta < 0) return "overdue";
  if (delta === 0) return "due_today";
  if (delta <= 7) return "due_soon";
  return "scheduled";
}

function relationshipActionUrgencyLabel(action: DailyRelationshipAction) {
  const lane = relationshipActionLane(action);
  const delta = dayDelta(action.due_on);

  if (lane === "closed") return action.status === "done" ? "Done" : "Skipped";
  if (delta === null) return "No due date";
  if (delta < 0) {
    const days = Math.abs(delta);
    return `${days} day${days === 1 ? "" : "s"} overdue`;
  }
  if (delta === 0) return "Due today";
  return `Due in ${delta} day${delta === 1 ? "" : "s"}`;
}

function relationshipActionPriorityScore(action: DailyRelationshipAction) {
  const lane = relationshipActionLane(action);
  const delta = dayDelta(action.due_on);
  const priorityBoost =
    action.priority === "high" ? 18 : action.priority === "normal" ? 8 : 0;
  const typeBoost = highLeverageActionTypes.has(action.action_type) ? 10 : 0;
  const sourceBoost = isClaudeRelationshipAction(action) ? 6 : 0;
  const deferredPenalty = action.status === "deferred" ? -12 : 0;

  const laneScore =
    lane === "overdue"
      ? 92 + Math.min(Math.abs(delta ?? 0), 21)
      : lane === "due_today"
        ? 90
        : lane === "due_soon"
          ? 78 - Math.max(0, delta ?? 0)
          : lane === "scheduled"
            ? 48 - Math.min(delta ?? 0, 30) / 2
            : lane === "unscheduled"
              ? 38
              : 0;

  return Math.round(laneScore + priorityBoost + typeBoost + sourceBoost + deferredPenalty);
}

function daysSince(value: string | null | undefined) {
  const delta = dayDelta(value);
  return delta === null ? null : Math.max(0, -delta);
}

function contactValueScore(contact: DailyContact) {
  let score = 0;
  const text = [
    contact.trust_level,
    contact.relationship_strength,
    contact.relationship_type?.join(" "),
    contact.current_asks,
    contact.wants_help_with,
    contact.ideal_referral,
    contact.podcast_fit,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/tier 1|trusted|high/.test(text)) score += 16;
  if (/hot|warm|strong/.test(text)) score += 12;
  if (contact.current_asks || contact.wants_help_with) score += 12;
  if (contact.ideal_referral || contact.podcast_fit) score += 8;
  if (/investor|m&a|capital|operator|founder|deal|podcast/.test(text)) score += 6;

  return score;
}

function promisePriority(promise: DailyPromise): DailyPriority {
  const delta = dayDelta(promise.due_on);
  const ownerOwes = promise.direction === "owner_owes_contact";
  const overdue = delta !== null && delta < 0;
  const dueToday = delta === 0;
  const contactName = promise.contacts?.full_name ?? "No contact linked";
  const promiseLane = promiseLaneHref(promise);
  const score =
    (overdue ? 98 : dueToday ? 92 : delta !== null && delta <= 7 ? 78 : 62) +
    (ownerOwes ? 8 : 0);

  return {
    key: `promise:${promise.id}`,
    eyebrow: ownerOwes ? "You Owe" : "They Owe",
    title: promise.promise_text,
    detail: `${contactName} · ${
      overdue
        ? `${Math.abs(delta ?? 0)} day${Math.abs(delta ?? 0) === 1 ? "" : "s"} overdue`
        : dueToday
          ? "Due today"
          : delta === null
            ? "No due date stored"
            : `Due in ${delta} day${delta === 1 ? "" : "s"}`
    }`,
    reason: ownerOwes
      ? "Owner promises are the highest trust-preservation risk."
      : "Open commitment should be resolved or marked no longer active.",
    href: promisePrimaryHref(promise),
    action: ownerOwes ? "Close promise" : "Follow up",
    tone: overdue || dueToday ? "hot" : "gold",
    score,
    contactId: promise.contacts?.id ?? null,
    secondaryAction: "Promise lane",
    secondaryHref: promiseLane,
    suggestedActionType: "promise",
    suggestedPriority: ownerOwes || overdue || dueToday ? "high" : "normal",
  };
}

function pendingPriority(change: DailyPendingChange): DailyPriority {
  const highRisk = change.risk_level === "high";
  const newContact = change.change_type === "new_contact";

  return {
    key: `change:${change.id}`,
    eyebrow: highRisk ? "Verify" : "Review",
    title: change.summary,
    detail: `${change.change_type.replaceAll("_", " ")}${
      change.source ? ` · ${change.source}` : ""
    }`,
    reason: highRisk
      ? "Judgment or identity-sensitive updates should be approved before more automation runs."
      : newContact
        ? "New people should be duplicate-checked and enriched before they become operational."
        : "Pending changes are the control point between Claude and the private book.",
    href: `/changes/${change.id}`,
    action: highRisk || newContact ? "Inspect change" : "Review change",
    tone: highRisk ? "warn" : "gold",
    score: highRisk ? 90 : newContact ? 82 : 70,
  };
}

function jobContactLabel(job: DailyJob) {
  const contactId = job.payload.contact_id;
  if (typeof contactId === "string" && contactId.length >= 8) {
    return `Contact ${contactId.slice(0, 8)}`;
  }
  return "No contact pinned";
}

function jobPriority(job: DailyJob): DailyPriority {
  const running = job.status === "running";
  const failed = job.status === "failed";
  const blockedOn = job.result.blocked_on;
  const blockedLabel =
    typeof blockedOn === "string" ? blockedOn.replaceAll("_", " ") : "blocked";

  return {
    key: `job:${job.id}`,
    eyebrow: failed ? "Blocked" : running ? "Claude Active" : "Queued",
    title: `${job.job_type.replaceAll("_", " ")} · ${job.id.slice(0, 8)}`,
    detail: failed ? blockedLabel : jobContactLabel(job),
    reason: failed
      ? "A blocked enrichment loop needs owner verification or endpoint cleanup."
      : running
        ? "Claude has claimed the work; finish the handoff before adding more volume."
        : "Queued enrichment should be claimed once the review queue is not overloaded.",
    href: running ? `/ops/jobs/${job.id}/handoff` : `/ops/jobs/${job.id}`,
    action: running ? "Open handoff" : "Inspect job",
    tone: failed ? "warn" : running ? "hot" : "gold",
    score: failed ? 86 : running ? 80 : 64,
  };
}

function relationshipActionTone(action: DailyRelationshipAction) {
  const lane = relationshipActionLane(action);
  if (lane === "overdue" || lane === "due_today") return "hot";
  if (action.priority === "high" || lane === "due_soon") return "gold";
  return "cool";
}

function relationshipActionEyebrow(action: DailyRelationshipAction) {
  const lane = relationshipActionLane(action);
  if (action.action_type === "owner_verification") return "Verify";
  if (action.action_type === "claude_draft") return "Claude Move";
  if (lane === "overdue" || lane === "due_today") return "Next Move";
  return action.action_type.replaceAll("_", " ");
}

function relationshipActionPriority(action: DailyRelationshipAction): DailyPriority {
  const contactName = action.contacts?.full_name ?? "No contact linked";
  const actionType = action.action_type.replaceAll("_", " ");
  const href = action.contacts?.id ? `/contacts/${action.contacts.id}` : "/movement";
  const urgency = relationshipActionUrgencyLabel(action);
  const movementHref =
    relationshipActionTone(action) === "hot" ? "/movement?view=hot" : "/movement?view=active";

  return {
    key: `relationship_action:${action.id}`,
    eyebrow: relationshipActionEyebrow(action),
    title: action.title,
    detail: `${contactName} · ${actionType} · ${urgency}`,
    reason:
      action.action_type === "owner_verification"
        ? "This action needs the owner to verify relationship judgment before it should drive more automation."
        : isClaudeRelationshipAction(action)
          ? "Claude turned context into a trackable next move; review or complete it before it goes stale."
          : "A relationship action was deliberately captured and should be worked from the movement queue.",
    href,
    action: "Work move",
    tone: relationshipActionTone(action),
    score: relationshipActionPriorityScore(action),
    contactId: action.contacts?.id ?? null,
    secondaryAction: "Next Moves",
    secondaryHref: movementHref,
    suggestedActionType: action.action_type,
    suggestedPriority: action.priority,
  };
}

function commandFocus(job: DailyCommandJob) {
  const focus = job.payload.command_focus;
  if (!focus || typeof focus !== "object" || Array.isArray(focus)) return null;
  return focus as Record<string, unknown>;
}

function commandOutput(job: DailyCommandJob) {
  if (typeof job.result.command_output === "string" && job.result.command_output.trim()) {
    return job.result.command_output.trim();
  }

  if (typeof job.result.summary === "string" && job.result.summary.trim()) {
    return job.result.summary.trim();
  }

  return "";
}

function commandOutputDismissed(job: DailyCommandJob) {
  const dismissedAt = job.result.command_output_dismissed_at;
  return typeof dismissedAt === "string" && dismissedAt.trim().length > 0;
}

function commandContactId(job: DailyCommandJob) {
  return typeof job.payload.contact_id === "string" ? job.payload.contact_id : null;
}

function commandActionType(intent: unknown) {
  if (intent === "verify_referral_lane") return "referral";
  if (intent === "build_intro_map") return "introduction";
  if (intent === "prep_for_call") return "follow_up";
  return "claude_draft";
}

function commandActionPriority(job: DailyCommandJob) {
  const text = [
    job.result.command_output,
    job.result.follow_up_needed,
    job.result.verification_summary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /verify|confirm|owner|risk|guardrail|before sending|before outreach/.test(text)
    ? "high"
    : "normal";
}

function firstSentence(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const clean = value.trim().replace(/\s+/g, " ").slice(0, 140);
  return (clean.match(/^[^.!?]+[.!?]/)?.[0] ?? clean).trim();
}

function commandActionTitle(job: DailyCommandJob, command: Record<string, unknown>) {
  const title = firstSentence(job.result.follow_up_needed) ?? firstSentence(job.result.command_output);
  if (title) return title;

  const label =
    typeof command.label === "string" && command.label.trim()
      ? command.label.trim()
      : "Claude command";

  if (command.intent === "verify_referral_lane") return "Review referral lane";
  if (command.intent === "build_intro_map") return "Review intro map";
  if (command.intent === "prep_for_call") return "Use call prep";
  return label;
}

function commandOutputPriority(job: DailyCommandJob): DailyPriority | null {
  const command = commandFocus(job);
  const output = commandOutput(job);
  if (
    !command ||
    job.status !== "succeeded" ||
    !output ||
    job.trackedAction?.id ||
    commandOutputDismissed(job)
  ) {
    return null;
  }

  const actionType = commandActionType(command.intent);
  const priority = commandActionPriority(job);

  return {
    key: `command_output:${job.id}`,
    eyebrow: priority === "high" ? "Capture" : "Claude Output",
    title: commandActionTitle(job, command),
    detail: `${actionType.replaceAll("_", " ")} · untracked output`,
    reason:
      priority === "high"
        ? "Claude returned usable output with verification language; capture it as a tracked move before it drives follow-up."
        : "Claude returned usable relationship output that should become a tracked movement item or be deliberately dismissed.",
    href: `/ops/jobs/${job.id}`,
    action: "Capture move",
    tone: priority === "high" ? "warn" : "gold",
    score: priority === "high" ? 88 : 76,
    contactId: commandContactId(job),
    suggestedActionType: actionType,
    suggestedPriority: priority,
  };
}

function contactPriority(contact: DailyContact): DailyPriority | null {
  const value = contactValueScore(contact);
  const staleDays = daysSince(contact.last_spoke);
  const hasUsefulContext =
    Boolean(contact.current_asks) ||
    Boolean(contact.wants_help_with) ||
    Boolean(contact.ideal_referral) ||
    Boolean(contact.podcast_fit);

  if (!hasUsefulContext && value < 18) return null;

  const staleBoost = staleDays === null ? 4 : staleDays > 180 ? 22 : staleDays > 90 ? 16 : 0;
  const score = 48 + value + staleBoost;

  if (score < 62) return null;

  return {
    key: `contact:${contact.id}`,
    eyebrow: staleDays !== null && staleDays > 120 ? "Rewarm" : "Use",
    title: contact.full_name,
    detail:
      contact.current_asks ??
      contact.ideal_referral ??
      contact.podcast_fit ??
      contact.wants_help_with ??
      contact.recent_activity ??
      "Useful relationship context is stored.",
    reason:
      staleDays !== null && staleDays > 120
        ? `High-value contact with ${staleDays} days since stored touch.`
        : "Stored asks or referral lanes make this person useful now.",
    href: `/contacts/${contact.id}`,
    action: "Open profile",
    tone: staleDays !== null && staleDays > 120 ? "gold" : "cool",
    score,
    contactId: contact.id,
    suggestedActionType: staleDays !== null && staleDays > 120 ? "reconnect" : "follow_up",
    suggestedPriority: score >= 80 ? "high" : "normal",
  };
}

export function buildDailyPriorities({
  contacts,
  openPromises,
  pendingChanges,
  activeJobs,
  relationshipActions = [],
  commandJobs = [],
}: DailyPriorityInput) {
  const priorities = [
    ...openPromises.map(promisePriority),
    ...relationshipActions.map(relationshipActionPriority),
    ...commandJobs
      .map(commandOutputPriority)
      .filter((priority): priority is DailyPriority => Boolean(priority)),
    ...pendingChanges.map(pendingPriority),
    ...activeJobs.map(jobPriority),
    ...contacts
      .map(contactPriority)
      .filter((priority): priority is DailyPriority => Boolean(priority)),
  ]
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 7);

  return priorities.length > 0
    ? priorities
    : [
        {
          key: "empty:ask",
          eyebrow: "Pressure Test",
          title: "Ask the book for useful paths",
          detail:
            "No urgent promises, review items, or enrichment jobs are visible. Use Ask to find a relationship move.",
          reason: "This keeps the book useful even when there is no urgent queue.",
          href: "/ask",
          action: "Ask the book",
          tone: "cool" as const,
          score: 1,
        },
      ];
}

export function dailyPrioritySummary({
  contacts,
  openPromises,
  pendingChanges,
  activeJobs,
  relationshipActions = [],
  commandJobs = [],
}: DailyPriorityInput) {
  const overduePromises = openPromises.filter((promise) => {
    const delta = dayDelta(promise.due_on);
    return delta !== null && delta <= 0;
  }).length;

  const highRiskChanges = pendingChanges.filter(
    (change) => change.risk_level === "high",
  ).length;

  const staleUsefulContacts = contacts.filter((contact) => {
    const staleDays = daysSince(contact.last_spoke);
    return staleDays !== null && staleDays > 120 && contactValueScore(contact) >= 18;
  }).length;

  const hotRelationshipActions = relationshipActions.filter((action) => {
    const lane = relationshipActionLane(action);
    return lane === "overdue" || lane === "due_today";
  }).length;

  const untrackedCommandOutputs = commandJobs.filter((job) =>
    Boolean(commandOutputPriority(job)),
  ).length;

  return {
    overduePromises,
    highRiskChanges,
    hotRelationshipActions,
    untrackedCommandOutputs,
    activeJobs: activeJobs.length,
    staleUsefulContacts,
  };
}
