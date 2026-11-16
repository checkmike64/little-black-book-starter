import type { LaunchChecklistStatus } from "./client-launch-readiness.js";

export type DashboardOperatingHealthInput = {
  setupMode: boolean;
  deploymentReady: boolean;
  hasTenantContext: boolean;
  intakePercent: number;
  contactCount: number;
  enabledModuleCount: number;
  pendingChangeCount: number;
  duePromiseCount: number;
  queuedJobCount: number;
  askRunUndecidedCount: number;
  untrackedCommandOutputs: number;
  hotRelationshipActions: number;
  staleUsefulContacts: number;
};

export type DashboardOperatingHealthItem = {
  key: string;
  label: string;
  detail: string;
  href: string;
  status: LaunchChecklistStatus;
  tone: "hot" | "gold" | "cool";
};

function statusFrom(passed: boolean, hasPrerequisite = true): LaunchChecklistStatus {
  if (!hasPrerequisite) return "waiting";
  return passed ? "pass" : "action";
}

function itemTone(status: LaunchChecklistStatus): DashboardOperatingHealthItem["tone"] {
  if (status === "pass") return "cool";
  if (status === "waiting") return "gold";
  return "hot";
}

function buildItem(
  item: Omit<DashboardOperatingHealthItem, "tone">,
): DashboardOperatingHealthItem {
  return {
    ...item,
    tone: itemTone(item.status),
  };
}

export function buildDashboardOperatingHealth(input: DashboardOperatingHealthInput) {
  const items = [
    buildItem({
      key: "production",
      label: "Production wiring",
      detail:
        input.setupMode || !input.deploymentReady
          ? "Finish Vercel, Supabase, auth, and Claude environment checks before relying on the live install."
          : "Production wiring is present for the current environment.",
      href: "/deployment",
      status: statusFrom(!input.setupMode && input.deploymentReady),
    }),
    buildItem({
      key: "tenant",
      label: "Private tenant context",
      detail: input.hasTenantContext
        ? "This session is attached to a tenant-scoped book."
        : "Attach this user to a tenant membership so RLS protects the right private book.",
      href: "/settings",
      status: statusFrom(input.hasTenantContext),
    }),
    buildItem({
      key: "client-context",
      label: "Client operating context",
      detail:
        input.intakePercent >= 80
          ? `${input.intakePercent}% of the operator intake profile is complete.`
          : `Only ${input.intakePercent}% of the operator intake profile is complete; Claude will have less context for judgment-heavy work.`,
      href: "/intake",
      status: statusFrom(input.intakePercent >= 80, input.hasTenantContext),
    }),
    buildItem({
      key: "relationship-data",
      label: "Relationship data",
      detail:
        input.contactCount > 0
          ? `${input.contactCount} contact${input.contactCount === 1 ? "" : "s"} are available for the Book.`
          : "Seed at least one verified contact before testing Ask, movement, or Claude enrichment.",
      href: "/contacts",
      status: statusFrom(input.contactCount > 0, input.hasTenantContext),
    }),
    buildItem({
      key: "modules",
      label: "Enabled workflows",
      detail:
        input.enabledModuleCount > 0
          ? `${input.enabledModuleCount} owner-facing workflow${input.enabledModuleCount === 1 ? "" : "s"} are enabled.`
          : "Turn on the workflows that this client should actually see.",
      href: "/settings",
      status: statusFrom(input.enabledModuleCount > 0, input.hasTenantContext),
    }),
    buildItem({
      key: "review-pressure",
      label: "Review pressure",
      detail:
        input.pendingChangeCount > 0
          ? `${input.pendingChangeCount} proposed change${input.pendingChangeCount === 1 ? "" : "s"} need approval or rejection.`
          : "No pending Claude proposals are waiting for review.",
      href: "/changes",
      status: statusFrom(input.pendingChangeCount === 0, input.hasTenantContext),
    }),
    buildItem({
      key: "promise-pressure",
      label: "Promise pressure",
      detail:
        input.duePromiseCount > 0
          ? `${input.duePromiseCount} promise${input.duePromiseCount === 1 ? "" : "s"} are due now and can hurt trust if missed.`
          : "No due promise pressure is visible today.",
      href: "/promises",
      status: statusFrom(input.duePromiseCount === 0, input.contactCount > 0),
    }),
    buildItem({
      key: "claude-queue",
      label: "Claude queue",
      detail:
        input.queuedJobCount > 0
          ? `${input.queuedJobCount} Claude job${input.queuedJobCount === 1 ? "" : "s"} are queued or running.`
          : "No Claude jobs are currently in flight.",
      href: "/ops",
      status: statusFrom(input.queuedJobCount === 0, input.hasTenantContext),
    }),
    buildItem({
      key: "command-output",
      label: "Command output capture",
      detail:
        input.untrackedCommandOutputs > 0
          ? `${input.untrackedCommandOutputs} completed command output${input.untrackedCommandOutputs === 1 ? "" : "s"} should become movement or be dismissed.`
          : "Completed command outputs are either tracked or intentionally dismissed.",
      href: "/movement",
      status: statusFrom(input.untrackedCommandOutputs === 0, input.contactCount > 0),
    }),
    buildItem({
      key: "ask-decisions",
      label: "Ask decisions",
      detail:
        input.askRunUndecidedCount > 0
          ? `${input.askRunUndecidedCount} saved Ask run${input.askRunUndecidedCount === 1 ? "" : "s"} need a follow-up or no-action decision.`
          : "Saved Ask runs are closed-loop.",
      href: input.askRunUndecidedCount > 0 ? "/ask?saved=needs_decision" : "/ask",
      status: statusFrom(input.askRunUndecidedCount === 0, input.contactCount > 0),
    }),
    buildItem({
      key: "relationship-movement",
      label: "Relationship movement",
      detail:
        input.hotRelationshipActions > 0 || input.staleUsefulContacts > 0
          ? `${input.hotRelationshipActions} hot action${input.hotRelationshipActions === 1 ? "" : "s"} and ${input.staleUsefulContacts} stale useful contact${input.staleUsefulContacts === 1 ? "" : "s"} need attention.`
          : "No urgent movement pressure is visible.",
      href: "/movement",
      status: statusFrom(
        input.hotRelationshipActions === 0 && input.staleUsefulContacts === 0,
        input.contactCount > 0,
      ),
    }),
  ];

  const completed = items.filter((item) => item.status === "pass").length;
  const actionCount = items.filter((item) => item.status === "action").length;
  const waitingCount = items.filter((item) => item.status === "waiting").length;
  const score = Math.round((completed / items.length) * 100);
  const nextAction =
    items.find((item) => item.status === "action") ??
    items.find((item) => item.status === "waiting") ??
    items[0];

  return {
    items,
    completed,
    actionCount,
    waitingCount,
    score,
    total: items.length,
    nextAction,
    statusLabel:
      actionCount > 0
        ? "Needs attention"
        : waitingCount > 0
          ? "Waiting"
          : "Healthy",
  };
}
