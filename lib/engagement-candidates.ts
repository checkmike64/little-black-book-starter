import type {
  WeeklyEngagementCandidate,
  WeeklyEngagementPromise,
} from "./engagement-weekly-plan.js";

export type EngagementContactRow = {
  id: string;
  full_name: string;
  company_name: string | null;
  trust_level: string | null;
  relationship_strength: string | null;
  relationship_type: string[] | null;
  touch_cadence?: string | null;
  last_spoke: string | null;
  current_asks?: string | null;
  wants_help_with?: string | null;
  ideal_referral?: string | null;
  podcast_fit?: string | null;
  recent_activity?: string | null;
  top_3_tags?: string[] | null;
};

export type EngagementPromiseRow = WeeklyEngagementPromise & {
  id: string;
  contact_id: string | null;
};

export type EngagementCandidate = EngagementContactRow &
  Omit<WeeklyEngagementCandidate, "promises"> & {
    promises: EngagementPromiseRow[];
  };

function daysSince(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 1000 / 60 / 60 / 24));
}

function dayDelta(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(parsed);
  target.setHours(0, 0, 0, 0);

  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function promiseDueLine(promise: WeeklyEngagementPromise) {
  const delta = dayDelta(promise.due_on);
  if (delta === null) return "No due date";
  if (delta < 0) return `${Math.abs(delta)} day${Math.abs(delta) === 1 ? "" : "s"} overdue`;
  if (delta === 0) return "Due today";
  return `Due in ${delta} day${delta === 1 ? "" : "s"}`;
}

function ownerPromise(promises: WeeklyEngagementPromise[]) {
  return promises.find((promise) => promise.direction === "owner_owes_contact") ?? null;
}

function overdueOwnerPromise(promises: WeeklyEngagementPromise[]) {
  return (
    promises.find(
      (promise) =>
        promise.direction === "owner_owes_contact" &&
        (dayDelta(promise.due_on) ?? 1) < 0,
    ) ?? null
  );
}

function containsAny(values: Array<string | string[] | null | undefined>, pattern: RegExp) {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter(Boolean)
    .some((value) => pattern.test(String(value).toLowerCase()));
}

export function buildEngagementCandidate(
  contact: EngagementContactRow,
  promises: EngagementPromiseRow[],
): EngagementCandidate {
  const staleDays = daysSince(contact.last_spoke);
  const ownerOwedPromise = ownerPromise(promises);
  const overduePromise = overdueOwnerPromise(promises);
  const hasActiveObjective = Boolean(
    contact.current_asks || contact.podcast_fit || contact.ideal_referral,
  );
  const isReferralPartner = Boolean(contact.ideal_referral) ||
    containsAny([contact.relationship_type, contact.top_3_tags], /referral|partner|intro/);
  const isTrusted = containsAny(
    [contact.trust_level, contact.relationship_strength],
    /tier 1|tier 2|hot|warm|strong|trusted/,
  );
  const needsRescue = Boolean(staleDays && staleDays > 90 && isTrusted);

  let priority: EngagementCandidate["priority"] = "P4";
  let rung: EngagementCandidate["rung"] = "Like";
  let why = "General goodwill relationship.";
  let nextAction = "Make a light touch or ask Claude for recent context.";
  let risk = "Low urgency";
  let score = 10;

  if (overduePromise) {
    priority = "P1";
    rung = "Follow through";
    why = `Promise is ${promiseDueLine(overduePromise)}.`;
    nextAction = `Close the loop: ${overduePromise.promise_text}`;
    risk = "Trust risk";
    score = 112;
  } else if (ownerOwedPromise) {
    priority = "P1";
    rung = "Follow through";
    why = `${promiseDueLine(ownerOwedPromise)}: ${ownerOwedPromise.promise_text}`;
    nextAction = `Follow through on: ${ownerOwedPromise.promise_text}`;
    risk = "Open owner promise";
    score = 96;
  } else if (hasActiveObjective) {
    priority = "P1";
    rung = "Be useful";
    why = contact.current_asks ?? contact.podcast_fit ?? contact.ideal_referral ?? why;
    nextAction = contact.current_asks
      ? `Help with: ${contact.current_asks}`
      : contact.ideal_referral
        ? `Look for an intro lane: ${contact.ideal_referral}`
        : `Use podcast context: ${contact.podcast_fit}`;
    risk = "Active opportunity";
    score = 86;
  } else if (isReferralPartner) {
    priority = "P2";
    rung = "Comment";
    why = "Referral partner or warm-introduction lane.";
    nextAction = "Ask Claude for a specific relationship-maintenance touch.";
    risk = "Relationship value";
    score = 72;
  } else if (needsRescue) {
    priority = "P3";
    rung = "Comment";
    why = `Trusted relationship has gone ${staleDays} days without a logged touch.`;
    nextAction = "Ask Claude to draft a light reactivation note.";
    risk = "Cooling relationship";
    score = 62;
  }

  if (isTrusted) score += 8;
  if (staleDays && staleDays > 120) score += 6;
  if (contact.recent_activity) score += 4;

  if (rung === "Like" && (contact.current_asks || contact.wants_help_with)) {
    rung = "Be useful";
  } else if (rung === "Like" && (contact.recent_activity || priority === "P1")) {
    rung = "Comment";
  }

  return {
    ...contact,
    company_name: contact.company_name,
    recent_activity: contact.recent_activity ?? null,
    priority,
    rung,
    promises,
    score,
    nextAction,
    risk,
    why,
    staleDays,
  };
}

export function buildEngagementQueue({
  contacts,
  includeLowPriority = false,
  limit = 30,
  promises,
}: {
  contacts: EngagementContactRow[];
  includeLowPriority?: boolean;
  limit?: number;
  promises: EngagementPromiseRow[];
}) {
  const promisesByContact = new Map<string, EngagementPromiseRow[]>();
  promises.forEach((promise) => {
    if (!promise.contact_id) return;
    promisesByContact.set(promise.contact_id, [
      ...(promisesByContact.get(promise.contact_id) ?? []),
      promise,
    ]);
  });

  return contacts
    .map((contact) => buildEngagementCandidate(contact, promisesByContact.get(contact.id) ?? []))
    .filter((item) => includeLowPriority || item.priority !== "P4" || item.score >= 22)
    .sort((a, b) => b.score - a.score || a.full_name.localeCompare(b.full_name))
    .slice(0, limit);
}
