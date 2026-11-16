import type { ContactActivityItem } from "./activity.js";
import type { ContactConversation } from "./conversations.js";

type HistoryPromise = {
  id: string;
  interaction_id: string | null;
  promise_text: string;
  direction: string;
  status: string;
  due_on: string | null;
  completed_at: string | null;
  created_at: string;
  source?: string | null;
  evidence?: Record<string, unknown>;
};

type HistoryIntroduction = {
  id: string;
  person_a: string | null;
  person_b?: string | null;
  date_proposed: string | null;
  date_made: string | null;
  why_context: string | null;
  status: string;
  outcome: string | null;
  follow_up_on?: string | null;
  person_a_contact?: { full_name: string | null } | null;
  person_b_contact?: { full_name: string | null } | null;
};

export type ContactRelationshipHistoryItem = ContactActivityItem & {
  conversation: ContactConversation | null;
};

/**
 * Joins the rich evidence for an interaction onto its single dated-activity row.
 * The activity timeline remains the canonical ordering and calendar de-duplication
 * layer; conversation evidence enriches a row instead of creating a second list.
 */
export function buildContactRelationshipHistory({
  activities,
  contactId,
  conversations,
  introductions = [],
  promises = [],
}: {
  activities: ContactActivityItem[];
  contactId?: string;
  conversations: ContactConversation[];
  introductions?: HistoryIntroduction[];
  promises?: HistoryPromise[];
}): ContactRelationshipHistoryItem[] {
  const conversationByInteractionId = new Map(
    conversations.map((conversation) => [conversation.id, conversation]),
  );

  const history = activities.map((activity) => {
    const interactionId = activity.id.startsWith("interaction:")
      ? activity.id.slice("interaction:".length)
      : null;

    return {
      ...activity,
      conversation: interactionId
        ? (conversationByInteractionId.get(interactionId) ?? null)
        : null,
    };
  });

  const representedInteractionIds = new Set(
    activities
      .filter((activity) => activity.id.startsWith("interaction:"))
      .map((activity) => activity.id.slice("interaction:".length)),
  );

  for (const promise of promises) {
    if (
      promise.interaction_id &&
      representedInteractionIds.has(promise.interaction_id)
    ) {
      continue;
    }
    const occurredAt = datedRecordTime(promise.completed_at ?? promise.created_at);
    if (!occurredAt) continue;
    const due = promise.due_on ? ` Due ${promise.due_on}.` : "";
    history.push({
      id: `promise:${promise.id}`,
      occurredAt,
      activityType: promise.status === "completed" ? "promise completed" : "promise",
      title: promise.promise_text,
      summary: `${promiseDirection(promise.direction)} · ${promise.status.replaceAll("_", " ")}.${due}`,
      source: "promise",
      sourceUrl: null,
      conversation: null,
    });
  }

  for (const introduction of introductions) {
    const occurredAt = datedRecordTime(
      introduction.date_made ?? introduction.date_proposed,
    );
    if (!occurredAt) continue;
    const otherName =
      introduction.person_a === contactId
        ? introduction.person_b_contact?.full_name
        : introduction.person_a_contact?.full_name;
    history.push({
      id: `introduction:${introduction.id}`,
      occurredAt,
      activityType: "introduction",
      title: otherName ? `Introduction with ${otherName}` : "Introduction",
      summary:
        [introduction.why_context, introduction.outcome]
          .filter(Boolean)
          .join(" · ") || introduction.status.replaceAll("_", " "),
      source: "introduction",
      sourceUrl: null,
      conversation: null,
    });
  }

  return history.sort(
    (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
  );
}

function datedRecordTime(value: string | null) {
  if (!value) return null;
  const candidate = value.includes("T") ? value : `${value.slice(0, 10)}T12:00:00Z`;
  return Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function promiseDirection(direction: string) {
  if (direction === "owner_owes_contact") return "You owe";
  if (direction === "contact_owes_owner") return "They owe";
  return "Shared commitment";
}
