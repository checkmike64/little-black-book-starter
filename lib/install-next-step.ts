export type InstallNextStep = {
  label: string;
  detail: string;
  href: string;
  action: string;
  tone: "hot" | "neutral";
};

export type InstallNextStepInput = {
  setupMode: boolean;
  hasTenantContext: boolean;
  intakePercent: number;
  contactCount: number;
  pendingChangeCount: number;
  queuedJobCount: number;
  deploymentReady: boolean;
};

export function recommendedInstallSteps({
  setupMode,
  hasTenantContext,
  intakePercent,
  contactCount,
  pendingChangeCount,
  queuedJobCount,
  deploymentReady,
}: InstallNextStepInput) {
  const steps: InstallNextStep[] = [];

  if (setupMode || !deploymentReady) {
    steps.push({
      label: "Finish production wiring",
      detail:
        "Confirm Vercel variables, Supabase redirect URLs, and the Auth email code fallback before using the live install with a client.",
      href: "/deployment",
      action: "Open deployment",
      tone: "hot",
    });
  }

  if (!hasTenantContext) {
    steps.push({
      label: "Verify owner/operator access",
      detail:
        "Make sure the signed-in user has an active tenant membership so RLS is protecting the right private book.",
      href: "/settings",
      action: "Open settings",
      tone: "hot",
    });
  }

  if (intakePercent < 100) {
    steps.push({
      label: "Complete the client intake profile",
      detail:
        "Capture the owner's thesis, referral lanes, relationship rules, voice, and assistant style before relying on Claude automation.",
      href: "/intake",
      action: "Open intake",
      tone: "hot",
    });
  }

  if (contactCount === 0) {
    steps.push({
      label: "Seed the first contacts through Claude",
      detail:
        "Use the Claude setup packet to import a small verified set first, then confirm enrichment proposals before scaling.",
      href: "/claude-setup",
      action: "Open Claude setup",
      tone: "neutral",
    });
  }

  if (queuedJobCount === 0 && contactCount > 0) {
    steps.push({
      label: "Run one enrichment loop test",
      detail:
        "Create a test enrichment job, hand it to Claude, and paste the result back so the full review path is proven.",
      href: "/ops",
      action: "Open ops",
      tone: "neutral",
    });
  }

  if (pendingChangeCount > 0) {
    steps.push({
      label: "Clear proposed changes",
      detail:
        "Approve or reject Claude's pending relationship updates before adding more automation volume.",
      href: "/changes",
      action: "Review changes",
      tone: "hot",
    });
  }

  if (steps.length === 0) {
    steps.push({
      label: "Use Ask to pressure-test the book",
      detail:
        "Search for referral fits, podcast paths, stale relationships, and open asks to find weak fields before onboarding the next client.",
      href: "/ask",
      action: "Ask the book",
      tone: "neutral",
    });
  }

  return steps.slice(0, 3);
}
