import { buildKeepInTouchQueue, defaultKeepInTouchSettings, explicitCadenceDays, type KeepInTouchSettings } from "./keep-in-touch.ts";

export type MovementContact = {
  id: string;
  full_name: string | null;
  company_name: string | null;
  trust_level: string | null;
  relationship_strength: string | null;
  relationship_type?: string[] | null;
  touch_cadence?: string | null;
  last_spoke: string | null;
  current_asks?: string | null;
  wants_help_with?: string | null;
  ideal_referral?: string | null;
  podcast_fit?: string | null;
  recent_activity?: string | null;
};

export type MovementPromise = {
  id: string;
  promise_text: string;
  direction: string;
  due_on: string | null;
  contacts?: {
    id?: string | null;
    full_name: string | null;
  } | null;
};

export type MovementIntroduction = {
  id: string;
  person_a: string | null;
  person_b: string | null;
  date_proposed: string | null;
  date_made: string | null;
  why_context: string | null;
  status: string;
  follow_up_on: string | null;
  person_a_contact?: {
    id?: string | null;
    full_name: string | null;
  } | null;
  person_b_contact?: {
    id?: string | null;
    full_name: string | null;
  } | null;
};

export type RelationshipMovementItem = {
  key: string;
  kind: "promise" | "introduction" | "rewarm" | "opportunity";
  actionKind:
    | "complete_promise"
    | "inspect_promise"
    | "advance_intro"
    | "follow_up_intro"
    | "close_intro"
    | "log_touch"
    | "use_opportunity";
  recordId: string;
  title: string;
  detail: string;
  reason: string;
  href: string;
  action: string;
  tone: "hot" | "gold" | "cool" | "warn";
  score: number;
  contactId?: string | null;
};

