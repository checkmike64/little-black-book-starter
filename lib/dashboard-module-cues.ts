import type { ModuleKey } from "./modules.js";

export type DashboardModuleCueInput = {
  contactCount: number;
  duePromiseCount: number;
  contextReadiness: number;
  key: ModuleKey;
  openPromiseCount: number;
  pendingChangeCount: number;
  queuedJobCount: number;
  recentInteractionCount: number;
  staleUsefulContacts: number;
};

export type DashboardModuleCue = {
  metric: string;
  next: string;
  pressure: string;
};

export function moduleOperatingCue({
  contactCount,
  contextReadiness,
  duePromiseCount,
  key,
  openPromiseCount,
  pendingChangeCount,
  recentInteractionCount,
  staleUsefulContacts,
}: DashboardModuleCueInput): DashboardModuleCue {
  switch (key) {
    case "ask":
      return {
        metric: `${contactCount} searchable`,
        next: "Use natural-language questions to find warm paths, useful intros, and relationship context.",
        pressure:
          contextReadiness < 80
            ? "Some relationship context is still thin; verify judgment before acting."
            : "Ready for focused queries.",
      };
    case "networking":
      return {
        metric: `${openPromiseCount} open loops`,
        next:
          duePromiseCount > 0
            ? "Close due promises first; they are the highest trust-risk work."
            : "Inspect introductions, referral lanes, and high-value relationship flow.",
        pressure:
          duePromiseCount > 0
            ? `${duePromiseCount} promise${duePromiseCount === 1 ? "" : "s"} due now.`
            : "No due promise pressure detected.",
      };
    case "engagement":
      return {
        metric: `${staleUsefulContacts} rewarm candidates`,
        next:
          staleUsefulContacts > 0
            ? "Review stale high-value contacts and prepare light-touch reactivation."
            : "Use the engagement view to keep useful relationships warm before they go stale.",
        pressure:
          recentInteractionCount > 0
            ? `${recentInteractionCount} interactions available for rhythm analysis.`
            : "Interaction history will improve this lane.",
      };
    case "want_to_know":
      return {
        metric: `${pendingChangeCount} proposed update${pendingChangeCount === 1 ? "" : "s"}`,
        next: "Use this lane for people the executive wants to meet, research, or understand better.",
        pressure:
          pendingChangeCount > 0
            ? "Review new people and judgment-heavy updates before relying on them."
            : "No pending review pressure detected.",
      };
  }
}
