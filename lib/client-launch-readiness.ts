import type { AcceptanceItem } from "./install-acceptance.js";

export type LaunchChecklistStatus = "pass" | "action" | "waiting";

export type LaunchChecklistItem = {
  key: string;
  label: string;
  detail: string;
  status: LaunchChecklistStatus;
  href: string;
};

export type LaunchActionPlanItem = LaunchChecklistItem & {
  rank: number;
  lane: "fix_now" | "waiting";
};

export type LaunchEvidence = {
  deploymentReady: boolean;
  deploymentBlockingCount: number;
  tenantReady: boolean;
  contactCount: number;
  qualityAverage: number;
  weakRecordCount: number;
  highValueWeakCount: number;
  installPlanPercent: number;
  installPlanBlocked: number;
  enabledModuleCount: number;
  moduleProofItems: AcceptanceItem[];
  acceptanceReady: boolean;
  acceptanceCompleted: number;
  acceptanceTotal: number;
  acceptanceNextAction: AcceptanceItem;
  pendingReviewCount: number;
  reviewQueueComplete: boolean;
  commandJobCount: number;
  rehearsalJobSucceeded: boolean;
  rehearsalActionClosed: boolean;
  askRunCount: number;
  askRunUndecidedCount: number;
  launchNotesReady: boolean;
  noindexReady: boolean;
};

function statusFrom(passed: boolean, hasPrerequisite = true): LaunchChecklistStatus {
  if (passed) return "pass";
  return hasPrerequisite ? "action" : "waiting";
}

