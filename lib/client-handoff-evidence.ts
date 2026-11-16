export type HandoffAction = {
  label: string;
  detail: string;
  href: string;
  lane?: string;
};

export type HandoffClaudeJob = {
  label: string;
  detail: string;
  href: string;
};

export type HandoffModuleProof = {
  label: string;
  detail: string;
  status: "pass" | "action" | "waiting";
  href: string;
};

export type ClientHandoffEvidenceInput = {
  tenantName: string;
  generatedAt: string;
  launchStatus: string;
  launchCompleted: number;
  launchTotal: number;
  installStage?: string;
  installStageDetail?: string;
  actionSummary: string;
  nextActions: HandoffAction[];
  nextSprints?: HandoffAction[];
  claudeFirstJobs?: HandoffClaudeJob[];
  moduleProof?: HandoffModuleProof[];
  enabledModules: string[];
  hiddenModules: string[];
  contactCount: number;
  qualityAverage: number;
  weakRecordCount: number;
  highValueWeakCount: number;
  pendingReviewCount: number;
  commandJobCount: number;
  askRunCount: number;
  askRunUndecidedCount: number;
  rehearsalJobStatus: string | null;
  rehearsalActionStatus: string | null;
  launchNotes: string;
};

export type ClientHandoffEvidencePack = ClientHandoffEvidenceInput & {
  readyForOwner: boolean;
  riskLevel: "low" | "medium" | "high";
  riskSummary: string;
};

function riskLevel(input: ClientHandoffEvidenceInput): ClientHandoffEvidencePack["riskLevel"] {
  if (
    input.launchCompleted < input.launchTotal ||
    input.highValueWeakCount > 0 ||
    input.pendingReviewCount > 0 ||
    input.askRunUndecidedCount > 0
  ) {
    return "high";
  }

  if (input.weakRecordCount > 0 || input.qualityAverage < 85) {
    return "medium";
  }

  return "low";
}

function riskSummary(input: ClientHandoffEvidenceInput, level: ClientHandoffEvidencePack["riskLevel"]) {
  if (level === "low") {
    return "Launch evidence is complete and no major operating pressure is visible.";
  }

  const risks = [
    input.launchCompleted < input.launchTotal
      ? `${input.launchTotal - input.launchCompleted} launch checklist item${
          input.launchTotal - input.launchCompleted === 1 ? "" : "s"
        } remain`
      : null,
    input.pendingReviewCount > 0
      ? `${input.pendingReviewCount} pending review item${
          input.pendingReviewCount === 1 ? "" : "s"
        }`
      : null,
    input.highValueWeakCount > 0
      ? `${input.highValueWeakCount} high-value data gap${
          input.highValueWeakCount === 1 ? "" : "s"
        }`
      : null,
    input.askRunUndecidedCount > 0
      ? `${input.askRunUndecidedCount} undecided saved Ask run${
          input.askRunUndecidedCount === 1 ? "" : "s"
        }`
      : null,
    input.qualityAverage < 85 ? `average data quality is ${input.qualityAverage}%` : null,
  ].filter((item): item is string => Boolean(item));

  return risks.join("; ") || "Minor handoff risks remain.";
}

export function buildClientHandoffEvidencePack(
  input: ClientHandoffEvidenceInput,
): ClientHandoffEvidencePack {
  const level = riskLevel(input);

  return {
    ...input,
    readyForOwner: level === "low" && input.launchCompleted === input.launchTotal,
    riskLevel: level,
    riskSummary: riskSummary(input, level),
  };
}

function bulletList(values: string[], empty: string) {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : `- ${empty}`;
}

export function formatClientHandoffEvidencePack(pack: ClientHandoffEvidencePack) {
  return [
    `Little Black Book handoff evidence: ${pack.tenantName}`,
    `Generated: ${pack.generatedAt}`,
    "",
    "Launch status:",
    `- Status: ${pack.launchStatus}`,
    `- Checklist: ${pack.launchCompleted}/${pack.launchTotal}`,
    `- Ready for owner: ${pack.readyForOwner ? "yes" : "not yet"}`,
    `- Risk: ${pack.riskLevel}`,
    `- Risk summary: ${pack.riskSummary}`,
    ...(pack.installStage
      ? [
          `- Install stage: ${pack.installStage}`,
          `- Stage detail: ${pack.installStageDetail ?? "No stage detail."}`,
        ]
      : []),
    "",
    "Enabled modules:",
    bulletList(pack.enabledModules, "None enabled"),
    "",
    "Module proof:",
    pack.moduleProof?.length
      ? pack.moduleProof
          .map(
            (item, index) =>
              `${index + 1}. ${item.label} - ${item.status}: ${item.detail} (${item.href})`,
          )
          .join("\n")
      : "1. No module-level proof is available yet.",
    "",
    "Hidden modules:",
    bulletList(pack.hiddenModules, "None hidden"),
    "",
    "Data and review:",
    `- Contacts: ${pack.contactCount}`,
    `- Average quality: ${pack.qualityAverage}%`,
    `- Weak records: ${pack.weakRecordCount}`,
    `- High-value gaps: ${pack.highValueWeakCount}`,
    `- Pending review: ${pack.pendingReviewCount}`,
    "",
    "Claude and Ask proof:",
    `- Completed command outputs: ${pack.commandJobCount}`,
    `- Saved Ask runs: ${pack.askRunCount}`,
    `- Undecided Ask runs: ${pack.askRunUndecidedCount}`,
    `- Latest rehearsal job: ${pack.rehearsalJobStatus ?? "none"}`,
    `- Latest rehearsal action: ${pack.rehearsalActionStatus ?? "none"}`,
    "",
    "Next actions:",
    pack.nextActions.length
      ? pack.nextActions
          .map((action, index) => {
            const lane = action.lane ? ` [${action.lane}]` : "";
            return `${index + 1}. ${action.label}${lane} - ${action.detail} (${action.href})`;
          })
          .join("\n")
      : "1. No action items remain.",
    "",
    "Next install sprints:",
    pack.nextSprints?.length
      ? pack.nextSprints
          .map((action, index) => {
            const lane = action.lane ? ` [${action.lane}]` : "";
            return `${index + 1}. ${action.label}${lane} - ${action.detail} (${action.href})`;
          })
          .join("\n")
      : "1. No install sprint items remain.",
    "",
    "Claude first jobs:",
    pack.claudeFirstJobs?.length
      ? pack.claudeFirstJobs
          .map(
            (job, index) =>
              `${index + 1}. ${job.label} - ${job.detail} (${job.href})`,
          )
          .join("\n")
      : "1. No Claude proof jobs are currently suggested.",
    "",
    "Operator launch notes:",
    pack.launchNotes.trim() || "No launch notes stored yet.",
    "",
    `Action summary: ${pack.actionSummary}`,
  ].join("\n");
}
