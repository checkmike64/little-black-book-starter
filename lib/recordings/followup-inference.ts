export type RecordingFollowupClassification =
  | "action"
  | "owner_promise"
  | "contact_promise";

export type FollowupInferenceContact = {
  id: string;
  full_name: string;
  email: string | null;
};

export type FollowupInferenceInput = {
  followupText: string;
  assignee: string | null;
  assigneeEmail: string | null;
  ownerAssigned: boolean;
  ownerEmail: string | null;
  meetingContactIds: string[];
  contacts: FollowupInferenceContact[];
  contactsIncomplete?: boolean;
};

export type FollowupInference = {
  classification: RecordingFollowupClassification;
  confidence: "high" | "medium" | "low";
  contactId: string | null;
  contactName: string | null;
  needsInput: boolean;
  reason: "provider_assignee" | "named_actor" | "one_to_one" | "unresolved";
};

export type FollowupMeetingAttendee = {
  normalizedEmail: string;
  matchedContactId: string | null;
};

export type MeetingContactIdsForInferenceInput = {
  calendarAttendees: FollowupMeetingAttendee[] | null;
  calendarAttendeesComplete: boolean;
  ownerEmail: string | null;
  validatedConfirmedContactIds: string[];
};

export function oneToOneMatchedContactIds(
  attendees: FollowupMeetingAttendee[],
  attendeeSetComplete: boolean,
  ownerEmail: string | null,
) {
  const normalizedOwnerEmail = normalized(ownerEmail);
  if (!attendeeSetComplete || !normalizedOwnerEmail) return [];
  const otherPeople = attendees.filter(
    (attendee) => normalized(attendee.normalizedEmail) !== normalizedOwnerEmail,
  );
  if (otherPeople.length !== 1 || !otherPeople[0].matchedContactId) return [];
  return [otherPeople[0].matchedContactId];
}

export function meetingContactIdsForInference({
  calendarAttendees,
  calendarAttendeesComplete,
  ownerEmail,
  validatedConfirmedContactIds,
}: MeetingContactIdsForInferenceInput) {
  if (calendarAttendees === null) {
    return [...new Set(validatedConfirmedContactIds)];
  }
  return oneToOneMatchedContactIds(
    calendarAttendees,
    calendarAttendeesComplete,
    ownerEmail,
  );
}

function normalized(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.+_-]+/g, " ")
    .trim();
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function emailAliases(email: string | null) {
  const local = normalized(email).split("@")[0] ?? "";
  if (!local) return [];
  return unique([
    local,
    ...local.split(/[._+-]+/).filter((part) => part.length >= 2),
  ]).filter(Boolean);
}

function nameAliases(name: string) {
  const clean = normalized(name);
  if (!clean) return [];
  const first = clean.split(" ")[0] ?? "";
  return unique([clean, first.length >= 2 ? first : ""]).filter(Boolean);
}

function startsWithActor(text: string, aliases: string[]) {
  const clean = normalized(text);
  return aliases.some((alias) => {
    if (!alias || !clean.startsWith(`${alias} `)) return false;
    const remainder = clean.slice(alias.length).trimStart();
    return /^(?:(?:[a-z0-9]+)\s+)?(?:to|will|shall|should|needs? to|agreed to|promised to)\b/.test(remainder);
  });
}

function mentionsFullName(text: string, name: string) {
  const cleanText = ` ${normalized(text)} `;
  const cleanName = normalized(name);
  return cleanName.includes(" ") && cleanText.includes(` ${cleanName} `);
}

