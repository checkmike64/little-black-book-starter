import type {
  RelationshipActionPlanItem,
  RelationshipActionPlanningInput,
} from "./relationship-action-planning.js";
import type { RelationshipMovementItem } from "./relationship-movement.js";

type MovementSummary = {
  total: number;
  promises: number;
  introductions: number;
  rewarm: number;
  opportunities: number;
};

export type MovementCommand = {
  posture:
    | "clear"
    | "close_loop"
    | "work_timed_action"
    | "advance_intro"
    | "use_opportunity"
    | "schedule_action"
    | "decide_ask";
  tone: "hot" | "gold" | "cool";
  title: string;
  detail: string;
  primary: {
    href: string;
    label: string;
  };
  signals: Array<{
    label: string;
    value: number | string;
    tone: "hot" | "gold" | "cool";
  }>;
  supportingMoves: Array<{
    href: string;
    label: string;
    meta: string;
    tone: "hot" | "gold" | "cool" | "warn";
  }>;
  guardrail: string;
};

type MovementCommandInput<T extends RelationshipActionPlanningInput> = {
  actionPlan: Array<RelationshipActionPlanItem<T>>;
  movementQueue: RelationshipMovementItem[];
  movementSummary: MovementSummary;
  undecidedAskRuns: number;
};

export function movementCommandNextMoves(command: MovementCommand, limit = 4) {
  const primaryTitle = command.title.toLowerCase();

  return command.supportingMoves
    .filter((move) => !primaryTitle.includes(move.label.toLowerCase()))
    .slice(0, limit);
}

function toneFromLane(lane: string): "hot" | "gold" | "cool" {
  if (lane === "overdue" || lane === "due_today") return "hot";
  if (lane === "due_soon" || lane === "unscheduled") return "gold";
  return "cool";
}

function movementTone(tone: RelationshipMovementItem["tone"]): "hot" | "gold" | "cool" {
  return tone === "warn" ? "gold" : tone;
}

function signalTone(value: number, hotAt: number, goldAt = 1): "hot" | "gold" | "cool" {
  if (value >= hotAt) return "hot";
  if (value >= goldAt) return "gold";
  return "cool";
}

function movementLabel(item: RelationshipMovementItem) {
  if (item.kind === "promise") return "Promise";
  if (item.kind === "introduction") return "Introduction";
  if (item.kind === "opportunity") return "Opportunity";
  return "Rewarm";
}

function actionTone<T extends RelationshipActionPlanningInput>(
  item: RelationshipActionPlanItem<T>,
): "hot" | "gold" | "cool" | "warn" {
  if (item.action.priority === "high" || item.action.action_type === "owner_verification") {
    return "warn";
  }
  return toneFromLane(item.lane);
}

function actionHref<T extends RelationshipActionPlanningInput>(
  item: RelationshipActionPlanItem<T>,
) {
  if (item.lane === "overdue" || item.lane === "due_today") return "/movement?view=hot";
  if (item.action.priority === "high") return "/movement?view=high";
  if (item.lane === "unscheduled") return "/movement?view=needs_date";
  return "/movement";
}

