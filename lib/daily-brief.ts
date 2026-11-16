import type { DailyPriority } from "./daily-priorities.js";

export type DailyBriefInput = {
  topPriority: DailyPriority;
  contactCount: number;
  pendingChangeCount: number;
  askRunUndecidedCount: number;
  overduePromises: number;
  highRiskChanges: number;
  hotRelationshipActions: number;
  untrackedCommandOutputs: number;
  staleUsefulContacts: number;
};

export type DailyBrief = {
  mode: "Setup" | "Protect Trust" | "Verify Judgment" | "Move Work" | "Rewarm" | "Ask";
  tone: "hot" | "gold" | "cool";
  headline: string;
  detail: string;
  nextLabel: string;
  href: string;
  signals: Array<{
    label: string;
    value: string;
    tone: "hot" | "gold" | "cool";
  }>;
};

function plural(count: number, singular: string, pluralWord = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

export function buildDailyBrief(input: DailyBriefInput): DailyBrief {
  const pressure =
    input.overduePromises +
    input.highRiskChanges +
    input.hotRelationshipActions +
    input.untrackedCommandOutputs +
    input.askRunUndecidedCount;

  const base = {
    nextLabel: input.topPriority.action,
    href: input.topPriority.href,
    signals: [
      {
        label: "Trust",
        value: String(input.overduePromises),
        tone: input.overduePromises > 0 ? "hot" : "cool",
      },
      {
        label: "Review",
        value: String(input.pendingChangeCount),
        tone:
          input.highRiskChanges > 0
            ? "hot"
            : input.pendingChangeCount > 0
              ? "gold"
              : "cool",
      },
      {
        label: "Moves",
        value: String(input.hotRelationshipActions),
        tone: input.hotRelationshipActions > 0 ? "hot" : "cool",
      },
      {
        label: "Rewarm",
        value: String(input.staleUsefulContacts),
        tone: input.staleUsefulContacts > 0 ? "gold" : "cool",
      },
    ],
  } satisfies Pick<DailyBrief, "href" | "nextLabel" | "signals">;

  if (input.contactCount === 0) {
    return {
      ...base,
      mode: "Setup",
      tone: "gold",
      headline: "The Book needs relationship data before daily use",
      detail:
        "The first verified contacts need to be loaded before Ask, movement, and review loops have real context.",
      nextLabel: "Open the book",
      href: "/contacts",
    };
  }

  if (input.overduePromises > 0) {
    return {
      ...base,
      mode: "Protect Trust",
      tone: "hot",
      headline: "Close promise pressure before adding new volume",
      detail: `${plural(
        input.overduePromises,
        "promise",
      )} are due or overdue. Trust-preservation work should lead the day.`,
    };
  }

  if (input.highRiskChanges > 0 || input.askRunUndecidedCount > 0) {
    return {
      ...base,
      mode: "Verify Judgment",
      tone: "hot",
      headline: "Review judgment-sensitive items before relying on the Book",
      detail:
        input.highRiskChanges > 0
          ? `${plural(input.highRiskChanges, "high-risk change")} need approval, dismissal, or owner context.`
          : `${plural(input.askRunUndecidedCount, "Ask run")} need follow-up or no-action decisions.`,
      href: input.highRiskChanges > 0 ? "/changes" : "/ask?saved=needs_decision",
      nextLabel: input.highRiskChanges > 0 ? "Review changes" : "Close Ask decisions",
    };
  }

  if (input.hotRelationshipActions > 0 || input.untrackedCommandOutputs > 0) {
    return {
      ...base,
      mode: "Move Work",
      tone: "gold",
      headline: "Turn relationship signal into completed movement",
      detail:
        input.hotRelationshipActions > 0
          ? `${plural(input.hotRelationshipActions, "hot action")} are due now.`
          : `${plural(input.untrackedCommandOutputs, "Claude output")} should become tracked movement or be dismissed.`,
      href: input.hotRelationshipActions > 0 ? input.topPriority.href : "/movement",
      nextLabel: input.hotRelationshipActions > 0 ? input.topPriority.action : "Work movement",
    };
  }

  if (input.staleUsefulContacts > 0) {
    return {
      ...base,
      mode: "Rewarm",
      tone: "gold",
      headline: "Useful relationships are cooling off",
      detail: `${plural(
        input.staleUsefulContacts,
        "high-value relationship",
        "high-value relationships",
      )} have gone stale enough to deserve a light touch.`,
      href: "/engagement",
      nextLabel: "Open engagement",
    };
  }

  return {
    ...base,
    mode: "Ask",
    tone: pressure > 0 ? "gold" : "cool",
    headline: "No urgent queue is blocking daily use",
    detail:
      "Use the Book to find a useful intro, referral lane, reconnection, or prospecting path.",
    href: "/ask",
    nextLabel: "Ask the book",
  };
}