export function buildClientLaunchChecklist(evidence: LaunchEvidence) {
  const rehearsalComplete =
    evidence.rehearsalJobSucceeded && evidence.rehearsalActionClosed;
  const moduleProofCompleted = evidence.moduleProofItems.filter(
    (item) => item.status === "pass",
  ).length;
  const moduleProofNextAction =
    evidence.moduleProofItems.find((item) => item.status === "action") ??
    evidence.moduleProofItems.find((item) => item.status === "waiting") ??
    null;
  const moduleProofReady =
    evidence.enabledModuleCount > 0 &&
    evidence.moduleProofItems.length > 0 &&
    moduleProofCompleted === evidence.moduleProofItems.length;
  const items: LaunchChecklistItem[] = [
    {
      key: "deployment",
      label: "Production environment is configured",
      detail: evidence.deploymentReady
        ? "Required Vercel, Supabase, auth, and Claude variables are present."
        : `${evidence.deploymentBlockingCount} deployment input${
            evidence.deploymentBlockingCount === 1 ? "" : "s"
          } still need attention.`,
      status: statusFrom(evidence.deploymentReady),
      href: "/deployment",
    },
    {
      key: "tenant",
      label: "Tenant isolation is active",
      detail: evidence.tenantReady
        ? "The signed-in operator is attached to a tenant-scoped install."
        : "Create or repair the tenant membership before launch.",
      status: statusFrom(evidence.tenantReady),
      href: "/settings",
    },
    {
      key: "contacts",
      label: "Client relationship data is present",
      detail:
        evidence.contactCount > 0
          ? `${evidence.contactCount} contact${
              evidence.contactCount === 1 ? "" : "s"
            } are available for live checks.`
          : "Import or seed at least one real contact before launch rehearsal.",
      status: statusFrom(evidence.contactCount > 0, evidence.tenantReady),
      href: "/contacts",
    },
    {
      key: "data-quality",
      label: "Relationship data is handoff-safe",
      detail:
        evidence.highValueWeakCount > 0
          ? `${evidence.highValueWeakCount} high-value record${
              evidence.highValueWeakCount === 1 ? "" : "s"
            } need cleanup before the Book should guide referrals or outreach.`
          : evidence.weakRecordCount > 0
            ? `${evidence.weakRecordCount} weak record${
                evidence.weakRecordCount === 1 ? "" : "s"
              } remain; average readiness is ${evidence.qualityAverage}%.`
            : `Average readiness is ${evidence.qualityAverage}% with no weak records flagged.`,
      status: statusFrom(
        evidence.qualityAverage >= 75 && evidence.highValueWeakCount === 0,
        evidence.contactCount > 0,
      ),
      href: "/quality",
    },
    {
      key: "operator-plan",
      label: "Operator setup plan is strong enough",
      detail:
        evidence.installPlanBlocked > 0
          ? "A setup plan item is blocked."
          : `${evidence.installPlanPercent}% of the client install plan is ready.`,
      status: statusFrom(
        evidence.installPlanBlocked === 0 && evidence.installPlanPercent >= 80,
        evidence.tenantReady,
      ),
      href: "/deployment",
    },
    {
      key: "modules",
      label: "Owner-facing modules are intentional",
      detail:
        evidence.enabledModuleCount > 0
          ? `${evidence.enabledModuleCount} owner-facing module${
              evidence.enabledModuleCount === 1 ? "" : "s"
            } are enabled for this install.`
          : "Enable the owner-facing workflows that were sold into this install.",
      status: statusFrom(evidence.enabledModuleCount > 0, evidence.tenantReady),
      href: "/settings",
    },
    {
      key: "module-proof",
      label: "Enabled workflows have proof",
      detail:
        evidence.enabledModuleCount === 0
          ? "Enable the client-specific owner workflows before proving module behavior."
          : moduleProofReady
            ? `${moduleProofCompleted}/${evidence.moduleProofItems.length} enabled workflow proof checks pass.`
            : moduleProofNextAction
              ? `${moduleProofCompleted}/${evidence.moduleProofItems.length} enabled workflow proof checks pass. Next: ${moduleProofNextAction.label}.`
              : "Enabled modules are present, but workflow proof checks were not generated.",
      status:
        evidence.enabledModuleCount === 0
          ? "waiting"
          : moduleProofReady
            ? "pass"
            : moduleProofNextAction?.status ?? "action",
      href: moduleProofNextAction?.href ?? "/settings",
    },
    {
      key: "acceptance",
      label: "Claude and review lanes are proven",
      detail: evidence.acceptanceReady
        ? "Claude writes, pending review, audit, provenance, and prospecting review have evidence."
        : `${evidence.acceptanceCompleted}/${evidence.acceptanceTotal} acceptance checks pass. Next: ${evidence.acceptanceNextAction.label}.`,
      status: statusFrom(evidence.acceptanceReady, evidence.contactCount > 0),
      href: evidence.acceptanceReady ? "/ops" : evidence.acceptanceNextAction.href,
    },
    {
      key: "command-output",
      label: "Command output lands in the Book",
      detail:
        evidence.commandJobCount > 0
          ? `${evidence.commandJobCount} completed command job${
              evidence.commandJobCount === 1 ? "" : "s"
            } with output are available for dashboard/contact evidence.`
          : "Run a command job so the app proves Claude outputs are visible after completion.",
      status: statusFrom(evidence.commandJobCount > 0, evidence.contactCount > 0),
      href: "/ops",
    },
    {
      key: "rehearsal",
      label: "Launch rehearsal closes the full loop",
      detail: rehearsalComplete
        ? "A launch rehearsal has claimed a job, completed it, created a tracked action, and closed it."
        : "Run the launch rehearsal below to prove the live job-to-action lifecycle.",
      status: statusFrom(rehearsalComplete, evidence.commandJobCount > 0),
      href: "/launch",
    },
    {
      key: "ask",
      label: "Ask queries are closed-loop",
      detail:
        evidence.askRunCount === 0
          ? "Run at least one Ask search before handoff so the query surface is proven."
          : evidence.askRunUndecidedCount > 0
            ? `${evidence.askRunUndecidedCount} saved Ask run${
                evidence.askRunUndecidedCount === 1 ? "" : "s"
              } need a follow-up or no-action decision.`
            : `${evidence.askRunCount} Ask run${
              evidence.askRunCount === 1 ? "" : "s"
            } are saved with decisions for operational audit.`,
      status: statusFrom(
        evidence.askRunCount > 0 && evidence.askRunUndecidedCount === 0,
        evidence.contactCount > 0,
      ),
      href: evidence.askRunUndecidedCount > 0 ? "/ask?saved=needs_decision" : "/ask",
    },
    {
      key: "review-pressure",
      label: "Review queue is under control",
      detail:
        !evidence.reviewQueueComplete
          ? "The pending review queue could not be reconciled. It is not treated as clear."
          : evidence.pendingReviewCount === 0
          ? "No pending review items are blocking handoff."
          : `${evidence.pendingReviewCount} pending change${
              evidence.pendingReviewCount === 1 ? "" : "s"
            } need a decision or operator repair before launch.`,
      status: evidence.reviewQueueComplete
        ? statusFrom(evidence.pendingReviewCount === 0, evidence.tenantReady)
        : "waiting",
      href: "/changes",
    },
    {
      key: "privacy",
      label: "Private/noindex posture is in place",
      detail: evidence.noindexReady
        ? "The app metadata blocks indexing, private data remains behind auth/RLS, and production signoff is confirmed."
        : "Confirm noindex metadata, auth redirects, RLS, Claude token scoping, and production signoff before handoff.",
      status: statusFrom(evidence.noindexReady),
      href: "/deployment",
    },
    {
      key: "handoff-notes",
      label: "Launch notes are ready",
      detail: evidence.launchNotesReady
        ? "Operator launch notes are stored for this client install."
        : "Add concise launch notes for the exact workflows enabled for this executive.",
      status: statusFrom(evidence.launchNotesReady, evidence.tenantReady),
      href: "/settings",
    },
  ];

  const completed = items.filter((item) => item.status === "pass").length;
  const actionCount = items.filter((item) => item.status === "action").length;
  const waitingCount = items.filter((item) => item.status === "waiting").length;
  const nextAction =
    items.find((item) => item.status === "action") ??
    items.find((item) => item.status === "waiting") ??
    items[0];

  return {
    items,
    completed,
    actionCount,
    waitingCount,
    total: items.length,
    ready: completed === items.length,
    nextAction,
    statusLabel:
      completed === items.length
        ? "Ready"
        : actionCount > 0
          ? "Needs work"
          : "Waiting",
  };
}

