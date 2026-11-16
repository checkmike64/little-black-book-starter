import type { ClientInstallQuestion } from "./client-install-questions.js";
import type { LaunchChecklistItem } from "./client-launch-readiness.js";
import type { AcceptanceItem } from "./install-acceptance.js";

export type ClientInstallPlaybookStatus = "done" | "active" | "waiting" | "blocked";

export type ClientInstallPlaybookPhase = {
  key: string;
  label: string;
  objective: string;
  exitCriteria: string;
  status: ClientInstallPlaybookStatus;
  href: string;
  evidence: string[];
  nextStep: string;
};

export type ClientInstallPlaybookInput = {
  launchItems: LaunchChecklistItem[];
  acceptanceItems: AcceptanceItem[];
  operatorQuestions: ClientInstallQuestion[];
};

function itemStatus(items: LaunchChecklistItem[], key: string) {
  return items.find((item) => item.key === key)?.status ?? "waiting";
}

function acceptanceStatus(items: AcceptanceItem[], key: string) {
  return items.find((item) => item.key === key)?.status ?? "waiting";
}

function isPass(status: string) {
  return status === "pass";
}

function hasAction(...statuses: string[]) {
  return statuses.some((status) => status === "action");
}

function hasWaiting(...statuses: string[]) {
  return statuses.some((status) => status === "waiting");
}

function evidenceLine(label: string, status: string) {
  return `${label}: ${status}`;
}

function phaseStatus({
  passed,
  blocked,
  waiting,
}: {
  passed: boolean;
  blocked?: boolean;
  waiting?: boolean;
}): ClientInstallPlaybookStatus {
  if (passed) return "done";
  if (blocked) return "blocked";
  if (waiting) return "waiting";
  return "active";
}

