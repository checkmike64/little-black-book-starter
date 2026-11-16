export type PromiseOperatingBriefRow = {
  id: string;
  contact_id: string | null;
  direction: string;
  due_on: string | null;
  promise_text: string;
  status: string;
  source: string | null;
  contacts?: {
    id: string | null;
    full_name: string | null;
    company_name?: string | null;
  } | null;
};

export type PromiseOperatingBrief = {
  actionHref: string;
  actionLabel: string;
  detail: string;
  filterHref: string;
  headline: string;
  lead: PromiseOperatingBriefRow | null;
  metrics: Array<{ label: string; value: number | string }>;
  movementHref: string;
  pressure: "trust_risk" | "waiting_on_other" | "clear";
  secondaryLabel: string;
  tone: "hot" | "gold" | "cool";
};

const closedStatuses = new Set(["completed", "skipped", "stopped"]);
const MS_PER_DAY = 86_400_000;

function utcDay(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function daysUntil(value: string | null | undefined, now: Date) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return Math.round((utcDay(parsed) - utcDay(now)) / MS_PER_DAY);
}

function ownerOwes(promise: PromiseOperatingBriefRow) {
  return promise.direction === "owner_owes_contact";
}

function isOpen(promise: PromiseOperatingBriefRow) {
  return promise.status === "open" && !closedStatuses.has(promise.status);
}

function promiseContactHref(promise: PromiseOperatingBriefRow) {
  const contactId = promise.contacts?.id ?? promise.contact_id;
  return contactId ? `/contacts/${contactId}` : null;
}

function leadScore(promise: PromiseOperatingBriefRow, now: Date) {
  if (!isOpen(promise)) return -1;

  const delta = daysUntil(promise.due_on, now);
  const timeScore =
    delta !== null && delta < 0
      ? 120 + Math.min(Math.abs(delta), 30)
      : delta === 0
        ? 112
        : delta !== null && delta <= 7
          ? 94 - delta
          : delta === null
            ? 58
            : 42;

  return timeScore + (ownerOwes(promise) ? 30 : 0);
}

function leadPromise(promises: PromiseOperatingBriefRow[], now: Date) {
  return [...promises]
    .filter(isOpen)
    .sort((a, b) => leadScore(b, now) - leadScore(a, now))
    .at(0) ?? null;
}

export function buildPromiseOperatingBrief(
  promises: PromiseOperatingBriefRow[],
  now = new Date(),
): PromiseOperatingBrief {
  const open = promises.filter(isOpen);
  const ownerOpen = open.filter(ownerOwes);
  const waitingOpen = open.filter((promise) => !ownerOwes(promise));
  const overdue = open.filter((promise) => {
    const delta = daysUntil(promise.due_on, now);
    return delta !== null && delta < 0;
  });
  const dueSoon = open.filter((promise) => {
    const delta = daysUntil(promise.due_on, now);
    return delta !== null && delta >= 0 && delta <= 7;
  });
  const lead = leadPromise(promises, now);

  if (!lead) {
    return {
      actionHref: "/ask?mode=search&q=open%20promises",
      actionLabel: "Ask the Book",
      detail:
        "No open commitments are waiting. Use Ask when you want to scan recent context for missed promises.",
      filterHref: "/promises?filter=closed",
      headline: "Promise loops are clear",
      lead: null,
      metrics: [
        { label: "Open", value: 0 },
        { label: "You owe", value: 0 },
        { label: "They owe", value: 0 },
        {
          label: "Closed",
          value: promises.filter((promise) => closedStatuses.has(promise.status)).length,
        },
      ],
      movementHref: "/movement",
      pressure: "clear",
      secondaryLabel: "Closed promises",
      tone: "cool",
    };
  }

  const contact = lead.contacts?.full_name ?? "No contact linked";
  const href = promiseContactHref(lead);
  const delta = daysUntil(lead.due_on, now);
  const urgent = delta !== null && delta <= 0;
  const pressure = ownerOwes(lead) ? "trust_risk" : "waiting_on_other";

  return {
    actionHref: href ?? (ownerOwes(lead) ? "/promises?filter=owner" : "/promises?filter=contact"),
    actionLabel: href ? "Open relationship" : "Open promise lane",
    detail: ownerOwes(lead)
      ? `${contact} is waiting on the owner. Close, clarify, or intentionally stop this before adding more asks.`
      : `${contact} owes the owner something. Follow up or mark it no longer useful so the loop does not linger.`,
    filterHref: ownerOwes(lead) ? "/promises?filter=owner" : "/promises?filter=contact",
    headline: ownerOwes(lead)
      ? `Close the loop: ${lead.promise_text}`
      : `Follow up: ${lead.promise_text}`,
    lead,
    metrics: [
      { label: "Open", value: open.length },
      { label: "You owe", value: ownerOpen.length },
      { label: "They owe", value: waitingOpen.length },
      { label: "Overdue", value: overdue.length },
      { label: "Due week", value: dueSoon.length },
    ],
    movementHref: urgent ? "/movement?view=hot" : "/movement",
    pressure,
    secondaryLabel: ownerOwes(lead) ? "You owe lane" : "They owe lane",
    tone: urgent || ownerOwes(lead) ? "hot" : "gold",
  };
}
