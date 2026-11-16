import {
  buildClaudeProjectInstructions,
  buildDailyCloseoutPrompt,
  buildEndpointCheatsheet,
  buildClaudeFirstRunSequence,
  buildFirstContactImportPrompt,
  buildIntakeTranscriptPrompt,
  buildOwnerVerificationPrompt,
  buildWeeklyNetworkPrompt,
} from "@/lib/claude-setup-package";
import {
  claudeSetupPacketFileName,
  formatClaudeSetupPacket,
} from "@/lib/claude-setup-packet";
import { getLatestSetupRevision } from "@/lib/claude-setup/data";
import { buildInstallBrief } from "@/lib/install-brief";
import { featureModules } from "@/lib/modules";
import {
  buildProspectingResearchPrompt,
  buildProspectingVerificationPrompt,
  buildWantToKnowCandidateProposalPrompt,
} from "@/lib/prospecting-workflow";
import { getTenantContext } from "@/lib/tenant-context";
import {
  intakeCompletion,
  normalizeTenantSettings,
} from "@/lib/tenant-settings";

export async function GET() {
  const context = await getTenantContext();
  if (context?.role !== "operator") {
    return Response.json(
      { error: "Claude setup packet exports are operator-only for this install." },
      { status: 403 },
    );
  }

  const settings = normalizeTenantSettings(context.settings);
  const tenantName = context.tenantName;
  const revision = await getLatestSetupRevision(context.tenantId);
  const body = formatClaudeSetupPacket({
    tenantName,
    generatedAt: new Date().toISOString(),
    intakePercent: intakeCompletion(settings).percent,
    revision: revision
      ? {
          createdAt: revision.createdAt,
          actionLabel: revision.actionLabel,
          summary: revision.summary,
        }
      : null,
    enabledModules: featureModules
      .filter((module) => settings.modules[module.key])
      .map((module) => module.label),
    installBrief: buildInstallBrief({ tenantName, settings }),
    projectInstructions: buildClaudeProjectInstructions({ tenantName, settings }),
    endpointCheatsheet: buildEndpointCheatsheet(),
    firstRunSequence: buildClaudeFirstRunSequence(settings),
    intakeTranscriptPrompt: buildIntakeTranscriptPrompt({ tenantName, settings }),
    firstContactImportPrompt: buildFirstContactImportPrompt({ tenantName, settings }),
    ownerVerificationPrompt: buildOwnerVerificationPrompt(),
    dailyCloseoutPrompt: buildDailyCloseoutPrompt(),
    weeklyNetworkPrompt: buildWeeklyNetworkPrompt(),
    prospectingResearchPrompt: buildProspectingResearchPrompt(settings),
    prospectingProposalPrompt: buildWantToKnowCandidateProposalPrompt(settings),
    prospectingVerificationPrompt: buildProspectingVerificationPrompt(settings),
  });

  return new Response(body, {
    headers: {
      "Content-Disposition": `attachment; filename="${claudeSetupPacketFileName(
        tenantName,
      )}"`,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
    },
  });
}
