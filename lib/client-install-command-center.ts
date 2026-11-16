import type { ClientInstallQuestion } from "./client-install-questions.js";
import type { AcceptanceItem } from "./install-acceptance.js";
import type { LaunchActionPlanItem } from "./client-launch-readiness.js";

export type ClientInstallCommandCenterInput = {
  tenantName: string;
  contactCount: number;
  enabledModules: string[];
  prospectingBucketCount: number;
  highValueWeakCount: number;
  pendingReviewCount: number;
  askRunCount: number;
  askRunUndecidedCount: number;
  commandJobCount: number;
  rehearsalComplete: boolean;
  launchReady: boolean;
  launchNotesReady: boolean;
  deploymentReady: boolean;
  productionSignoffReady: boolean;
  operatorQuestions: ClientInstallQuestion[];
  launchNextActions: LaunchActionPlanItem[];
  moduleProofItems?: AcceptanceItem[];
};

export type ClientInstallCommandStage =
  | "configure"
  | "prove"
  | "review"
  | "handoff"
  | "ready";

export type ClientInstallCommandTile = {
  label: string;
  value: string;
  tone: "ok" | "warn" | "neutral";
  detail: string;
};

export type ClientInstallSprint = {
  lane: "configure" | "data" | "proof" | "handoff";
  label: string;
  detail: string;
  href: string;
  priority: "critical" | "important" | "useful";
};

export type ClaudeFirstJob = {
  label: string;
  detail: string;
  href: string;
};

export type ClientInstallModuleProof = {
  key: string;
  label: string;
  detail: string;
  status: "pass" | "action" | "waiting";
  href: string;
};

function priorityRank(priority: ClientInstallSprint["priority"]) {
  if (priority === "critical") return 3;
  if (priority === "important") return 2;
  return 1;
}

function includesModule(modules: string[], pattern: RegExp) {
  return modules.some((module) => pattern.test(module.toLowerCase()));
}

function buildStage(input: ClientInstallCommandCenterInput): ClientInstallCommandStage {
  const criticalQuestions = input.operatorQuestions.filter(
    (question) => question.priority === "critical",
  );

  if (input.launchReady) return "ready";
  if (!input.deploymentReady || input.contactCount === 0 || criticalQuestions.length > 0) {
    return "configure";
  }
  if (
    input.highValueWeakCount > 0 ||
    input.pendingReviewCount > 0 ||
    input.askRunUndecidedCount > 0
  ) {
    return "review";
  }
  if (
    input.commandJobCount === 0 ||
    input.askRunCount === 0 ||
    !input.rehearsalComplete
  ) {
    return "prove";
  }
  return "handoff";
}

function stageCopy(stage: ClientInstallCommandStage, tenantName: string) {
  if (stage === "ready") {
    return {
      title: `${tenantName} is ready for owner handoff`,
      detail:
        "Launch evidence is complete. Keep the final walkthrough focused on the enabled workflows and the owner's actual relationship goals.",
    };
  }

  if (stage === "configure") {
    return {
      title: "Configure the install before proving workflows",
      detail:
        "Lock the client thesis, module promise, tenant wiring, and first data source before adding more automation.",
    };
  }

  if (stage === "review") {
    return {
      title: "Clear trust-sensitive review pressure",
      detail:
        "Resolve weak high-value records, pending proposals, and undecided Ask runs before the owner relies on the Book.",
    };
  }

  if (stage === "prove") {
    return {
      title: "Prove the operating loop with real data",
      detail:
        "Run representative Ask, Claude command, and rehearsal flows so the handoff is based on evidence, not just configuration.",
    };
  }

  return {
    title: "Package the handoff and final checks",
    detail:
      "The core system is mostly proven. Finish production signoff and durable launch notes before handing over the URL.",
  };
}

