export type ScoreboardPlanPromise = {
  id: string;
  promise_text: string;
  direction: string;
  due_on: string | null;
  contacts?: {
    id?: string | null;
    full_name: string | null;
  } | null;
};

export type ScoreboardPlanContact = {
  id: string;
  full_name: string;
  company_name: string | null;
  trust_level: string | null;
  relationship_strength: string | null;
  last_spoke: string | null;
  current_asks: string | null;
  wants_help_with: string | null;
  ideal_referral: string | null;
  podcast_fit: string | null;
};

export type ScoreboardPlanChange = {
  id: string;
  summary: string;
  risk_level: string | null;
  contacts?: {
    id?: string | null;
    full_name: string | null;
  } | null;
};

export type ScoreboardPlanMovement = {
  key: string;
  title: string;
  detail: string;
  href: string;
  tone: "hot" | "gold" | "cool" | "warn";
};

export type ScoreboardPlanInput = {
  contactCount: number;
  duePromises: ScoreboardPlanPromise[];
  staleTrusted: ScoreboardPlanContact[];
  pendingChanges: ScoreboardPlanChange[];
  movementQueue: ScoreboardPlanMovement[];
  dataReadiness: number;
  weakRecordCount: number;
  highValueWeakCount: number;
  recentInteractionCount: number;
  connectionRate: number;
  promiseKeepRate: number;
};

export type ScoreboardPlanAction = {
  label: string;
  href: string;
  detail: string;
  metric: string;
  tone: "hot" | "gold" | "cool" | "neutral";
};

export type ScoreboardActionPlan = {
  mode:
    | "Setup"
    | "Protect Trust"
    | "Review Judgment"
    | "Move Relationships"
    | "Rewarm"
    | "Improve Data"
    | "Grow";
  headline: string;
  detail: string;
  primary: ScoreboardPlanAction;
  secondary: ScoreboardPlanAction[];
  watchlist: string[];
};

