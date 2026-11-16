export type ContactSignalView =
  | "priority"
  | "asks"
  | "referrals"
  | "rewarm"
  | "judgment"
  | "all";

export type ContactSignalContact = {
  full_name: string;
  company_name: string | null;
  role_title: string[] | null;
  trust_level: string | null;
  relationship_strength: string | null;
  relationship_type: string[] | null;
  email: string | null;
  last_spoke: string | null;
  current_asks?: string | null;
  wants_help_with?: string | null;
  recent_activity?: string | null;
  private_notes?: string | null;
};

export type ContactSignalPromise = {
  direction: string;
  due_on: string | null;
  promise_text: string;
};

export const contactSignalViews: Array<{ key: ContactSignalView; label: string }> = [
  { key: "priority", label: "Priority" },
  { key: "asks", label: "Active asks" },
  { key: "referrals", label: "Referral lanes" },
  { key: "rewarm", label: "Rewarm" },
  { key: "judgment", label: "Needs judgment" },
  { key: "all", label: "All" },
];

export function normalizeContactSignalView(
  value: string | undefined,
): ContactSignalView {
  return contactSignalViews.some((view) => view.key === value)
    ? (value as ContactSignalView)
    : "priority";
}

export function contactSearchText(contact: ContactSignalContact) {
  return [
    contact.full_name,
    contact.company_name,
    contact.role_title?.join(" "),
    contact.trust_level,
    contact.relationship_strength,
    contact.relationship_type?.join(" "),
    contact.email,
    contact.current_asks,
    contact.wants_help_with,
    contact.recent_activity,
    contact.private_notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function daysSince(value: string | null | undefined, now = Date.now()) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const target = new Date(parsed);
  target.setHours(0, 0, 0, 0);

  return Math.max(0, Math.round((today.getTime() - target.getTime()) / 86_400_000));
}

function isOverdue(value: string | null | undefined, now = Date.now()) {
  if (!value) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const due = new Date(parsed);
  due.setHours(0, 0, 0, 0);

  return due.getTime() < today.getTime();
}

export function contactValueLabel(contact: ContactSignalContact) {
  const text = contactSearchText(contact);
  if (/tier 1|trusted|hot|strong/.test(text)) return "High value";
  if (/referral|intro|introduc/.test(text)) return "Referral lane";
  if (/podcast|guest|host|interview/.test(text)) return "Outreach fit";
  if (/investor|capital|fund|m&a|merger|acquisition|deal/.test(text)) {
    return "Strategic";
  }
  return "Clarify";
}

export function buildContactSignal(
  contact: ContactSignalContact,
  promises: ContactSignalPromise[],
  now = Date.now(),
) {
  const staleDays = daysSince(contact.last_spoke, now);
  const ownerOwes = promises.filter((promise) => promise.direction === "owner_owes_contact");
  const overdueOwnerPromise = ownerOwes.find((promise) => isOverdue(promise.due_on, now));
  const needsJudgment = !contact.trust_level || !contact.relationship_strength;
  const hasAsk = Boolean(contact.current_asks || contact.wants_help_with);
  const hasReferralLane =
    /referral|intro|introduc/.test(contactSearchText(contact)) ||
    Boolean(contact.wants_help_with);
  const needsRewarm = staleDays !== null && staleDays >= 120;
  const highValue = /tier 1|hot|strong|trusted/.test(contactSearchText(contact));

  let action = "Open profile and inspect context.";
  let risk = "No urgent risk";
  let tone: "hot" | "gold" | "cool" | "warn" = "cool";

  if (overdueOwnerPromise) {
    action = `Close the loop: ${overdueOwnerPromise.promise_text}`;
    risk = "Overdue promise";
    tone = "hot";
  } else if (ownerOwes.length > 0) {
    action = `Follow through: ${ownerOwes[0].promise_text}`;
    risk = "Open owner promise";
    tone = "gold";
  } else if (hasAsk) {
    action = contact.current_asks ?? contact.wants_help_with ?? action;
    risk = "Active ask";
    tone = "gold";
  } else if (needsRewarm) {
    action = "Ask the Book for a light reactivation note.";
    risk = `${staleDays} days since touch`;
    tone = "gold";
  } else if (needsJudgment) {
    action = "Verify trust and relationship strength.";
    risk = "Needs owner judgment";
    tone = "warn";
  }

  const score =
    (overdueOwnerPromise ? 100 : 0) +
    (ownerOwes.length > 0 ? 28 : 0) +
    (hasAsk ? 22 : 0) +
    (hasReferralLane ? 16 : 0) +
    (needsRewarm ? 14 : 0) +
    (needsJudgment ? 10 : 0) +
    (highValue ? 18 : 0);

  return {
    action,
    hasAsk,
    hasReferralLane,
    highValue,
    needsJudgment,
    needsRewarm,
    openPromiseCount: promises.length,
    risk,
    score,
    staleDays,
    tone,
    value: contactValueLabel(contact),
  };
}

export function contactViewMatches(
  view: ContactSignalView,
  signal: ReturnType<typeof buildContactSignal>,
) {
  if (view === "all") return true;
  if (view === "asks") return signal.hasAsk || signal.openPromiseCount > 0;
  if (view === "referrals") return signal.hasReferralLane;
  if (view === "rewarm") return signal.needsRewarm;
  if (view === "judgment") return signal.needsJudgment;
  return signal.score >= 28 || signal.highValue;
}
