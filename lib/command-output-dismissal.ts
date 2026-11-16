export type CommandOutputDismissal = {
  dismissedAt: string;
  dismissedBy: string | null;
  reason: string | null;
};

export function commandOutputDismissal(
  result: Record<string, unknown>,
): CommandOutputDismissal | null {
  const dismissedAt = result.command_output_dismissed_at;
  if (typeof dismissedAt !== "string" || !dismissedAt.trim()) return null;

  const dismissedBy = result.command_output_dismissed_by;
  const reason = result.command_output_dismissed_reason;

  return {
    dismissedAt: dismissedAt.trim(),
    dismissedBy: typeof dismissedBy === "string" && dismissedBy.trim() ? dismissedBy : null,
    reason: typeof reason === "string" && reason.trim() ? reason.trim() : null,
  };
}

export function isCommandOutputDismissed(result: Record<string, unknown>) {
  return Boolean(commandOutputDismissal(result));
}
