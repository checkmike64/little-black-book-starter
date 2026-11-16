export type ChangeReviewCommandInput = {
  activeCount: number;
  lowRiskCount: number;
  highRiskCount: number;
  detailedReviewCount: number;
  ownerContextCount: number;
  answeredContextCount: number;
  revisionQueuedCount: number;
  quickApprovalCount: number;
  unsupportedKeyCount: number;
  nextReview: {
    href: string;
    summary: string;
    contactLabel: string;
    lane: string;
    riskReason: string;
  } | null;
};

export type ChangeReviewCommand = {
  mode:
    | "Clear"
    | "Gather Context"
    | "Verify Judgment"
    | "Queue Revision"
    | "Approve Low Risk"
    | "Review";
  tone: "hot" | "gold" | "cool";
  headline: string;
  detail: string;
  primary: {
    label: string;
    href: string;
    detail: string;
  };
  signals: Array<{
    label: string;
    value: string;
    tone: "hot" | "gold" | "cool";
  }>;
  guardrail: string;
};

function plural(count: number, singular: string, pluralWord = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

function primaryFromNext(
  input: ChangeReviewCommandInput,
  fallback: ChangeReviewCommand["primary"],
) {
  return input.nextReview
    ? {
        label: "Open next review",
        href: input.nextReview.href,
        detail: `${input.nextReview.contactLabel}: ${input.nextReview.summary}`,
      }
    : fallback;
}

export function buildChangeReviewCommand(
  input: ChangeReviewCommandInput,
): ChangeReviewCommand {
  const signals: ChangeReviewCommand["signals"] = [
    {
      label: "High risk",
      value: String(input.highRiskCount),
      tone: input.highRiskCount > 0 ? "hot" : "cool",
    },
    {
      label: "Owner context",
      value: String(input.ownerContextCount),
      tone: input.ownerContextCount > 0 ? "hot" : "cool",
    },
    {
      label: "Low risk",
      value: String(input.lowRiskCount),
      tone: input.lowRiskCount > 0 ? "gold" : "cool",
    },
    {
      label: "Unsupported",
      value: String(input.unsupportedKeyCount),
      tone: input.unsupportedKeyCount > 0 ? "gold" : "cool",
    },
  ];

  if (input.activeCount === 0) {
    return {
      mode: "Clear",
      tone: "cool",
      headline: "The review gate is clear",
      detail:
        "No Claude proposals are waiting. The Book is not carrying unapproved relationship changes.",
      primary: {
        label: "Ask the Book",
        href: "/ask",
        detail: "Use Ask when you want to search or pressure-test the clean Book.",
      },
      signals,
      guardrail:
        "Keep it this way by routing new judgment-heavy Claude findings through Changes.",
    };
  }

  if (input.ownerContextCount > 0) {
    return {
      mode: "Gather Context",
      tone: "hot",
      headline: "Owner or source context is blocking the queue",
      detail: `${plural(
        input.ownerContextCount,
        "proposal",
      )} need owner memory, source detail, or relationship judgment before they should be approved.`,
      primary: {
        label: "Open owner packet",
        href: "#owner-verification-packet",
        detail:
          "Use the owner verification packet, then mark context requested so Claude can revise cleanly.",
      },
      signals,
      guardrail:
        "Do not approve blocked trust, referral, private-note, or relationship-strength fields just because the proposal looks plausible.",
    };
  }

  if (input.answeredContextCount > 0 || input.revisionQueuedCount > 0) {
    return {
      mode: "Queue Revision",
      tone: "gold",
      headline: "Owner context is available; convert it into cleaner proposals",
      detail:
        input.answeredContextCount > 0
          ? `${plural(input.answeredContextCount, "proposal")} have owner answers attached and should become revised Claude proposals.`
          : `${plural(input.revisionQueuedCount, "revision")} are already queued with Claude.`,
      primary: primaryFromNext(input, {
        label: "Open changes",
        href: "/changes",
        detail: "Review owner-context proposals and confirm the revision path.",
      }),
      signals,
      guardrail:
        "Owner context is evidence for a revised proposal; it is not permission to bypass the review gate.",
    };
  }

  if (input.highRiskCount > 0 || input.detailedReviewCount > 0) {
    return {
      mode: "Verify Judgment",
      tone: "hot",
      headline: "Judgment-heavy proposals need one-by-one review",
      detail: `${plural(
        Math.max(input.highRiskCount, input.detailedReviewCount),
        "proposal",
      )} could affect trust, identity, referral safety, or relationship posture.`,
      primary: primaryFromNext(input, {
        label: "Open detailed review",
        href: "/changes",
        detail: "Start with the highest-priority detailed review item.",
      }),
      signals,
      guardrail:
        "Avoid bulk approval when the proposal changes who someone is, how much they are trusted, or whether the owner should refer them.",
    };
  }

  if (input.quickApprovalCount > 0) {
    return {
      mode: "Approve Low Risk",
      tone: "gold",
      headline: "Low-risk updates can be cleared efficiently",
      detail: `${plural(
        input.quickApprovalCount,
        "visible low-risk proposal",
      )} are eligible for efficient approval.`,
      primary: {
        label: "Approve visible low-risk",
        href: "/changes",
        detail:
          "Clear mechanical field updates and contact enrichments while leaving sensitive proposals one-by-one.",
      },
      signals,
      guardrail:
        "Bulk approval is only for low-risk, supported updates that are tied to existing contacts.",
    };
  }

  return {
    mode: "Review",
    tone: "gold",
    headline: "The queue has standard proposals to inspect",
    detail: `${plural(input.activeCount, "proposal")} are waiting for a normal review decision.`,
    primary: primaryFromNext(input, {
      label: "Open changes",
      href: "/changes",
      detail: "Work the queue from the highest-priority proposal.",
    }),
    signals,
    guardrail:
      "Every approval should leave the Book more useful and more trustworthy, not merely more complete.",
  };
}