export function inferRecordingFollowup({
  followupText,
  assignee,
  assigneeEmail,
  ownerAssigned,
  ownerEmail,
  meetingContactIds,
  contacts,
  contactsIncomplete = false,
}: FollowupInferenceInput): FollowupInference {
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const meetingContacts = unique(meetingContactIds)
    .map((id) => contactById.get(id))
    .filter((contact): contact is FollowupInferenceContact => Boolean(contact));
  const normalizedAssignee = normalized(assignee);
  const normalizedAssigneeEmail = normalized(assigneeEmail);
  const normalizedOwnerEmail = normalized(ownerEmail);
  const ownerAliases = emailAliases(ownerEmail);

  const emailMatches = normalizedAssigneeEmail
    ? contacts.filter((contact) => normalized(contact.email) === normalizedAssigneeEmail)
    : [];
  const emailMatchedContact = emailMatches.length === 1 ? emailMatches[0] : null;
  const providerEmailIdentifiesOwner = Boolean(
    normalizedAssigneeEmail && normalizedAssigneeEmail === normalizedOwnerEmail,
  );
  const nameMatches = normalizedAssignee
    ? contacts.filter((contact) => normalized(contact.full_name) === normalizedAssignee)
    : [];
  const assignedContact = emailMatchedContact ?? (nameMatches.length === 1 ? nameMatches[0] : null);
  const namedReferencedContacts = contacts.filter((candidate) =>
    mentionsFullName(followupText, candidate.full_name),
  );
  const namedReferencedContact = namedReferencedContacts.length === 1
    ? namedReferencedContacts[0]
    : null;
  const oneToOneContact = meetingContacts.length === 1 ? meetingContacts[0] : null;
  const contact = assignedContact
    ?? namedReferencedContact
    ?? (namedReferencedContacts.length > 1 ? null : oneToOneContact);

  if (contactsIncomplete) {
    return {
      classification: "action",
      confidence: "low",
      contactId: null,
      contactName: null,
      needsInput: true,
      reason: "unresolved",
    };
  }

  if (
    normalizedAssigneeEmail
    && !providerEmailIdentifiesOwner
    && emailMatches.length !== 1
  ) {
    return {
      classification: "action",
      confidence: "low",
      contactId: null,
      contactName: null,
      needsInput: true,
      reason: "unresolved",
    };
  }

  if (
    ownerAssigned
    || providerEmailIdentifiesOwner
    || (normalizedAssignee && ownerAliases.includes(normalizedAssignee))
  ) {
    return {
      classification: "owner_promise",
      confidence: "high",
      contactId: contact?.id ?? null,
      contactName: contact?.full_name ?? null,
      needsInput: !contact,
      reason: "provider_assignee",
    };
  }

  if (assignedContact) {
    return {
      classification: "contact_promise",
      confidence: "high",
      contactId: assignedContact.id,
      contactName: assignedContact.full_name,
      needsInput: false,
      reason: "provider_assignee",
    };
  }

  if (startsWithActor(followupText, ownerAliases)) {
    return {
      classification: "owner_promise",
      confidence: "medium",
      contactId: contact?.id ?? null,
      contactName: contact?.full_name ?? null,
      needsInput: !contact,
      reason: "named_actor",
    };
  }

  const namedActorContacts = contacts.filter((candidate) =>
    startsWithActor(followupText, nameAliases(candidate.full_name)),
  );
  if (namedActorContacts.length === 1) {
    const namedContact = namedActorContacts[0];
    return {
      classification: "contact_promise",
      confidence: "medium",
      contactId: namedContact.id,
      contactName: namedContact.full_name,
      needsInput: false,
      reason: "named_actor",
    };
  }

  return {
    classification: "action",
    confidence: contact ? "medium" : "low",
    contactId: contact?.id ?? null,
    contactName: contact?.full_name ?? null,
    needsInput: true,
    reason: contact ? "one_to_one" : "unresolved",
  };
}

export function followupInferenceLabel(inference: FollowupInference) {
  if (inference.needsInput) {
    return inference.contactName ? "Choose who is responsible" : "Needs your input";
  }
  if (!inference.contactName) return "Needs your input";
  if (inference.classification === "owner_promise") {
    return `You promised ${inference.contactName}`;
  }
  if (inference.classification === "contact_promise") {
    return `${inference.contactName} promised you`;
  }
  return "Choose who is responsible";
}
