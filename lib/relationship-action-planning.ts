export type RelationshipActionPlanningInput = {
  id: string;
  title: string;
  action_type: string;
  status: string;
  priority: string;
  due_on: string | null;
  metadata?: Record<string, unknown> | null;
  source?: string | null;
  notes?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
};

export type RelationshipActionLane =
  | "overdue"
  | "due_today"
  | "due_soon"
  | "scheduled"
  | "unscheduled"
  | "closed";

export type RelationshipActionPlanItem<T extends RelationshipActionPlanningInput> = {
  action: T;
  daysUntilDue: number | null;
  lane: RelationshipActionLane;
  score: number;
  urgencyLabel: string;
};

const MS_PER_DAY = 86_400_000;
const closedStatuses = new Set(["done", "skipped"]);
const highLeverageTypes = new Set([
  "promise",
  "introduction",
  "referral",
  "owner_verification",
  "claude_draft",
]);
const claudeActionSources = new Set(["claude_command_output", "claude_command", "command_job"]);

function isClaudeAction(action: RelationshipActionPlanningInput) {
  return (
    (action.source ? claudeActionSources.has(action.source) : false) ||
    typeof action.metadata?.job_id === "string" ||
    typeof action.metadata?.command_label === "string"
  );
}

function utcDay(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function parseDueDay(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? utcDay(parsed) : null;
}

export function daysUntilRelationshipActionDue(
  dueOn: string | null | undefined,
  now = new Date(),
) {
  const dueDay = parseDueDay(dueOn);
  if (dueDay === null) return null;
  return Math.round((dueDay - utcDay(now)) / MS_PER_DAY);
}

export function relationshipActionLane(
  action: RelationshipActionPlanningInput,
  now = new Date(),
): RelationshipActionLane {
  if (closedStatuses.has(action.status)) return "closed";

  const daysUntilDue = daysUntilRelationshipActionDue(action.due_on, now);
  if (daysUntilDue === null) return "unscheduled";
  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue === 0) return "due_today";
  if (daysUntilDue <= 7) return "due_soon";
  return "scheduled";
}

export function relationshipActionUrgencyLabel(
  action: RelationshipActionPlanningInput,
  now = new Date(),
) {
  const daysUntilDue = daysUntilRelationshipActionDue(action.due_on, now);
  const lane = relationshipActionLane(action, now);

  if (lane === "closed") return action.status === "done" ? "Done" : "Skipped";
  if (daysUntilDue === null) return "No due date";
  if (daysUntilDue < 0) {
    const days = Math.abs(daysUntilDue);
    return `${days} day${days === 1 ? "" : "s"} overdue`;
  }
  if (daysUntilDue === 0) return "Due today";
  return `Due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`;
}

export function relationshipActionPriorityScore(
  action: RelationshipActionPlanningInput,
  now = new Date(),
) {
  const lane = relationshipActionLane(action, now);
  const daysUntilDue = daysUntilRelationshipActionDue(action.due_on, now);
  const priorityBoost =
    action.priority === "high" ? 18 : action.priority === "normal" ? 8 : 0;
  const typeBoost = highLeverageTypes.has(action.action_type) ? 10 : 0;
  const sourceBoost = isClaudeAction(action) ? 6 : 0;
  const deferredPenalty = action.status === "deferred" ? -12 : 0;

  const laneScore =
    lane === "overdue"
      ? 92 + Math.min(Math.abs(daysUntilDue ?? 0), 21)
      : lane === "due_today"
        ? 90
        : lane === "due_soon"
          ? 78 - Math.max(0, daysUntilDue ?? 0)
          : lane === "scheduled"
            ? 48 - Math.min(daysUntilDue ?? 0, 30) / 2
            : lane === "unscheduled"
              ? 38
              : 0;

  return Math.round(laneScore + priorityBoost + typeBoost + sourceBoost + deferredPenalty);
}

export function buildRelationshipActionPlan<T extends RelationshipActionPlanningInput>(
  actions: T[],
  now = new Date(),
) {
  return actions
    .map((action) => ({
      action,
      daysUntilDue: daysUntilRelationshipActionDue(action.due_on, now),
      lane: relationshipActionLane(action, now),
      score: relationshipActionPriorityScore(action, now),
      urgencyLabel: relationshipActionUrgencyLabel(action, now),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.action.due_on ?? "9999-12-31").localeCompare(
          b.action.due_on ?? "9999-12-31",
        ) ||
        a.action.title.localeCompare(b.action.title),
    );
}

export function relationshipActionPlanSummary(
  actions: RelationshipActionPlanningInput[],
  now = new Date(),
) {
  const plan = buildRelationshipActionPlan(actions, now);

  return {
    total: actions.length,
    open: plan.filter((item) => item.lane !== "closed").length,
    overdue: plan.filter((item) => item.lane === "overdue").length,
    dueToday: plan.filter((item) => item.lane === "due_today").length,
    dueSoon: plan.filter((item) => item.lane === "due_soon").length,
    unscheduled: plan.filter((item) => item.lane === "unscheduled").length,
    closed: plan.filter((item) => item.lane === "closed").length,
    topAction: plan.find((item) => item.lane !== "closed") ?? null,
  };
}
