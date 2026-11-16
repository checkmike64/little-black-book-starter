import {
  clientInstallModulePlan,
  clientInstallReadiness,
} from "@/lib/client-install-plan";
import {
  buildClientLaunchChecklist,
  buildLaunchActionPlan,
} from "@/lib/client-launch-readiness";
import { qualityStats } from "@/lib/data-quality";
import {
  deploymentReadiness,
  productionCheckEvidence,
} from "@/lib/deployment-readiness";
import {
  getOwnerHandoffExportData,
  type JobRow,
} from "@/lib/export/owner-handoff-data";
import { buildInstallAcceptanceSummary } from "@/lib/install-acceptance";
import {
  hasClosedLaunchRehearsalAction,
  hasSucceededLaunchRehearsalJob,
} from "@/lib/launch-rehearsal-evidence";
import { featureModules, type ModuleKey } from "@/lib/modules";
import {
  buildOwnerHandoffPacket,
  formatOwnerHandoffPacket,
  ownerHandoffPacketFileName,
  type OwnerHandoffStartingPoint,
} from "@/lib/owner-handoff-packet";
import { buildOwnerLaunchPreview } from "@/lib/owner-launch-preview";
import { getTenantContext } from "@/lib/tenant-context";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { hasAskRunDecision } from "@/lib/ask-run-decision";

const privateHeaders = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function commandFocus(job: JobRow) {
  return isRecord(job.payload.command_focus) ? job.payload.command_focus : null;
}

function commandOutput(job: JobRow) {
  const output = job.result.command_output;
  return typeof output === "string" && output.trim() ? output.trim() : null;
}

function ownerStartingPoints({
  enabledModules,
  pendingReviewCount,
  askRunUndecidedCount,
}: {
  enabledModules: ModuleKey[];
  pendingReviewCount: number;
  askRunUndecidedCount: number;
}): OwnerHandoffStartingPoint[] {
  const moduleByKey = new Map(featureModules.map((module) => [module.key, module]));
  const points: OwnerHandoffStartingPoint[] = [
    {
      label: "Open the Book",
      detail: "Review the people, relationship context, trust posture, and useful next moves already loaded.",
      href: "/contacts",
    },
  ];

  if (enabledModules.includes("ask")) {
    points.push({
      label: "Ask a relationship question",
      detail: "Search across contacts, asks, promises, notes, and saved evidence.",
      href: moduleByKey.get("ask")?.href ?? "/ask",
    });
  }

  if (pendingReviewCount > 0) {
    points.push({
      label: "Review proposed updates",
      detail: "Approve or dismiss suggested relationship updates before they become trusted fields.",
      href: "/changes",
    });
  }

  if (askRunUndecidedCount > 0) {
    points.push({
      label: "Close Ask follow-ups",
      detail: "Mark saved Ask results as follow-up or no action so the operating history stays clean.",
      href: "/ask?saved=needs_decision",
    });
  }

  if (enabledModules.includes("want_to_know")) {
    points.push({
      label: "Work prospecting buckets",
      detail: "Review people the owner wants to know, organized by the prospecting goals configured for this install.",
      href: moduleByKey.get("want_to_know")?.href ?? "/want-to-know",
    });
  }

  return points.slice(0, 6);
}