export function buildMovementCommand<T extends RelationshipActionPlanningInput>({
  actionPlan,
  movementQueue,
  movementSummary,
  undecidedAskRuns,
}: MovementCommandInput<T>): MovementCommand {
  const openActions = actionPlan.filter((item) => item.lane !== "closed");
  const hotAction = openActions.find(
    (item) => item.lane === "overdue" || item.lane === "due_today",
  );
  const unscheduledAction = openActions.find((item) => item.lane === "unscheduled");
  const leadMovement = movementQueue[0] ?? null;
  const ownerPromise = movementQueue.find(
    (item) => item.kind === "promise" && item.actionKind === "complete_promise",
  );
  const introMove = movementQueue.find((item) => item.kind === "introduction");
  const opportunityMove = movementQueue.find((item) => item.kind === "opportunity");

  const signals = [
    {
      label: "Hot actions",
      value: actionPlan.filter(
        (item) => item.lane === "overdue" || item.lane === "due_today",
      ).length,
      tone: signalTone(
        actionPlan.filter(
          (item) => item.lane === "overdue" || item.lane === "due_today",
        ).length,
        3,
      ),
    },
    {
      label: "Promises",
      value: movementSummary.promises,
      tone: signalTone(movementSummary.promises, 2),
    },
    {
      label: "Intros",
      value: movementSummary.introductions,
      tone: signalTone(movementSummary.introductions, 3),
    },
    {
      label: "Opportunities",
      value: movementSummary.opportunities + movementSummary.rewarm,
      tone: signalTone(movementSummary.opportunities + movementSummary.rewarm, 5, 2),
    },
    {
      label: "Ask decisions",
      value: undecidedAskRuns,
      tone: signalTone(undecidedAskRuns, 5, 1),
    },
  ];

  const trackedActionMoves = openActions.slice(0, 3).map((item) => ({
    href: actionHref(item),
    label: item.action.title,
    meta: `${item.urgencyLabel} · ${item.action.action_type.replaceAll("_", " ")}`,
    tone: actionTone(item),
  }));
  const relationshipMoves = movementQueue.slice(0, 4).map((item) => ({
    href: item.href,
    label: item.title,
    meta: `${movementLabel(item)} · ${item.detail}`,
    tone: item.tone,
  }));
  const supportingMoves = [...trackedActionMoves, ...relationshipMoves]
    .filter(
      (move, index, moves) =>
        moves.findIndex((candidate) => candidate.href === move.href && candidate.label === move.label) ===
        index,
    )
    .slice(0, 5);

  if (ownerPromise) {
    return {
      posture: "close_loop",
      tone: movementTone(ownerPromise.tone),
      title: `Close the loop: ${ownerPromise.title}`,
      detail: ownerPromise.reason,
      primary: { href: ownerPromise.href, label: ownerPromise.action },
      signals,
      supportingMoves,
      guardrail:
        "Owner promises come before prospecting, enrichment, or more Claude-generated work because they directly affect trust.",
    };
  }

  if (hotAction && (!leadMovement || hotAction.score >= leadMovement.score - 10)) {
    return {
      posture: "work_timed_action",
      tone: toneFromLane(hotAction.lane),
      title: hotAction.action.title,
      detail: `${hotAction.urgencyLabel} · ${hotAction.action.action_type.replaceAll(
        "_",
        " ",
      )}`,
      primary: { href: "/movement?view=hot", label: "Work hot queue" },
      signals,
      supportingMoves,
      guardrail:
        "Work dated relationship actions before browsing the book; the queue is already telling us what has time pressure.",
    };
  }

  if (introMove) {
    return {
      posture: "advance_intro",
      tone: movementTone(introMove.tone),
      title: `Move the introduction: ${introMove.title}`,
      detail: introMove.reason,
      primary: { href: introMove.href, label: introMove.action },
      signals,
      supportingMoves,
      guardrail:
        "Introductions need outcome tracking so the book learns what actually happened, not just what was proposed.",
    };
  }

  if (opportunityMove) {
    return {
      posture: "use_opportunity",
      tone: movementTone(opportunityMove.tone),
      title: `Use the opportunity: ${opportunityMove.title}`,
      detail: opportunityMove.detail,
      primary: { href: opportunityMove.href, label: opportunityMove.action },
      signals,
      supportingMoves,
      guardrail:
        "Use the stored ask, referral lane, or outreach fit before creating a fresh prospecting list.",
    };
  }

  if (leadMovement) {
    return {
      posture: leadMovement.kind === "rewarm" ? "use_opportunity" : "close_loop",
      tone: movementTone(leadMovement.tone),
      title: leadMovement.title,
      detail: leadMovement.reason,
      primary: { href: leadMovement.href, label: leadMovement.action },
      signals,
      supportingMoves,
      guardrail:
        "Keep the relationship cadence light and specific; one useful touch beats a generic check-in.",
    };
  }

  if (unscheduledAction) {
    return {
      posture: "schedule_action",
      tone: "gold",
      title: `Give this move a date: ${unscheduledAction.action.title}`,
      detail:
        "This action is useful enough to track but too easy to lose because it has no due date.",
      primary: { href: "/movement?view=needs_date", label: "Schedule actions" },
      signals,
      supportingMoves,
      guardrail:
        "A move without a date should either get scheduled, deferred intentionally, or closed.",
    };
  }

  if (undecidedAskRuns > 0) {
    return {
      posture: "decide_ask",
      tone: "gold",
      title: "Decide the saved Ask runs",
      detail:
        "Saved Ask runs are waiting for a follow-up/no-action decision before they become operating truth.",
      primary: { href: "/ask?saved=needs_decision", label: "Review Ask runs" },
      signals,
      supportingMoves,
      guardrail:
        "Do not let answered questions become silent obligations; decide whether each result deserves action.",
    };
  }

  return {
    posture: "clear",
    tone: "cool",
    title: "No urgent movement queued",
    detail:
      "Promises, introductions, stale high-value relationships, and timed actions are clear right now.",
    primary: { href: "/contacts", label: "Open book" },
    signals,
    supportingMoves,
    guardrail:
      "Use this quiet state for targeted prospecting, enrichment review, or one high-value relationship touch.",
  };
}
