export type ScoreboardPulseInput = {
  connectionRate: number;
  promiseKeepRate: number;
  warmRate: number;
  dataReadiness: number;
  duePromiseCount: number;
  staleTrustedCount: number;
  pendingChangeCount: number;
  movementRiskCount: number;
};

export type ScoreboardPulseSignal = {
  label: string;
  value: string;
  tone: "ok" | "warn" | "neutral";
  detail: string;
};

export type ScoreboardPulse = {
  score: number;
  status: "Strong" | "Attention" | "At Risk";
  tone: "cool" | "gold" | "hot";
  headline: string;
  detail: string;
  nextAction: {
    label: string;
    href: string;
    detail: string;
  };
  signals: ScoreboardPulseSignal[];
};

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function signal({
  detail,
  label,
  ok,
  value,
  warnWhenFalse = true,
}: {
  detail: string;
  label: string;
  ok: boolean;
  value: string;
  warnWhenFalse?: boolean;
}): ScoreboardPulseSignal {
  return {
    label,
    value,
    detail,
    tone: ok ? "ok" : warnWhenFalse ? "warn" : "neutral",
  };
}

export function buildScoreboardPulse(
  input: ScoreboardPulseInput,
): ScoreboardPulse {
  const dataReadiness = clamp(input.dataReadiness);
  const warmRate = clamp(input.warmRate);
  const promiseKeepRate = clamp(input.promiseKeepRate);
  const connectionRate = clamp(input.connectionRate);

  const riskPenalty =
    input.duePromiseCount * 10 +
    input.pendingChangeCount * 5 +
    input.staleTrustedCount * 4 +
    input.movementRiskCount * 3;

  const score = clamp(
    dataReadiness * 0.34 +
      warmRate * 0.22 +
      promiseKeepRate * 0.24 +
      connectionRate * 0.2 -
      riskPenalty,
  );

  const urgentRiskCount =
    input.duePromiseCount + input.pendingChangeCount + input.staleTrustedCount;
  const status: ScoreboardPulse["status"] =
    score >= 75 && urgentRiskCount === 0
      ? "Strong"
      : score >= 50
        ? "Attention"
        : "At Risk";
  const tone: ScoreboardPulse["tone"] =
    status === "Strong" ? "cool" : status === "Attention" ? "gold" : "hot";

  const nextAction =
    input.duePromiseCount > 0
      ? {
          label: "Review promises",
          href: "/promises",
          detail: "Start with anything that is overdue.",
        }
      : input.pendingChangeCount > 0
        ? {
            label: "Review updates",
            href: "/changes",
            detail: "Confirm or dismiss the updates waiting for you.",
          }
        : input.staleTrustedCount > 0
          ? {
              label: "Reconnect",
              href: "/engagement",
              detail: "Start with a trusted relationship that has gone quiet.",
            }
          : input.dataReadiness < 80
            ? {
                label: "Complete profiles",
                href: "/contacts?view=judgment",
                detail: "Add the missing details that improve referrals and introductions.",
              }
            : {
                label: "Open follow-ups",
                href: "/movement",
                detail: "Pick the most useful open follow-up.",
              };

  return {
    score,
    status,
    tone,
    headline:
      status === "Strong"
        ? "Your relationships are in good shape"
        : status === "Attention"
          ? "A few relationships need your attention"
          : "Start with the overdue items",
    detail:
      urgentRiskCount > 0
        ? `${urgentRiskCount} item${urgentRiskCount === 1 ? "" : "s"} should be handled first.`
        : "Nothing urgent is waiting.",
    nextAction,
    signals: [
      signal({
        label: "Promises",
        value: `${promiseKeepRate}%`,
        ok: input.duePromiseCount === 0 && promiseKeepRate >= 70,
        detail:
          input.duePromiseCount > 0
            ? `${input.duePromiseCount} promise${input.duePromiseCount === 1 ? " is" : "s are"} overdue.`
            : "Nothing is overdue.",
      }),
      signal({
        label: "Relationships",
        value: `${warmRate}%`,
        ok: input.staleTrustedCount === 0 && warmRate >= 40,
        detail:
          input.staleTrustedCount > 0
            ? `${input.staleTrustedCount} trusted relationship${input.staleTrustedCount === 1 ? " has" : "s have"} gone quiet.`
            : "Trusted relationships are on track.",
      }),
      signal({
        label: "Updates",
        value: String(input.pendingChangeCount),
        ok: input.pendingChangeCount === 0,
        detail:
          input.pendingChangeCount > 0
            ? "Updates are waiting for your review."
            : "No updates are waiting.",
      }),
      signal({
        label: "Profile details",
        value: `${dataReadiness}%`,
        ok: dataReadiness >= 80,
        detail:
          dataReadiness >= 80
            ? "Most profiles have enough detail."
            : "Some profiles need more detail.",
      }),
      signal({
        label: "Introductions",
        value: `${connectionRate}%`,
        ok: connectionRate >= 50 || connectionRate === 0,
        warnWhenFalse: false,
        detail:
          connectionRate > 0
            ? "Introductions created and sent."
            : "No introduction history is available yet.",
      }),
    ],
  };
}