const launchActionRank: Record<string, number> = {
  deployment: 100,
  tenant: 95,
  contacts: 90,
  modules: 85,
  "module-proof": 83,
  "data-quality": 80,
  "review-pressure": 78,
  acceptance: 75,
  "command-output": 70,
  rehearsal: 65,
  ask: 55,
  "operator-plan": 50,
  privacy: 45,
  "handoff-notes": 30,
};

export function buildLaunchActionPlan(
  items: LaunchChecklistItem[],
  limit = 5,
) {
  const ranked = items
    .filter((item) => item.status !== "pass")
    .map((item) => ({
      ...item,
      rank: launchActionRank[item.key] ?? 0,
      lane: item.status === "action" ? "fix_now" : "waiting",
    }) satisfies LaunchActionPlanItem)
    .sort(
      (a, b) =>
        Number(b.lane === "fix_now") - Number(a.lane === "fix_now") ||
        b.rank - a.rank ||
        a.label.localeCompare(b.label),
    );

  const fixNow = ranked.filter((item) => item.lane === "fix_now");
  const waiting = ranked.filter((item) => item.lane === "waiting");
  const next = ranked.slice(0, Math.max(1, limit));

  return {
    fixNow,
    waiting,
    next,
    summary:
      ranked.length === 0
        ? "Launch evidence is complete."
        : `${fixNow.length} fix-now item${fixNow.length === 1 ? "" : "s"} and ${
            waiting.length
          } waiting item${waiting.length === 1 ? "" : "s"} remain.`,
  };
}
