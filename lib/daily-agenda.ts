import type { DailyBrief } from "./daily-brief.js";
import type { DailyPriority } from "./daily-priorities.js";

export type DailyAgendaItem = {
  label: string;
  title: string;
  detail: string;
  href: string;
  action: string;
  secondaryAction?: string;
  secondaryHref?: string;
  tone: "hot" | "gold" | "cool";
};

export type DailyAgenda = {
  headline: string;
  focus: string;
  primary: DailyAgendaItem;
  decisions: DailyAgendaItem[];
  keepWarm: DailyAgendaItem[];
  ignoreForNow: string;
};

function tone(priority: DailyPriority): DailyAgendaItem["tone"] {
  if (priority.tone === "hot" || priority.tone === "warn") return "hot";
  if (priority.tone === "gold") return "gold";
  return "cool";
}

function item(priority: DailyPriority, label: string): DailyAgendaItem {
  return {
    label,
    title: priority.title,
    detail: priority.reason || priority.detail,
    href: priority.href,
    action: priority.action,
    secondaryAction: priority.secondaryAction,
    secondaryHref: priority.secondaryHref,
    tone: tone(priority),
  };
}

function isDecision(priority: DailyPriority) {
  return (
    priority.key.startsWith("change:") ||
    priority.eyebrow.toLowerCase().includes("verify") ||
    priority.suggestedActionType === "owner_verification"
  );
}

function isWarmth(priority: DailyPriority) {
  return (
    priority.key.startsWith("contact:") ||
    priority.suggestedActionType === "reconnect" ||
    priority.eyebrow.toLowerCase().includes("rewarm")
  );
}

export function buildDailyAgenda({
  brief,
  priorities,
}: {
  brief: DailyBrief;
  priorities: DailyPriority[];
}): DailyAgenda {
  if (brief.mode === "Setup") {
    return {
      headline: brief.headline,
      focus: brief.detail,
      primary: {
        label: "Do first",
        title: "Wait for the first verified relationship data",
        detail:
          "The relationship system becomes useful once real contacts, context, and reviewable updates are present.",
        href: brief.href,
        action: brief.nextLabel,
        tone: brief.tone,
      },
      decisions: [],
      keepWarm: [],
      ignoreForNow:
        "Do not use manual self-serve contact entry as the default path. Let the concierge import and verification flow establish the Book first.",
    };
  }

  const [top, ...rest] = priorities;
  const primary = item(top, "Do first");
  const decisions = rest.filter(isDecision).slice(0, 3).map((priority) => item(priority, "Decide"));
  const keepWarm = rest.filter(isWarmth).slice(0, 3).map((priority) => item(priority, "Keep warm"));
  const support = rest
    .filter((priority) => !isDecision(priority) && !isWarmth(priority))
    .slice(0, 2)
    .map((priority) => item(priority, "If time"));

  return {
    headline:
      brief.mode === "Ask"
        ? "Use the Book to create one useful relationship move"
        : brief.headline,
    focus: brief.detail,
    primary,
    decisions: decisions.length ? decisions : support,
    keepWarm,
    ignoreForNow:
      brief.mode === "Protect Trust"
        ? "New prospecting and broad outreach can wait until due promises are closed."
        : brief.mode === "Verify Judgment"
          ? "Do not rely on unreviewed judgment-heavy context for outreach yet."
          : brief.mode === "Move Work"
            ? "Avoid creating more Claude output until the current movement queue is handled."
            : brief.mode === "Rewarm"
              ? "Skip generic check-ins; use a specific, useful touch."
              : "Do not optimize the whole database today. Create one useful move.",
  };
}
