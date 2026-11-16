import { buildClientInstallLaunchGates } from "@/lib/client-install-launch-gates";
import { buildClientInstallManifest } from "@/lib/client-install-manifest";
import {
  clientInstallPlan,
  clientInstallReadiness,
} from "@/lib/client-install-plan";
import {
  deploymentReadiness,
  liveSmokeChecklistForSite,
  productionCheckEvidence,
  productionRedirectUrls,
  signedInOwnerSmokeChecklistForSite,
} from "@/lib/deployment-readiness";
import { rehearsalPhaseCounts } from "@/lib/install-rehearsal";
import { getTenantContext } from "@/lib/tenant-context";
import { normalizeTenantSettings } from "@/lib/tenant-settings";

export async function getDeploymentData() {
  const context = await getTenantContext();
  const settings = normalizeTenantSettings(context?.settings);
  const readiness = deploymentReadiness();
  const productionEvidence = productionCheckEvidence(settings);
  const installManifest = buildClientInstallManifest({
    tenantName: context?.tenantName ?? "Current install",
    settings,
  });
  const launchPlan = clientInstallPlan(settings);
  const launchReadiness = clientInstallReadiness(settings);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const redirectUrls = productionRedirectUrls(siteUrl);
  const liveSmoke = liveSmokeChecklistForSite(siteUrl);
  const signedInOwnerSmoke = signedInOwnerSmokeChecklistForSite(siteUrl);
  const rehearsal = rehearsalPhaseCounts();
  const launchGates = buildClientInstallLaunchGates({
    deploymentReady: readiness.ready,
    deploymentBlockingCount: readiness.blockingCount,
    productionSignoffReady: productionEvidence.ready,
    productionSignoffMissing: productionEvidence.missing,
    installPlanPercent: launchReadiness.percent,
    installPlanBlocked: launchReadiness.blocked,
    missingSetupCount: installManifest.missingSetup.length,
    enabledModuleCount: installManifest.enabledModules.length,
    claudeTokenReady: readiness.checks.some(
      (check) => check.label === "Claude write token" && check.tone === "ok",
    ),
    claudeSetupReady:
      settings.voice_profile.assistant_style.trim().length > 0 &&
      settings.onboarding.relationship_rules.trim().length > 0,
    liveSmokeReady: liveSmoke.ownerRoutes.length > 0,
    ownerSmokeReady: signedInOwnerSmoke.routes.length > 0,
  });

  return {
    context,
    settings,
    readiness,
    productionEvidence,
    installManifest,
    launchPlan,
    launchReadiness,
    redirectUrls,
    liveSmoke,
    signedInOwnerSmoke,
    rehearsal,
    launchGates,
  };
}
