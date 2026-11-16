export type TodayPromise = {
  id: string;
  promise_text: string;
  direction: string;
  due_on: string | null;
  review_status?: "pending_owner" | "accepted" | "declined";
  contacts?: { id?: string | null; full_name: string | null } | null;
};

export type TodayChange = {
  id: string;
  change_type: string;
  summary: string;
  risk_level: string | null;
  source: string | null;
  created_at: string;
};

export type TodayRelationshipAction = {
  id: string;
  title: string;
  action_type: string;
  status: string;
  priority: string;
  due_on: string | null;
  contacts?: { id?: string | null; full_name: string | null } | null;
};

export type TodayAttentionItem = {
  key: string;
  label: string;
  title: string;
  detail: string;
  href: string;
  action: string;
  tone: "hot" | "gold" | "cool" | "warn";
  score: number;
};

function dateValue(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}

function dayDifference(value: string | null, today: string) {
  const due = dateValue(value);
  const current = dateValue(today);
  if (due === null || current === null) return null;
  return Math.round((due - current) / 86_400_000);
}

function dueLabel(value: string | null, today: string) {
  const difference = dayDifference(value, today);
  if (difference === null) return "No due date";
  if (difference < 0) {
    const days = Math.abs(difference);
    return `${days} day${days === 1 ? "" : "s"} overdue`;
  }
  if (difference === 0) return "Due today";
  if (difference === 1) return "Due tomorrow";
  return `Due in ${difference} days`;
}

function dueScore(value: string | null, today: string) {
  const difference = dayDifference(value, today);
  if (difference === null) return 20;
  if (difference < 0) return 100 + Math.min(Math.abs(difference), 30);
  if (difference === 0) return 95;
  if (difference <= 7) return 80 - difference;
  return 30;
}

function promiseItem(promise: TodayPromise, today: string): TodayAttentionItem {
  if (promise.review_status === "pending_owner") {
    return {
      key: `promise:${promise.id}`,
      label: "Meeting proposal",
      title: promise.promise_text,
      detail: `${promise.contacts?.full_name ?? "No person linked"} · Not active until you approve it`,
      href: "/promises",
      action: "Review proposal",
      tone: "warn",
      score: 94,
    };
  }

  const ownerOwes = promise.direction === "owner_owes_contact";
  const score = dueScore(promise.due_on, today) + (ownerOwes ? 12 : 0);
  const difference = dayDifference(promise.due_on, today);
  const urgent = difference !== null && difference <= 0;
  const contactName = promise.contacts?.full_name ?? "No person linked";

  return {
    key: `promise:${promise.id}`,
    label: ownerOwes ? "You owe" : "Waiting on them",
    title: promise.promise_text,
    detail: `${contactName} · ${dueLabel(promise.due_on, today)}`,
    href: ownerOwes ? "/promises?filter=owner" : "/promises?filter=contact",
    action: "Open promise",
    tone: urgent ? "hot" : ownerOwes ? "gold" : "cool",
    score,
  };
}

function changeItem(change: TodayChange): TodayAttentionItem {
  const highRisk = change.risk_level === "high";
  const isNewPerson = ["new_contact", "new_person", "contact_candidate", "want_to_know_candidate"].includes(
    change.change_type,
  );
  const newPersonSummary = isNewPerson
    ? change.summary.match(/^Add\s+(.+?)(?:\s+\(([^)]+)\))?\s+to the book\s*[—–-]\s*(.+)$/i)
    : null;
  const title = newPersonSummary
    ? `Add ${newPersonSummary[1].trim()} to the Book`
    : change.summary;
  const detail = newPersonSummary
    ? [newPersonSummary[2]?.trim(), newPersonSummary[3]?.trim()].filter(Boolean).join(" · ")
    : change.source
      ? change.source.replaceAll("_", " ")
      : "Source not stored";

  return {
    key: `change:${change.id}`,
    label: isNewPerson ? "Identity decision" : highRisk ? "Check carefully" : "Profile update",
    title,
    detail,
    href: `/changes/${change.id}`,
    action: "Review",
    tone: highRisk || isNewPerson ? "warn" : "gold",
    score: highRisk ? 92 : isNewPerson ? 88 : 68,
  };
}

function actionItem(action: TodayRelationshipAction, today: string): TodayAttentionItem {
  const score = dueScore(action.due_on, today) + (action.priority === "high" ? 10 : 0);
  const difference = dayDifference(action.due_on, today);
  const urgent = difference !== null && difference <= 0;
  const contactName = action.contacts?.full_name ?? "No person linked";

  return {
    key: `action:${action.id}`,
    label: action.action_type.replaceAll("_", " "),
    title: action.title,
    detail: `${contactName} · ${dueLabel(action.due_on, today)}`,
    href: action.contacts?.id ? `/contacts/${action.contacts.id}` : "/movement",
    action: "Open next move",
    tone: urgent ? "hot" : action.priority === "high" ? "gold" : "cool",
    score,
  };
}

export function buildTodayAttention({
  actions,
  changes,
  limit = 8,
  promises,
  today,
}: {
  actions: TodayRelationshipAction[];
  changes: TodayChange[];
  limit?: number;
  promises: TodayPromise[];
  today: string;
}) {
  return [
    ...promises.map((promise) => promiseItem(promise, today)),
    ...changes.map(changeItem),
    ...actions.map((action) => actionItem(action, today)),
  ]
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, Math.max(0, limit));
}
