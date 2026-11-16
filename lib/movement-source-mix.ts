export type MovementSourceAction = {
  action_type?: string | null;
  metadata?: Record<string, unknown> | null;
  source?: string | null;
  status?: string | null;
};

export type MovementSourceTone = "cool" | "gold" | "hot";

const claudeActionSources = new Set([
  "claude_command_output",
  "claude_command",
  "command_job",
]);

const closedStatuses = new Set(["done", "skipped", "stopped", "completed"]);

function metadataString(action: MovementSourceAction, key: string) {
  const value = action.metadata?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function isAskCreatedAction(action: MovementSourceAction) {
  return action.source === "ask_run_decision" || Boolean(metadataString(action, "ask_run_id"));
}

export function isClaudeCreatedAction(action: MovementSourceAction) {
  return (
    (action.source ? claudeActionSources.has(action.source) : false) ||
    Boolean(metadataString(action, "job_id")) ||
    Boolean(metadataString(action, "command_label"))
  );
}

export function isOwnerVerificationAction(action: MovementSourceAction) {
  return action.action_type === "owner_verification";
}

export function isOpenMovementAction(action: MovementSourceAction) {
  return !closedStatuses.has(action.status ?? "");
}

export function movementActionSourceLabel(action: MovementSourceAction): {
  detail: string;
  href: string;
  label: string;
  tone: MovementSourceTone;
} {
  if (isAskCreatedAction(action)) {
    return {
      detail: "Saved from a Book search.",
      href: "/movement?view=from_ask",
      label: "Saved search",
      tone: "gold",
    };
  }

  if (isClaudeCreatedAction(action)) {
    return {
      detail: "Prepared for your review.",
      href: "/movement?view=from_claude",
      label: "Suggested",
      tone: "hot",
    };
  }

  if (
    action.source === "dashboard_priority" ||
    action.source === "dashboard_weekly_engagement"
  ) {
    return {
      detail: "Added from Today.",
      href: "/movement?view=active",
      label: "From Today",
      tone: "cool",
    };
  }

  return {
    detail: "Added directly to your follow-ups.",
    href: "/movement?view=active",
    label: action.source ? action.source.replaceAll("_", " ") : "Manual",
    tone: "cool",
  };
}

export function buildMovementSourceMix(actions: MovementSourceAction[]) {
  const openActions = actions.filter(isOpenMovementAction);
  const ask = openActions.filter(isAskCreatedAction).length;
  const claude = openActions.filter(isClaudeCreatedAction).length;
  const ownerVerification = openActions.filter(isOwnerVerificationAction).length;
  const generated = ask + claude;
  const manual = openActions.filter(
    (action) => !isAskCreatedAction(action) && !isClaudeCreatedAction(action),
  ).length;

  const primary =
    generated > 0
      ? {
          detail:
            "Suggested follow-ups are waiting for you.",
          href: ask >= claude ? "/movement?view=from_ask" : "/movement?view=from_claude",
          label: "Suggested follow-ups",
          tone: "hot" as const,
          value: generated,
        }
      : ownerVerification > 0
        ? {
            detail: "A few items need your review.",
            href: "/movement?view=high",
            label: "Review needed",
            tone: "gold" as const,
            value: ownerVerification,
          }
        : manual > 0
          ? {
              detail: "Follow-ups you added are still open.",
              href: "/movement?view=active",
              label: "Your follow-ups",
              tone: "cool" as const,
              value: manual,
            }
          : {
              detail: "No follow-ups are waiting.",
              href: "/movement?view=active",
              label: "All clear",
              tone: "cool" as const,
              value: 0,
            };

  return {
    ask,
    claude,
    generated,
    manual,
    open: openActions.length,
    ownerVerification,
    primary,
  };
}

export function buildMovementSourceLanes(
  mix: ReturnType<typeof buildMovementSourceMix>,
) {
  return [
    {
      detail: "Items saved from Book searches.",
      href: "/movement?view=from_ask",
      label: "Saved",
      tone: "gold" as const,
      value: mix.ask,
    },
    {
      detail: "Suggestions waiting for follow-through.",
      href: "/movement?view=from_claude",
      label: "Suggested",
      tone: "hot" as const,
      value: mix.claude,
    },
    {
      detail: "Follow-ups you added.",
      href: "/movement?view=active",
      label: "Added by you",
      tone: "cool" as const,
      value: mix.manual,
    },
    {
      detail: "Items that need your decision.",
      href: "/movement?view=high",
      label: "Verify",
      tone: "gold" as const,
      value: mix.ownerVerification,
    },
  ].filter((lane) => lane.value > 0);
}
