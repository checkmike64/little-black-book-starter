export type JobOutcomeTone = "cool" | "gold" | "hot" | "warn";

export type JobOutcomeInput = {
  jobId: string;
  jobStatus: string;
  hasCommand: boolean;
  hasCommandOutput: boolean;
  commandOutputDismissed?: boolean;
  commandOutputDismissedReason?: string | null;
  pendingChangeCount: number;
  openPendingChangeCount: number;
  interactionCount: number;
  commandActionCount: number;
  contactId?: string | null;
  recommendedActionTitle?: string | null;
};

export type JobOutcome = {
  eyebrow: string;
  title: string;
  detail: string;
  tone: JobOutcomeTone;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
};

export function buildJobOutcome({
  commandActionCount,
  commandOutputDismissed = false,
  commandOutputDismissedReason,
  contactId,
  hasCommand,
  hasCommandOutput,
  interactionCount,
  jobId,
  jobStatus,
  openPendingChangeCount,
  pendingChangeCount,
  recommendedActionTitle,
}: JobOutcomeInput): JobOutcome {
  if (jobStatus === "queued") {
    return {
      eyebrow: "Ready",
      title: "Ready for Claude",
      detail: "Claim the handoff when the review queue is clear and Claude can work from the prepared packet.",
      tone: "gold",
      primaryHref: `/ops/jobs/${jobId}/handoff`,
      primaryLabel: "Open handoff",
    };
  }

  if (jobStatus === "running") {
    return {
      eyebrow: "In Flight",
      title: "Awaiting Claude return",
      detail: "Paste the Claude result back into the handoff console so the job closes with audit history.",
      tone: "hot",
      primaryHref: `/ops/jobs/${jobId}/handoff`,
      primaryLabel: "Return job",
    };
  }

  if (jobStatus === "failed") {
    return {
      eyebrow: "Blocked",
      title: "Resolve the blocker",
      detail: "This handoff needs owner context, source context, or retry cleanup before more automation should depend on it.",
      tone: "warn",
      primaryHref: `/ops/jobs/${jobId}/handoff`,
      primaryLabel: "Inspect blocker",
    };
  }

  if (openPendingChangeCount > 0) {
    return {
      eyebrow: "Review",
      title: "Review proposed changes",
      detail: `${openPendingChangeCount} pending proposal${openPendingChangeCount === 1 ? "" : "s"} must be approved or rejected before the Book changes.`,
      tone: "warn",
      primaryHref: "/changes",
      primaryLabel: "Review changes",
      secondaryHref: `/ops/jobs/${jobId}`,
      secondaryLabel: "Inspect job",
    };
  }

  if (hasCommand && hasCommandOutput && commandOutputDismissed) {
    return {
      eyebrow: "Closed",
      title: "No action needed",
      detail:
        commandOutputDismissedReason ||
        "This command output was reviewed and intentionally dismissed without creating a movement item.",
      tone: "cool",
      primaryHref: contactId ? `/contacts/${contactId}` : "/ops",
      primaryLabel: contactId ? "Open contact" : "Back to ops",
      secondaryHref: `/ops/jobs/${jobId}`,
      secondaryLabel: "Inspect job",
    };
  }

  if (hasCommand && hasCommandOutput && commandActionCount === 0) {
    return {
      eyebrow: "Capture",
      title: recommendedActionTitle || "Capture the next movement item",
      detail: "Claude returned usable command output, but it is not yet tracked as a relationship action.",
      tone: "warn",
      primaryHref: "#track-action",
      primaryLabel: "Capture action",
      secondaryHref: contactId ? `/contacts/${contactId}` : undefined,
      secondaryLabel: contactId ? "Open contact" : undefined,
    };
  }

  if (hasCommand && commandActionCount > 0) {
    return {
      eyebrow: "Movement",
      title: "Movement captured",
      detail: `${commandActionCount} tracked action${commandActionCount === 1 ? "" : "s"} now carries this command output into the operating queue.`,
      tone: "cool",
      primaryHref: contactId ? `/contacts/${contactId}` : "/movement",
      primaryLabel: contactId ? "Open contact" : "Open movement",
      secondaryHref: "/movement",
      secondaryLabel: "Movement queue",
    };
  }

  if (pendingChangeCount > 0 || interactionCount > 0) {
    return {
      eyebrow: "Recorded",
      title: "Handoff recorded",
      detail: "The job created tracked side effects and no linked pending proposals remain open.",
      tone: "cool",
      primaryHref: pendingChangeCount > 0 ? "/changes" : "/ops",
      primaryLabel: pendingChangeCount > 0 ? "Review history" : "Back to ops",
      secondaryHref: contactId ? `/contacts/${contactId}` : undefined,
      secondaryLabel: contactId ? "Open contact" : undefined,
    };
  }

  return {
    eyebrow: "Closed",
    title: "Closed cleanly",
    detail: "Claude completed the handoff without proposals, interactions, or movement actions.",
    tone: "cool",
    primaryHref: "/ops",
    primaryLabel: "Back to ops",
    secondaryHref: contactId ? `/contacts/${contactId}` : undefined,
    secondaryLabel: contactId ? "Open contact" : undefined,
  };
}