export async function GET() {
  const context = await getTenantContext();
  if (context?.role !== "operator") {
    return Response.json(
      { error: "Owner handoff exports are operator-only for this install." },
      { status: 403, headers: privateHeaders },
    );
  }

  const exportData = await getOwnerHandoffExportData(context);
  if (!exportData) {
    return Response.json(
      { error: "Supabase is not configured." },
      { status: 503, headers: privateHeaders },
    );
  }

  const settings = normalizeTenantSettings(context.settings);
  const modulePlan = clientInstallModulePlan(settings);
  const deployment = deploymentReadiness();
  const productionEvidence = productionCheckEvidence(settings);
  const installReadiness = clientInstallReadiness(settings);
  const {
    askRunCount,
    askRunRows,
    auditRows,
    changeRows,
    contactCount,
    contactRows,
    jobRows,
    openActionCount,
    openPromiseCount,
    pendingReviewCount,
    reviewQueue,
    provenanceRows,
    rehearsalRows,
    relationshipActionCount,
    wantToKnowCount,
  } = exportData;
  const quality = qualityStats(contactRows);
  const commandJobs = jobRows.filter(
    (job) => job.status === "succeeded" && commandFocus(job) && commandOutput(job),
  );
  const enabledModules = modulePlan
    .filter((module) => module.enabled)
    .map((module) => module.key as ModuleKey);
  const askRunUndecidedCount = askRunRows.filter(
    (run) => !hasAskRunDecision(run.answer),
  ).length;
  const acceptance = buildInstallAcceptanceSummary({
    contactCount,
    jobs: jobRows,
    changes: changeRows,
    audit: auditRows,
    provenance: provenanceRows,
    moduleProof: {
      enabledModules,
      askRunCount,
      askRunUndecidedCount,
      commandJobCount: commandJobs.length,
      relationshipActionCount,
      wantToKnowCount,
    },
  });
  const launchChecklist = buildClientLaunchChecklist({
    deploymentReady: deployment.ready,
    deploymentBlockingCount: deployment.blockingCount,
    tenantReady: Boolean(context.tenantId),
    contactCount,
    qualityAverage: quality.average,
    weakRecordCount: quality.weak,
    highValueWeakCount: quality.highValueWeak,
    installPlanPercent: installReadiness.percent,
    installPlanBlocked: installReadiness.blocked,
    enabledModuleCount: enabledModules.length,
    moduleProofItems: acceptance.items.filter((item) =>
      item.key.startsWith("module-"),
    ),
    acceptanceReady: acceptance.ready,
    acceptanceCompleted: acceptance.completed,
    acceptanceTotal: acceptance.total,
    acceptanceNextAction: acceptance.nextAction,
    pendingReviewCount,
    reviewQueueComplete: reviewQueue.state === "complete",
    commandJobCount: commandJobs.length,
    rehearsalJobSucceeded: hasSucceededLaunchRehearsalJob(jobRows),
    rehearsalActionClosed: hasClosedLaunchRehearsalAction(rehearsalRows),
    askRunCount,
    askRunUndecidedCount,
    launchNotesReady: settings.delivery.launch_notes.trim().length > 0,
    noindexReady: productionEvidence.ready,
  });
  const launchActionPlan = buildLaunchActionPlan(launchChecklist.items);
  const ownerPreview = buildOwnerLaunchPreview({
    tenantName: context.tenantName,
    enabledModules,
    contactCount,
    pendingReviewCount,
    openActionCount,
    openPromiseCount,
    askRunCount,
    askRunUndecidedCount,
    launchStatus: launchChecklist.statusLabel,
    launchCompleted: launchChecklist.completed,
    launchTotal: launchChecklist.total,
  });
  const packet = buildOwnerHandoffPacket({
    tenantName: context.tenantName,
    generatedAt: new Date().toISOString(),
    launchStatus: launchChecklist.statusLabel,
    launchCompleted: launchChecklist.completed,
    launchTotal: launchChecklist.total,
    enabledModules: modulePlan
      .filter((module) => module.enabled)
      .map((module) => ({
        label: module.label,
        operatingUse: module.operatingUse,
      })),
    contactCount,
    qualityAverage: quality.average,
    weakRecordCount: quality.weak,
    highValueWeakCount: quality.highValueWeak,
    pendingReviewCount,
    askRunCount,
    askRunUndecidedCount,
    startingPoints: ownerStartingPoints({
      enabledModules,
      pendingReviewCount,
      askRunUndecidedCount,
    }),
    walkthroughSteps: ownerPreview.demoSteps.map((step) => ({
      label: step.label,
      detail: step.detail,
      href: step.href,
      status: step.status,
    })),
    launchNotes:
      settings.delivery.launch_notes.trim() || launchActionPlan.summary,
  });

  return new Response(formatOwnerHandoffPacket(packet), {
    headers: {
      ...privateHeaders,
      "Content-Disposition": `attachment; filename="${ownerHandoffPacketFileName(
        context.tenantName,
      )}"`,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
