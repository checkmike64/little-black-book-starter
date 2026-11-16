export type ClientInstallQuestionInput = {
  contactCount: number;
  enabledModules: string[];
  hiddenModules: string[];
  highValueWeakCount: number;
  pendingReviewCount: number;
  askRunCount: number;
  commandJobCount: number;
  rehearsalComplete: boolean;
  launchNotesReady: boolean;
  networkThesis: string;
  referralLanes: string;
  prospectingFocus: string;
  outreachFocus: string;
  relationshipRules: string;
  ownerVoice: string;
  prospectingBucketCount: number;
};

export type ClientInstallQuestion = {
  key: string;
  question: string;
  why: string;
  href: string;
  priority: "critical" | "important" | "useful";
};

function hasText(value: string) {
  return value.trim().length > 0;
}

function hasModule(input: ClientInstallQuestionInput, label: RegExp) {
  return input.enabledModules.some((module) => label.test(module.toLowerCase()));
}

export function buildClientInstallQuestions(
  input: ClientInstallQuestionInput,
): ClientInstallQuestion[] {
  const questions: ClientInstallQuestion[] = [];

  if (input.contactCount === 0) {
    questions.push({
      key: "first-data-source",
      question:
        "Which source should seed the first real relationship records: contacts export, transcript history, correspondence summaries, or a curated owner list?",
      why: "The Book becomes useful only after real relationship context lands.",
      href: "/contacts",
      priority: "critical",
    });
  }

  if (input.enabledModules.length === 0) {
    questions.push({
      key: "enabled-modules",
      question:
        "Which owner-facing workflows are actually part of this install on day one?",
      why: "Modules should disappear unless they match the client promise.",
      href: "/settings",
      priority: "critical",
    });
  }

  if (!hasText(input.networkThesis)) {
    questions.push({
      key: "network-thesis",
      question:
        "What is the client trying to make happen through their network over the next 90 days?",
      why: "The network thesis keeps Ask, enrichment, prospecting, and next moves from becoming generic.",
      href: "/intake",
      priority: "critical",
    });
  }

  if (!hasText(input.relationshipRules)) {
    questions.push({
      key: "relationship-rules",
      question:
        "What relationship rules should Claude never violate for this client?",
      why: "Guardrails protect trust before automation or enrichment gets clever.",
      href: "/intake",
      priority: "important",
    });
  }

  if (hasModule(input, /want to know|prospecting/) && input.prospectingBucketCount === 0) {
    questions.push({
      key: "prospecting-buckets",
      question:
        "What are the named prospecting buckets for this client, and what does success mean inside each one?",
      why: "Podcast hosts, investors, acquisition targets, partners, and referral sources need different logic.",
      href: "/settings",
      priority: "important",
    });
  }

  if (hasModule(input, /networking|referral/) && !hasText(input.referralLanes)) {
    questions.push({
      key: "referral-lanes",
      question:
        "What kinds of introductions is the client truly willing to make or receive?",
      why: "Referral readiness is judgment-heavy and should not be inferred from volume alone.",
      href: "/intake",
      priority: "important",
    });
  }

  if (hasModule(input, /engagement|outreach|want to know/) && !hasText(input.outreachFocus)) {
    questions.push({
      key: "outreach-focus",
      question:
        "What kind of outreach should this install support, and what kind should it avoid?",
      why: "A useful relationship touch is not the same thing as a campaign.",
      href: "/intake",
      priority: "important",
    });
  }

  if (!hasText(input.ownerVoice)) {
    questions.push({
      key: "owner-voice",
      question:
        "What should the owner sound like when Claude drafts a follow-up, rewarm, or intro note?",
      why: "The product should feel like the executive, not like a generic assistant.",
      href: "/intake",
      priority: "useful",
    });
  }

  if (input.highValueWeakCount > 0) {
    questions.push({
      key: "high-value-weak-records",
      question:
        "Which high-value relationships must be verified before the owner relies on the Book for referrals or asks?",
      why: "Weak high-value records can make the product feel smart in the wrong direction.",
      href: "/quality",
      priority: "critical",
    });
  }

  if (input.pendingReviewCount > 0) {
    questions.push({
      key: "pending-review-owner",
      question:
        "Do any pending proposals need owner judgment before they can be approved or dismissed?",
      why: "The Changes queue is where trust-sensitive inference becomes verified relationship context.",
      href: "/changes",
      priority: "important",
    });
  }

  if (input.askRunCount === 0 && input.contactCount > 0) {
    questions.push({
      key: "ask-proof",
      question:
        "What is one real question the owner will ask the Book during the first week?",
      why: "A launch-ready install should prove query usefulness against the client's real data.",
      href: "/ask",
      priority: "important",
    });
  }

  if (input.commandJobCount === 0 && input.contactCount > 0) {
    questions.push({
      key: "claude-command-proof",
      question:
        "Which Claude-powered action should be rehearsed end to end before handoff?",
      why: "The app needs proof that Claude output becomes visible, reviewable, and actionable.",
      href: "/ops",
      priority: "important",
    });
  }

  if (!input.rehearsalComplete && input.commandJobCount > 0) {
    questions.push({
      key: "launch-rehearsal",
      question:
        "Which contact should be used to prove the final job-to-action rehearsal?",
      why: "The launch rehearsal catches lifecycle gaps before the executive experiences them.",
      href: "/launch",
      priority: "important",
    });
  }

  if (!input.launchNotesReady) {
    questions.push({
      key: "launch-notes",
      question:
        "What should the operator remember about this exact client install after launch?",
      why: "Concierge customization needs a durable handoff note, not just memory.",
      href: "/settings",
      priority: "useful",
    });
  }

  return questions
    .sort(
      (a, b) =>
        priorityRank[b.priority] - priorityRank[a.priority] ||
        a.question.localeCompare(b.question),
    )
    .slice(0, 8);
}

const priorityRank = {
  critical: 3,
  important: 2,
  useful: 1,
};
