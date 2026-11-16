export type WeeklyEngagementPromise = {
  direction: string;
  due_on: string | null;
  promise_text: string;
};

export type WeeklyEngagementCandidate = {
  id: string;
  full_name: string;
  company_name: string | null;
  priority: "P1" | "P2" | "P3" | "P4";
  rung: "Follow through" | "Be useful" | "Comment" | "Like";
  promises: WeeklyEngagementPromise[];
  score: number;
  nextAction: string;
  risk: string;
  why: string;
  staleDays: number | null;
  recent_activity: string | null;
};

export type WeeklyEngagementPlan = {
  posture: "protect_trust" | "use_opportunities" | "rewarm" | "maintain";
  tone: "hot" | "gold" | "cool";
  title: string;
  detail: string;
  targetTouches: number;
  paceLabel: string;
  lead: WeeklyEngagementCandidate | null;
  lanes: Array<{
    key: "must_close" | "be_useful" | "rewarm" | "light_touch";
    label: string;
    detail: string;
    items: WeeklyEngagementCandidate[];
  }>;
  counts: {
    mustClose: number;
    beUseful: number;
    rewarm: number;
    lightTouch: number;
    selected: number;
  };
  guardrail: string;
};

type WeeklyEngagementPlanInput = {
  queue: WeeklyEngagementCandidate[];
  recentInteractionCount: number;
  signalCount: number;
  targetTouches?: number;
};

function hasOwnerPromise(candidate: WeeklyEngagementCandidate) {
  return candidate.promises.some((promise) => promise.direction === "owner_owes_contact");
}

function uniqueById(items: WeeklyEngagementCandidate[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function takeUntilTarget(
  targetTouches: number,
  ...groups: WeeklyEngagementCandidate[][]
) {
  const selected: WeeklyEngagementCandidate[] = [];

  groups.forEach((group) => {
    group.forEach((item) => {
      if (selected.length >= targetTouches) return;
      if (selected.some((selectedItem) => selectedItem.id === item.id)) return;
      selected.push(item);
    });
  });

  return selected;
}

export function buildEngagementWeeklyPlan({
  queue,
  recentInteractionCount,
  signalCount,
  targetTouches = 7,
}: WeeklyEngagementPlanInput): WeeklyEngagementPlan {
  const mustClose = queue.filter(
    (item) =>
      item.rung === "Follow through" ||
      (item.priority === "P1" && hasOwnerPromise(item)) ||
      /trust risk|open owner promise/i.test(item.risk),
  );
  const beUseful = queue.filter(
    (item) =>
      !mustClose.some((closeItem) => closeItem.id === item.id) &&
      (item.rung === "Be useful" || /active opportunity/i.test(item.risk)),
  );
  const rewarm = queue.filter(
    (item) =>
      !mustClose.some((closeItem) => closeItem.id === item.id) &&
      !beUseful.some((usefulItem) => usefulItem.id === item.id) &&
      (item.priority === "P3" || (item.staleDays ?? 0) >= 90),
  );
  const lightTouch = queue.filter(
    (item) =>
      !mustClose.some((closeItem) => closeItem.id === item.id) &&
      !beUseful.some((usefulItem) => usefulItem.id === item.id) &&
      !rewarm.some((rewarmItem) => rewarmItem.id === item.id),
  );
  const selected = takeUntilTarget(targetTouches, mustClose, beUseful, rewarm, lightTouch);
  const paceLabel =
    recentInteractionCount >= targetTouches
      ? "On pace"
      : `${Math.max(0, targetTouches - recentInteractionCount)} touch${
          Math.max(0, targetTouches - recentInteractionCount) === 1 ? "" : "es"
        } to target`;

  const posture =
    mustClose.length > 0
      ? "protect_trust"
      : beUseful.length > 0
        ? "use_opportunities"
        : rewarm.length > 0
          ? "rewarm"
          : "maintain";
  const title =
    posture === "protect_trust"
      ? "Protect trust before adding outreach"
      : posture === "use_opportunities"
        ? "Use the warm opportunities already in the book"
        : posture === "rewarm"
          ? "Rewarm valuable relationships"
          : "Maintain light relationship rhythm";
  const detail =
    posture === "protect_trust"
      ? `${mustClose.length} follow-through item${
          mustClose.length === 1 ? "" : "s"
        } should close before broader engagement.`
      : posture === "use_opportunities"
        ? `${beUseful.length} useful touch${
            beUseful.length === 1 ? "" : "es"
          } can create momentum this week.`
        : posture === "rewarm"
          ? `${rewarm.length} relationship${
              rewarm.length === 1 ? "" : "s"
            } need a specific reactivation touch.`
          : `${signalCount} recent signal${
              signalCount === 1 ? "" : "s"
            } can guide light-touch engagement.`;

  return {
    posture,
    tone: posture === "protect_trust" ? "hot" : posture === "maintain" ? "cool" : "gold",
    title,
    detail,
    targetTouches,
    paceLabel,
    lead: selected[0] ?? null,
    lanes: [
      {
        key: "must_close",
        label: "Must Close",
        detail: "Promises, trust risk, and owner follow-through.",
        items: uniqueById(mustClose).slice(0, 5),
      },
      {
        key: "be_useful",
        label: "Be Useful",
        detail: "Active asks, referral lanes, podcast lanes, or direct help.",
        items: uniqueById(beUseful).slice(0, 5),
      },
      {
        key: "rewarm",
        label: "Rewarm",
        detail: "Valuable relationships past cadence or cooling down.",
        items: uniqueById(rewarm).slice(0, 5),
      },
      {
        key: "light_touch",
        label: "Light Touch",
        detail: "Lower-pressure comments, likes, and goodwill touches.",
        items: uniqueById(lightTouch).slice(0, 5),
      },
    ],
    counts: {
      mustClose: mustClose.length,
      beUseful: beUseful.length,
      rewarm: rewarm.length,
      lightTouch: lightTouch.length,
      selected: selected.length,
    },
    guardrail:
      "Do not create more outreach before closing owner promises; use Claude for wording, but write judgment changes through review.",
  };
}
