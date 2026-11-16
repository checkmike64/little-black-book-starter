export type ClaudeSetupPacketRevision = {
  createdAt: string;
  actionLabel: string;
  summary: string;
};

export type ClaudeSetupPacketInput = {
  tenantName: string;
  generatedAt: string;
  intakePercent: number;
  revision: ClaudeSetupPacketRevision | null;
  enabledModules: string[];
  installBrief: string;
  projectInstructions: string;
  endpointCheatsheet: string;
  firstRunSequence: Array<{
    label: string;
    detail: string;
    evidence: string;
  }>;
  intakeTranscriptPrompt: string;
  firstContactImportPrompt: string;
  ownerVerificationPrompt: string;
  dailyCloseoutPrompt: string;
  weeklyNetworkPrompt: string;
  prospectingResearchPrompt: string;
  prospectingProposalPrompt: string;
  prospectingVerificationPrompt: string;
};

function section(title: string, body: string) {
  return [`## ${title}`, "", body.trim() || "Not generated.", ""].join("\n");
}

function numberedSteps(
  steps: ClaudeSetupPacketInput["firstRunSequence"],
) {
  if (steps.length === 0) return "Not generated.";

  return steps
    .map(
      (step, index) =>
        `${index + 1}. ${step.label}\n   - ${step.detail}\n   - Evidence: ${
          step.evidence
        }`,
    )
    .join("\n");
}

function safeFileSlug(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "little-black-book";
}

export function claudeSetupPacketFileName(tenantName: string) {
  return `${safeFileSlug(tenantName)}-claude-setup-packet.txt`;
}

export function formatClaudeSetupPacket(input: ClaudeSetupPacketInput) {
  const revisionLine = input.revision
    ? `${input.revision.actionLabel} at ${input.revision.createdAt}: ${input.revision.summary}`
    : "No setup revision has been recorded yet.";

  return [
    `# Little Black Book Claude Setup Packet`,
    "",
    `Tenant: ${input.tenantName}`,
    `Generated: ${input.generatedAt}`,
    `Intake readiness: ${input.intakePercent}%`,
    `Latest setup revision: ${revisionLine}`,
    `Enabled modules: ${input.enabledModules.length ? input.enabledModules.join(", ") : "None"}`,
    "",
    "Use this packet to configure the client Claude project. Do not paste Supabase service-role keys into Claude.",
    "",
    section("Install Brief", input.installBrief),
    section("Claude Project Instructions", input.projectInstructions),
    section("Endpoint Contract", input.endpointCheatsheet),
    section("First Operating Pass", numberedSteps(input.firstRunSequence)),
    section("Intake Transcript Prompt", input.intakeTranscriptPrompt),
    section("First Contact Import Prompt", input.firstContactImportPrompt),
    section("Owner Verification Prompt", input.ownerVerificationPrompt),
    section("Daily Closeout Prompt", input.dailyCloseoutPrompt),
    section("Weekly Network Intelligence Prompt", input.weeklyNetworkPrompt),
    section("Prospecting Research Prompt", input.prospectingResearchPrompt),
    section("Want to Know Boundary", input.prospectingProposalPrompt),
    section("Prospecting Verification Prompt", input.prospectingVerificationPrompt),
  ].join("\n");
}