function buildSprints(input: ClientInstallCommandCenterInput): ClientInstallSprint[] {
  const sprints: ClientInstallSprint[] = [];

  for (const question of input.operatorQuestions.slice(0, 4)) {
    sprints.push({
      lane: "configure",
      label: question.question,
      detail: question.why,
      href: question.href,
      priority: question.priority,
    });
  }

  if (input.contactCount === 0) {
    sprints.push({
      lane: "data",
      label: "Seed the first real relationship records",
      detail:
        "Use a contacts export, transcript history, or curated owner list so every downstream workflow has real context.",
      href: "/contacts",
      priority: "critical",
    });
  }

  if (input.highValueWeakCount > 0) {
    sprints.push({
      lane: "data",
      label: "Clean high-value relationship records",
      detail: `${input.highValueWeakCount} high-value record${
        input.highValueWeakCount === 1 ? "" : "s"
      } need verification before referral or outreach decisions.`,
      href: "/quality",
      priority: "critical",
    });
  }

  if (input.pendingReviewCount > 0) {
    sprints.push({
      lane: "proof",
      label: "Resolve the pending change queue",
      detail: `${input.pendingReviewCount} proposed update${
        input.pendingReviewCount === 1 ? "" : "s"
      } should be approved, edited, or dismissed before handoff.`,
      href: "/changes",
      priority: "important",
    });
  }

  if (input.askRunCount === 0 && input.contactCount > 0) {
    sprints.push({
      lane: "proof",
      label: "Run one real Ask query",
      detail:
        "Use a question the owner is likely to ask in week one, then save the resulting decision.",
      href: "/ask",
      priority: "important",
    });
  }

  if (input.commandJobCount === 0 && input.contactCount > 0) {
    sprints.push({
      lane: "proof",
      label: "Run one Claude command job",
      detail:
        "Prove that Claude output lands back in the Book as reviewable, trackable relationship work.",
      href: "/ops",
      priority: "important",
    });
  }

  if (!input.rehearsalComplete && input.commandJobCount > 0) {
    sprints.push({
      lane: "proof",
      label: "Close the launch rehearsal",
      detail:
        "Claim a job, complete it, turn output into a tracked action, and close the action as launch evidence.",
      href: "/launch",
      priority: "important",
    });
  }

  if (!input.productionSignoffReady || !input.launchNotesReady) {
    sprints.push({
      lane: "handoff",
      label: "Finish production signoff and launch notes",
      detail:
        "Capture the final privacy checks and the client-specific operating notes before sharing the production URL.",
      href: input.productionSignoffReady ? "/settings" : "/deployment",
      priority: "useful",
    });
  }

  for (const action of input.launchNextActions.slice(0, 3)) {
    sprints.push({
      lane: action.lane === "fix_now" ? "proof" : "handoff",
      label: action.label,
      detail: action.detail,
      href: action.href,
      priority: action.lane === "fix_now" ? "important" : "useful",
    });
  }

  const seen = new Set<string>();
  return sprints
    .filter((sprint) => {
      const key = `${sprint.href}:${sprint.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        priorityRank(b.priority) - priorityRank(a.priority) ||
        a.label.localeCompare(b.label),
    )
    .slice(0, 6);
}

function buildClaudeJobs(input: ClientInstallCommandCenterInput): ClaudeFirstJob[] {
  const jobs: ClaudeFirstJob[] = [];

  if (input.contactCount === 0) {
    jobs.push({
      label: "Import first relationship set",
      detail:
        "Convert a small verified source batch into contacts, interactions, promises, and pending changes.",
      href: "/claude-setup",
    });
  }

  if (input.highValueWeakCount > 0) {
    jobs.push({
      label: "Prepare high-value cleanup",
      detail:
        "Queue source-backed enrichment for the highest-value weak records while keeping judgment fields in review.",
      href: "/quality",
    });
  }

  if (
    includesModule(input.enabledModules, /want to know|prospecting/) &&
    input.prospectingBucketCount > 0
  ) {
    jobs.push({
      label: "Seed each prospecting bucket",
      detail:
        "Add one verified candidate per configured bucket so the outer-ring workflow is visible and testable.",
      href: "/want-to-know",
    });
  }

  if (input.contactCount > 0 && input.commandJobCount === 0) {
    jobs.push({
      label: "Run relationship prep command",
      detail:
        "Use one representative contact to prove Claude prep, review, movement capture, and dashboard evidence.",
      href: "/ops",
    });
  }

  if (input.askRunCount === 0 && input.contactCount > 0) {
    jobs.push({
      label: "Draft the first Ask proof query",
      detail:
        "Use the client thesis to choose one week-one query and save the follow-up/no-action decision.",
      href: "/ask",
    });
  }

  return jobs.slice(0, 4);
}

function buildModuleProof(input: ClientInstallCommandCenterInput) {
  return (input.moduleProofItems ?? [])
    .filter((item) => item.key.startsWith("module-"))
    .map((item) => ({
      key: item.key,
      label: item.label.replace(" module is proven", ""),
      detail: item.detail,
      status: item.status,
      href: item.href,
    })) satisfies ClientInstallModuleProof[];
}

export function buildClientInstallCommandCenter(
  input: ClientInstallCommandCenterInput,
) {
  const stage = buildStage(input);
  const copy = stageCopy(stage, input.tenantName);
  const moduleProof = buildModuleProof(input);
  const criticalQuestions = input.operatorQuestions.filter(
    (question) => question.priority === "critical",
  ).length;
  const modulesReady = input.enabledModules.length > 0;
  const moduleProofCompleted = moduleProof.filter(
    (item) => item.status === "pass",
  ).length;
  const proofCount = [
    input.askRunCount > 0,
    input.commandJobCount > 0,
    input.rehearsalComplete,
  ].filter(Boolean).length;

  const tiles: ClientInstallCommandTile[] = [
    {
      label: "Client configuration",
      value: criticalQuestions === 0 && modulesReady ? "Strong" : "Needs input",
      tone: criticalQuestions === 0 && modulesReady ? "ok" : "warn",
      detail: `${input.enabledModules.length} module${
        input.enabledModules.length === 1 ? "" : "s"
      } enabled; ${criticalQuestions} critical question${
        criticalQuestions === 1 ? "" : "s"
      } open.`,
    },
    {
      label: "Relationship data",
      value: input.contactCount > 0 ? `${input.contactCount}` : "Missing",
      tone: input.contactCount > 0 && input.highValueWeakCount === 0 ? "ok" : "warn",
      detail:
        input.highValueWeakCount > 0
          ? `${input.highValueWeakCount} high-value weak record${
              input.highValueWeakCount === 1 ? "" : "s"
            } need cleanup.`
          : "Ready for proof checks.",
    },
    {
      label: "Operating proof",
      value: `${proofCount}/3`,
      tone: proofCount === 3 ? "ok" : proofCount > 0 ? "neutral" : "warn",
      detail: "Ask proof, command output proof, and launch rehearsal.",
    },
    {
      label: "Module proof",
      value: moduleProof.length > 0 ? `${moduleProofCompleted}/${moduleProof.length}` : "None",
      tone:
        moduleProof.length === 0
          ? "neutral"
          : moduleProofCompleted === moduleProof.length
            ? "ok"
            : moduleProofCompleted > 0
              ? "neutral"
              : "warn",
      detail: "Enabled workflows with their own launch evidence.",
    },
    {
      label: "Handoff controls",
      value:
        input.productionSignoffReady && input.launchNotesReady ? "Ready" : "Open",
      tone: input.productionSignoffReady && input.launchNotesReady ? "ok" : "neutral",
      detail:
        "Production signoff and launch notes are the final concierge handoff guardrails.",
    },
  ];

  return {
    stage,
    title: copy.title,
    detail: copy.detail,
    tiles,
    moduleProof,
    sprints: buildSprints(input),
    claudeFirstJobs: buildClaudeJobs(input),
  };
}