function percent(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function contactName(row: ScoreboardPlanPromise | ScoreboardPlanChange) {
  return row.contacts?.full_name ?? "Unmatched contact";
}

function promiseLabel(row: ScoreboardPlanPromise) {
  const ownerOwes = row.direction === "owner_owes_contact";
  return `${ownerOwes ? "You owe" : "They owe"} ${contactName(row)}: ${
    row.promise_text
  }`;
}

function staleLabel(row: ScoreboardPlanContact) {
  const value = [
    row.full_name,
    row.company_name,
    row.current_asks ?? row.wants_help_with ?? row.ideal_referral ?? row.podcast_fit,
  ]
    .filter(Boolean)
    .join(" · ");

  return value || row.full_name;
}

function topChange(input: ScoreboardPlanInput) {
  return (
    input.pendingChanges.find((change) => change.risk_level === "high") ??
    input.pendingChanges[0] ??
    null
  );
}

export function buildScoreboardActionPlan(
  input: ScoreboardPlanInput,
): ScoreboardActionPlan {
  const highRiskChanges = input.pendingChanges.filter(
    (change) => change.risk_level === "high",
  );
  const hotMovement = input.movementQueue.filter((item) => item.tone === "hot");
  const watchlist = [
    input.duePromises[0] ? promiseLabel(input.duePromises[0]) : null,
    highRiskChanges[0]
      ? `Review ${contactName(highRiskChanges[0])}: ${highRiskChanges[0].summary}`
      : null,
    input.staleTrusted[0] ? `Rewarm ${staleLabel(input.staleTrusted[0])}` : null,
    hotMovement[0] ? `Movement risk: ${hotMovement[0].title}` : null,
  ].filter((item): item is string => Boolean(item));

  const secondary: ScoreboardPlanAction[] = [
    input.pendingChanges.length > 0
      ? {
          label: "Review updates",
          href: "/changes",
          detail: `${input.pendingChanges.length} proposed update${
            input.pendingChanges.length === 1 ? "" : "s"
          } need a decision.`,
          metric: String(input.pendingChanges.length),
          tone: highRiskChanges.length > 0 ? "hot" : "gold",
        }
      : null,
    input.movementQueue.length > 0
      ? {
          label: "Open follow-ups",
          href: "/movement",
          detail: `${input.movementQueue.length} relationship move${
            input.movementQueue.length === 1 ? "" : "s"
          } are open.`,
          metric: String(input.movementQueue.length),
          tone: hotMovement.length > 0 ? "hot" : "cool",
        }
      : null,
    input.highValueWeakCount > 0
      ? {
          label: "Complete profiles",
          href: "/contacts?view=judgment",
          detail: `${input.highValueWeakCount} high-value record${
            input.highValueWeakCount === 1 ? "" : "s"
          } need better context.`,
          metric: String(input.highValueWeakCount),
          tone: "gold",
        }
      : null,
  ].filter((item): item is ScoreboardPlanAction => Boolean(item));

  if (input.contactCount === 0) {
    return {
      mode: "Setup",
      headline: "Add your first contacts",
      detail: "Your Book will start working as soon as contacts are added.",
      primary: {
        label: "Open My Book",
        href: "/contacts",
        detail: "Add people and the details that matter.",
        metric: "0",
        tone: "hot",
      },
      secondary,
      watchlist: ["No private contacts are visible yet."],
    };
  }

  if (input.duePromises.length > 0) {
    return {
      mode: "Protect Trust",
      headline: "Take care of overdue promises",
      detail: "Start with what you said you would do.",
      primary: {
        label: "Review promises",
        href: "/promises",
        detail: promiseLabel(input.duePromises[0]),
        metric: String(input.duePromises.length),
        tone: "hot",
      },
      secondary,
      watchlist,
    };
  }

  const reviewChange = topChange(input);
  if (reviewChange && highRiskChanges.length > 0) {
    return {
      mode: "Review Judgment",
      headline: "Review important updates",
      detail: "Confirm changes to trust, referrals, and private notes.",
      primary: {
        label: "Review updates",
        href: "/changes",
        detail: `${contactName(reviewChange)}: ${reviewChange.summary}`,
        metric: String(highRiskChanges.length),
        tone: "hot",
      },
      secondary,
      watchlist,
    };
  }

  if (hotMovement.length > 0 || input.movementQueue.length >= 5) {
    const top = hotMovement[0] ?? input.movementQueue[0];
    return {
      mode: "Move Relationships",
      headline: "Finish the most useful follow-up",
      detail: "Start with the first open item.",
      primary: {
        label: "Open follow-up",
        href: top.href,
        detail: `${top.title} · ${top.detail}`,
        metric: String(input.movementQueue.length),
        tone: top.tone === "hot" ? "hot" : "gold",
      },
      secondary,
      watchlist,
    };
  }

  if (input.staleTrusted.length > 0) {
    return {
      mode: "Rewarm",
      headline: "Reconnect with someone important",
      detail: "Start with a trusted relationship that has gone quiet.",
      primary: {
        label: "Find a recent post",
        href: "/engagement",
        detail: staleLabel(input.staleTrusted[0]),
        metric: String(input.staleTrusted.length),
        tone: "gold",
      },
      secondary,
      watchlist,
    };
  }

  if (input.dataReadiness < 80 || input.highValueWeakCount > 0) {
    return {
      mode: "Improve Data",
      headline: "Complete the profiles that matter most",
      detail: "Better details lead to better referrals and introductions.",
      primary: {
        label: "Complete profiles",
        href: "/contacts?view=judgment",
        detail: `${input.highValueWeakCount} priority profile${input.highValueWeakCount === 1 ? "" : "s"}, ${input.weakRecordCount} total need more detail.`,
        metric: percent(input.dataReadiness),
        tone: "gold",
      },
      secondary,
      watchlist,
    };
  }

  return {
    mode: "Grow",
    headline: "Your Book is ready",
    detail: "Open your contacts and choose the next relationship to move forward.",
    primary: {
      label: "Open My Book",
      href: "/contacts",
      detail: `${input.recentInteractionCount} recent interaction${
        input.recentInteractionCount === 1 ? "" : "s"
      }, ${percent(input.promiseKeepRate)} promise discipline, ${percent(
        input.connectionRate,
      )} intro conversion.`,
      metric: "Ready",
      tone: "cool",
    },
    secondary,
    watchlist: watchlist.length
      ? watchlist
      : ["Nothing urgent is waiting."],
  };
}