type MovementInput = {
  keepInTouchSettings?: KeepInTouchSettings;
  timeZone?: string;
  contacts: MovementContact[];
  promises: MovementPromise[];
  introductions: MovementIntroduction[];
};

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function dayDelta(value: string | null | undefined) {
  const parsed = parseDate(value);
  if (parsed === null) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(parsed);
  target.setHours(0, 0, 0, 0);

  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function daysSince(value: string | null | undefined) {
  const delta = dayDelta(value);
  return delta === null ? null : Math.max(0, -delta);
}

export function movementDueLabel(value: string | null | undefined) {
  const delta = dayDelta(value);
  if (delta === null) return "No due date";
  if (delta < 0) {
    return `${Math.abs(delta)} day${Math.abs(delta) === 1 ? "" : "s"} overdue`;
  }
  if (delta === 0) return "Due today";
  return `Due in ${delta} day${delta === 1 ? "" : "s"}`;
}

function contactName(contact: MovementContact | undefined, fallback = "Unmatched contact") {
  return contact?.full_name ?? fallback;
}

function containsAny(values: Array<string | string[] | null | undefined>, pattern: RegExp) {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter(Boolean)
    .some((value) => pattern.test(String(value).toLowerCase()));
}

export function isTrustedRelationship(contact: MovementContact) {
  return containsAny(
    [contact.trust_level, contact.relationship_strength],
    /tier 1|tier 2|trusted|strong|hot|warm/,
  );
}

export function touchCadenceDays(value: string | null | undefined) {
  return explicitCadenceDays(value) ?? 120;
}

function promiseMovement(promise: MovementPromise): RelationshipMovementItem {
  const delta = dayDelta(promise.due_on);
  const ownerOwes = promise.direction === "owner_owes_contact";
  const overdue = delta !== null && delta < 0;
  const dueToday = delta === 0;
  const contactId = promise.contacts?.id ?? null;
  const contact = promise.contacts?.full_name ?? "No contact linked";

  return {
    key: `promise:${promise.id}`,
    kind: "promise",
    actionKind: ownerOwes ? "complete_promise" : "inspect_promise",
    recordId: promise.id,
    title: promise.promise_text,
    detail: `${contact} · ${ownerOwes ? "You owe" : "They owe"} · ${movementDueLabel(
      promise.due_on,
    )}`,
    reason: ownerOwes
      ? "Owner promises are the fastest way to build or damage trust."
      : "Open commitments should be resolved before relationship context goes stale.",
    href: contactId ? `/contacts/${contactId}` : "/networking",
    action: ownerOwes ? "Close loop" : "Inspect promise",
    tone: overdue || dueToday ? "hot" : ownerOwes ? "gold" : "cool",
    score:
      (overdue ? 115 : dueToday ? 105 : delta !== null && delta <= 7 ? 92 : 70) +
      (ownerOwes ? 12 : 0),
    contactId,
  };
}

function introName(intro: MovementIntroduction) {
  return `${intro.person_a_contact?.full_name ?? "Person A"} → ${
    intro.person_b_contact?.full_name ?? "Person B"
  }`;
}

function introductionMovement(intro: MovementIntroduction): RelationshipMovementItem | null {
  if (["closed", "stopped"].includes(intro.status)) return null;

  const followDelta = dayDelta(intro.follow_up_on);
  const proposedDays = daysSince(intro.date_proposed);
  const followDue = followDelta !== null && followDelta <= 0;
  const proposedStale = !intro.date_made && proposedDays !== null && proposedDays >= 7;

  if (!followDue && !proposedStale) return null;

  const personA = intro.person_a ?? intro.person_a_contact?.id ?? null;
  const tone = followDue ? "hot" : proposedStale ? "gold" : "cool";
  const score = followDue ? 100 : proposedStale ? 82 : 68;
  const actionKind = followDue
    ? "follow_up_intro"
    : "advance_intro";

  return {
    key: `intro:${intro.id}`,
    kind: "introduction",
    actionKind,
    recordId: intro.id,
    title: introName(intro),
    detail: followDue
      ? `Follow-up ${movementDueLabel(intro.follow_up_on)}`
      : `Created ${proposedDays} days ago and not marked sent`,
    reason:
      intro.why_context ??
      "Introductions need follow-up so the executive knows whether the relationship moved.",
    href: "/networking",
    action: followDue ? "Follow up" : "Mark sent",
    tone,
    score,
    contactId: personA,
  };
}

function rewarmMovement(contact: MovementContact, settings: KeepInTouchSettings, timeZone: string): RelationshipMovementItem | null {
  const due = buildKeepInTouchQueue([contact], settings, timeZone)[0];
  if (!due) return null;
  const hasOpportunity = Boolean(contact.current_asks || contact.wants_help_with || contact.ideal_referral || contact.podcast_fit);
  return {
    key: `rewarm:${contact.id}`,
    kind: hasOpportunity ? "opportunity" : "rewarm",
    actionKind: hasOpportunity ? "use_opportunity" : "log_touch",
    recordId: contact.id,
    title: contact.full_name ?? "Unnamed contact",
    detail: due.reason,
    reason: `${due.cadenceLabel}: keep in touch every ${due.cadenceDays} days, regardless of social activity.`,
    href: `/contacts/${contact.id}?view=activity#log-touchpoint`,
    action: hasOpportunity ? "Use opportunity" : "Log conversation",
    tone: (due.daysOverdue ?? Infinity) >= due.cadenceDays ? "gold" : "cool",
    score: 58 + (isTrustedRelationship(contact) ? 12 : 0),
    contactId: contact.id,
  };
}

export function buildRelationshipMovement({
  contacts,
  promises,
  introductions,
  keepInTouchSettings = defaultKeepInTouchSettings,
  timeZone = "UTC",
}: MovementInput) {
  const movements = [
    ...promises.map(promiseMovement),
    ...introductions
      .map(introductionMovement)
      .filter((item): item is RelationshipMovementItem => Boolean(item)),
    ...contacts
      .map(contact => rewarmMovement(contact, keepInTouchSettings, timeZone))
      .filter((item): item is RelationshipMovementItem => Boolean(item)),
  ];

  return movements.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

export function relationshipMovementSummary(items: RelationshipMovementItem[]) {
  return {
    total: items.length,
    promises: items.filter((item) => item.kind === "promise").length,
    introductions: items.filter((item) => item.kind === "introduction").length,
    rewarm: items.filter((item) => item.kind === "rewarm").length,
    opportunities: items.filter((item) => item.kind === "opportunity").length,
  };
}