export function buildClientInstallPlaybook({
  launchItems,
  acceptanceItems,
  operatorQuestions,
}: ClientInstallPlaybookInput) {
  const criticalQuestions = operatorQuestions.filter(
    (question) => question.priority === "critical",
  );
  const deployment = itemStatus(launchItems, "deployment");
  const tenant = itemStatus(launchItems, "tenant");
  const modules = itemStatus(launchItems, "modules");
  const operatorPlan = itemStatus(launchItems, "operator-plan");
  const contacts = itemStatus(launchItems, "contacts");
  const dataQuality = itemStatus(launchItems, "data-quality");
  const acceptance = itemStatus(launchItems, "acceptance");
  const commandOutput = itemStatus(launchItems, "command-output");
  const reviewPressure = itemStatus(launchItems, "review-pressure");
  const ask = itemStatus(launchItems, "ask");
  const rehearsal = itemStatus(launchItems, "rehearsal");
  const privacy = itemStatus(launchItems, "privacy");
  const handoffNotes = itemStatus(launchItems, "handoff-notes");
  const testJobCreated = acceptanceStatus(acceptanceItems, "test-job-created");
  const testJobClaimed = acceptanceStatus(acceptanceItems, "test-job-claimed");
  const testJobCompleted = acceptanceStatus(acceptanceItems, "test-job-completed");
  const lowRiskReview = acceptanceStatus(acceptanceItems, "low-risk-review");
  const auditProvenance = acceptanceStatus(acceptanceItems, "audit-provenance");

  const configureDone =
    [deployment, tenant, modules, operatorPlan].every(isPass) &&
    criticalQuestions.length === 0;
  const dataDone = isPass(contacts) && isPass(dataQuality);
  const claudeDone =
    isPass(acceptance) &&
    isPass(commandOutput) &&
    [testJobCreated, testJobClaimed, testJobCompleted].every(isPass);
  const reviewDone =
    isPass(reviewPressure) && isPass(ask) && isPass(lowRiskReview) && isPass(auditProvenance);
  const rehearsalDone = isPass(rehearsal);
  const handoffDone = isPass(privacy) && isPass(handoffNotes) && rehearsalDone;

  const phases: ClientInstallPlaybookPhase[] = [
    {
      key: "configure",
      label: "Configure the private install",
      objective:
        "Confirm tenant isolation, production wiring, enabled modules, and the concierge setup thesis.",
      exitCriteria:
        "Deployment, tenant, module, and operator-plan gates pass with no critical setup questions.",
      status: phaseStatus({
        passed: configureDone,
        blocked: hasAction(deployment, tenant, modules),
      }),
      href: hasAction(deployment, tenant) ? "/deployment" : "/intake",
      evidence: [
        evidenceLine("Deployment", deployment),
        evidenceLine("Tenant", tenant),
        evidenceLine("Modules", modules),
        evidenceLine("Critical questions", `${criticalQuestions.length}`),
      ],
      nextStep:
        criticalQuestions[0]?.question ??
        "Confirm Vercel, Supabase Auth redirects, tenant membership, and enabled workflows.",
    },
    {
      key: "data",
      label: "Import and verify relationship data",
      objective:
        "Load the first real contact set and clean high-value records before relying on recommendations.",
      exitCriteria: "Contacts exist and high-value relationship records are handoff-safe.",
      status: phaseStatus({
        passed: dataDone,
        waiting: !configureDone || hasWaiting(contacts),
      }),
      href: isPass(contacts) ? "/quality" : "/contacts",
      evidence: [evidenceLine("Contacts", contacts), evidenceLine("Data quality", dataQuality)],
      nextStep: isPass(contacts)
        ? "Set a two-day research catch-up in Settings so every imported person is researched, then resolve priority cleanup so high-value records can guide outreach safely."
        : "Import a small source-backed contact batch before scaling data volume.",
    },
    {
      key: "claude",
      label: "Prove the Claude write loop",
      objective:
        "Show that Claude can claim work, return output, and create reviewable evidence without direct database access.",
      exitCriteria:
        "Test job creation, claim, completion, command output, pending review, audit, and provenance are exercised.",
      status: phaseStatus({
        passed: claudeDone,
        waiting: !isPass(contacts) || hasWaiting(testJobCreated),
      }),
      href: "/ops",
      evidence: [
        evidenceLine("Acceptance", acceptance),
        evidenceLine("Command output", commandOutput),
        evidenceLine("Job created", testJobCreated),
        evidenceLine("Job claimed", testJobClaimed),
        evidenceLine("Job completed", testJobCompleted),
      ],
      nextStep:
        "Run a small test job through Ops, then complete the handoff with source-backed output.",
    },
    {
      key: "review",
      label: "Verify review and owner judgment lanes",
      objective:
        "Make sure low-risk changes can be approved quickly and judgment-heavy claims stay reviewable.",
      exitCriteria:
        "Pending review pressure is under control, Ask runs have decisions, and approval leaves audit/provenance.",
      status: phaseStatus({
        passed: reviewDone,
        waiting: !isPass(commandOutput) && hasWaiting(reviewPressure, ask),
      }),
      href: hasAction(reviewPressure, lowRiskReview, auditProvenance) ? "/changes" : "/ask",
      evidence: [
        evidenceLine("Review queue", reviewPressure),
        evidenceLine("Ask decisions", ask),
        evidenceLine("Low-risk review", lowRiskReview),
        evidenceLine("Audit/provenance", auditProvenance),
      ],
      nextStep:
        "Resolve pending changes and save a follow-up or no-action decision for the first real Ask run.",
    },
    {
      key: "rehearse",
      label: "Run the launch rehearsal",
      objective:
        "Close the exact job-to-action lifecycle the operator expects to use after handoff.",
      exitCriteria:
        "A rehearsal job succeeds, creates a tracked relationship action, and closes that action as evidence.",
      status: phaseStatus({
        passed: rehearsalDone,
        waiting: !isPass(commandOutput),
      }),
      href: "/launch",
      evidence: [evidenceLine("Rehearsal", rehearsal)],
      nextStep:
        "Run the launch rehearsal from the Launch page using a representative contact.",
    },
    {
      key: "handoff",
      label: "Package owner handoff",
      objective:
        "Share only the owner-facing Book, with admin tools hidden and launch notes captured for the operator.",
      exitCriteria:
        "Privacy/noindex signoff, launch notes, owner preview, and owner packet are ready.",
      status: phaseStatus({
        passed: handoffDone,
        waiting: !rehearsalDone,
      }),
      href: isPass(privacy) ? "/launch/preview" : "/deployment",
      evidence: [evidenceLine("Privacy", privacy), evidenceLine("Launch notes", handoffNotes)],
      nextStep:
        "Confirm production privacy signoff, write launch notes, and review the owner preview packet.",
    },
  ];

  const active =
    phases.find((phase) => phase.status === "blocked") ??
    phases.find((phase) => phase.status === "active") ??
    phases.find((phase) => phase.status === "waiting") ??
    phases[phases.length - 1];

  const doneCount = phases.filter((phase) => phase.status === "done").length;

  return {
    phases,
    active,
    doneCount,
    total: phases.length,
    ready: doneCount === phases.length,
    summary:
      doneCount === phases.length
        ? "The concierge install playbook is complete."
        : `${doneCount}/${phases.length} playbook phases are complete. Next: ${active.label}.`,
  };
}
