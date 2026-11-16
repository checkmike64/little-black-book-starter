export type ClientInstallLaunchGateStatus = "pass" | "action" | "waiting";

export type ClientInstallLaunchGate = {
  key: string;
  label: string;
  detail: string;
  status: ClientInstallLaunchGateStatus;
  href: string;
};

export type ClientInstallLaunchGateInput = {
  deploymentReady: boolean;
  deploymentBlockingCount: number;
  productionSignoffReady: boolean;
  productionSignoffMissing: number;
  installPlanPercent: number;
  installPlanBlocked: number;
  missingSetupCount: number;
  enabledModuleCount: number;
  claudeTokenReady: boolean;
  claudeSetupReady: boolean;
  liveSmokeReady: boolean;
  ownerSmokeReady: boolean;
};

function statusFrom(
  passed: boolean,
  prerequisite = true,
): ClientInstallLaunchGateStatus {
  if (passed) return "pass";
  return prerequisite ? "action" : "waiting";
}

export function buildClientInstallLaunchGates(
  input: ClientInstallLaunchGateInput,
) {
  const smokeReady = input.liveSmokeReady && input.ownerSmokeReady;
  const gates: ClientInstallLaunchGate[] = [
    {
      key: "deployment",
      label: "Production environment is ready",
      detail: input.deploymentReady
        ? "Vercel, Supabase, auth callback, tenant, operator, and Claude gateway inputs are present."
        : `${input.deploymentBlockingCount} deployment input${
            input.deploymentBlockingCount === 1 ? "" : "s"
          } still need attention before client handoff.`,
      status: statusFrom(input.deploymentReady),
      href: "/deployment",
    },
    {
      key: "production-signoff",
      label: "Manual production signoff is complete",
      detail: input.productionSignoffReady
        ? "Operator-held privacy, RLS, token, preview, and auth checks are confirmed."
        : `${input.productionSignoffMissing} production signoff item${
            input.productionSignoffMissing === 1 ? "" : "s"
          } still need confirmation.`,
      status: statusFrom(input.productionSignoffReady, input.deploymentReady),
      href: "/deployment",
    },
    {
      key: "install-plan",
      label: "Client-specific setup is captured",
      detail:
        input.installPlanBlocked > 0
          ? "A client setup phase is blocked."
          : input.missingSetupCount > 0
            ? `${input.missingSetupCount} setup item${
                input.missingSetupCount === 1 ? "" : "s"
              } still need operator input.`
            : `${input.installPlanPercent}% of the concierge install plan is ready.`,
      status: statusFrom(
        input.installPlanBlocked === 0 &&
          input.installPlanPercent >= 100 &&
          input.missingSetupCount === 0,
      ),
      href: "/intake",
    },
    {
      key: "modules",
      label: "Owner-facing modules match the client promise",
      detail:
        input.enabledModuleCount > 0
          ? `${input.enabledModuleCount} owner-facing module${
              input.enabledModuleCount === 1 ? "" : "s"
            } are enabled for this install.`
          : "Enable only the workflows sold into the client install before launch.",
      status: statusFrom(input.enabledModuleCount > 0),
      href: "/settings",
    },
    {
      key: "claude",
      label: "Claude setup packet is launch-ready",
      detail:
        input.claudeTokenReady && input.claudeSetupReady
          ? "Claude has narrow app endpoints, write-token posture, and client-specific instructions."
          : "Finish the Claude setup packet and confirm Claude receives the app write token only.",
      status: statusFrom(
        input.claudeTokenReady && input.claudeSetupReady,
        input.deploymentReady,
      ),
      href: "/claude-setup",
    },
    {
      key: "smoke",
      label: "Production smoke path is defined",
      detail: smokeReady
        ? "Signed-out security smoke and signed-in owner smoke checklists are ready to run after deploy."
        : "Add both signed-out and signed-in smoke evidence before handing over the production URL.",
      status: statusFrom(smokeReady, input.deploymentReady),
      href: "/deployment",
    },
  ];
  const pass = gates.filter((gate) => gate.status === "pass").length;
  const action = gates.filter((gate) => gate.status === "action").length;
  const waiting = gates.filter((gate) => gate.status === "waiting").length;
  const next =
    gates.find((gate) => gate.status === "action") ??
    gates.find((gate) => gate.status === "waiting") ??
    gates[0];

  return {
    gates,
    pass,
    action,
    waiting,
    total: gates.length,
    ready: pass === gates.length,
    next,
    summary:
      pass === gates.length
        ? "Client install gates are clear."
        : `${action} action item${action === 1 ? "" : "s"} and ${waiting} waiting item${
            waiting === 1 ? "" : "s"
          } remain before owner handoff.`,
  };
}
