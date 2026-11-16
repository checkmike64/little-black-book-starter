export type MovementViewBriefView =
  | "active"
  | "hot"
  | "high"
  | "needs_date"
  | "from_ask"
  | "from_claude"
  | "closed"
  | "all";

type MovementViewBriefSourceMix = {
  ask: number;
  claude: number;
  ownerVerification: number;
  primary: {
    href: string;
    tone: "cool" | "gold" | "hot";
  };
};

type MovementViewBriefSummary = {
  closed: number;
  dueToday: number;
  dueSoon: number;
  open: number;
  overdue: number;
  unscheduled: number;
};

export function buildMovementViewBrief({
  filteredCount,
  query,
  sourceMix,
  summary,
  undecidedAskRuns,
  view,
}: {
  filteredCount: number;
  query: string;
  sourceMix: MovementViewBriefSourceMix;
  summary: MovementViewBriefSummary;
  undecidedAskRuns: number;
  view: MovementViewBriefView;
}) {
  const searchNote = query ? ` Matching "${query}".` : "";
  const baseMetrics = [
    { label: "Showing", value: filteredCount },
    { label: "Open", value: summary.open },
    { label: "Ask decisions", value: undecidedAskRuns },
  ];

  if (view === "from_ask") {
    return {
      actionHref: undecidedAskRuns > 0 ? "/ask?saved=needs_decision" : "/movement?view=from_ask",
      actionLabel: undecidedAskRuns > 0 ? "Close Ask decisions" : "Work Ask moves",
      detail:
        "These moves came from saved Ask decisions. Work them here once they are real follow-up, or close remaining Ask decisions before adding more.",
      metrics: [
        { label: "Ask moves", value: sourceMix.ask },
        { label: "Undecided", value: undecidedAskRuns },
        { label: "Showing", value: filteredCount },
      ],
      resetHref: "/movement",
      title: `Ask-created movement${searchNote}`,
      tone: sourceMix.ask > 0 ? "gold" : "cool",
    };
  }

  if (view === "from_claude") {
    return {
      actionHref: "/movement?view=hot",
      actionLabel: "Work hot moves",
      detail:
        "These moves were prepared from relationship evidence. Treat them as useful drafts until you act, reschedule, or close them.",
      metrics: [
        { label: "Suggested moves", value: sourceMix.claude },
        { label: "Hot", value: summary.overdue + summary.dueToday },
        { label: "Showing", value: filteredCount },
      ],
      resetHref: "/movement",
      title: `Suggested movement${searchNote}`,
      tone: sourceMix.claude > 0 ? "hot" : "cool",
    };
  }

  if (view === "hot") {
    return {
      actionHref: "/movement?view=hot",
      actionLabel: "Work hot moves",
      detail:
        "This lane is for overdue and due-today movement. Close, defer, or move the item forward before opening more optional work.",
      metrics: [
        { label: "Hot", value: summary.overdue + summary.dueToday },
        { label: "Overdue", value: summary.overdue },
        { label: "Today", value: summary.dueToday },
      ],
      resetHref: "/movement",
      title: `Time-sensitive movement${searchNote}`,
      tone: summary.overdue + summary.dueToday > 0 ? "hot" : "cool",
    };
  }

  if (view === "needs_date") {
    return {
      actionHref: "/movement?view=needs_date",
      actionLabel: "Schedule loose moves",
      detail:
        "These moves are useful but unscheduled. Add a date, defer intentionally, or close them so the queue stays decisive.",
      metrics: [
        { label: "Needs date", value: summary.unscheduled },
        { label: "Open", value: summary.open },
        { label: "Showing", value: filteredCount },
      ],
      resetHref: "/movement",
      title: `Movement without dates${searchNote}`,
      tone: summary.unscheduled > 0 ? "gold" : "cool",
    };
  }

  if (view === "high") {
    return {
      actionHref: "/movement?view=high",
      actionLabel: "Work high-priority",
      detail:
        "This lane keeps high-priority movement visible across follow-ups, owner verification, referrals, and generated work.",
      metrics: [
        { label: "High", value: filteredCount },
        { label: "Verify", value: sourceMix.ownerVerification },
        { label: "Open", value: summary.open },
      ],
      resetHref: "/movement",
      title: `High-priority movement${searchNote}`,
      tone: filteredCount > 0 ? "hot" : "cool",
    };
  }

  if (view === "closed") {
    return {
      actionHref: "/movement",
      actionLabel: "Return to active",
      detail:
        "Closed movement is history. Use it to confirm follow-through, then return to active work.",
      metrics: [
        { label: "Closed", value: summary.closed },
        { label: "Open", value: summary.open },
        { label: "Showing", value: filteredCount },
      ],
      resetHref: "/movement",
      title: `Closed movement history${searchNote}`,
      tone: "cool",
    };
  }

  if (view === "all") {
    return {
      actionHref: sourceMix.primary.href,
      actionLabel: "Open main lane",
      detail:
        "This shows active and closed movement together. Use it for inspection, then return to the lane with the most pressure.",
      metrics: [
        { label: "All", value: filteredCount },
        { label: "Open", value: summary.open },
        { label: "Closed", value: summary.closed },
      ],
      resetHref: "/movement",
      title: `All movement${searchNote}`,
      tone: "cool",
    };
  }

  return {
    actionHref: sourceMix.primary.href,
    actionLabel: "Open main lane",
    detail:
      "This is the active operating queue. Work what is hot, schedule what is loose, and keep generated moves from piling up.",
    metrics: baseMetrics,
    resetHref: "/movement",
    title: `Active movement${searchNote}`,
    tone: sourceMix.primary.tone,
  };
}
