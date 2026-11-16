"use client";

import { Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { PendingSubmitButton } from "@/app/(portal)/pending-submit-button";
import { saveRelationshipContext } from "@/app/(portal)/networking/actions";
import type {
  NetworkingContactOption,
} from "@/lib/networking/data";

export function RelationshipContextCapture({
  contacts,
}: {
  contacts: NetworkingContactOption[];
}) {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleContacts = useMemo(
    () =>
      contacts
        .filter((contact) => {
          if (!normalizedQuery) return true;
          return [contact.full_name, contact.company_name]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery);
        })
        .slice(0, normalizedQuery ? 40 : 20),
    [contacts, normalizedQuery],
  );
  const selectedContacts = selectedIds
    .map((contactId) => contacts.find((contact) => contact.id === contactId))
    .filter((contact): contact is NetworkingContactOption => Boolean(contact));

  return (
    <form action={saveRelationshipContext} className="settings-form context-capture-form">
      <input name="return_to" type="hidden" value="/networking" />
      {selectedIds.map((contactId) => (
        <input key={contactId} name="contact_ids" type="hidden" value={contactId} />
      ))}

      <div className="form-grid two-fields">
        <label className="field">
          <span>Name</span>
          <input
            maxLength={160}
            name="relationship_context_name"
            placeholder="Founders Club Toronto"
            required
          />
        </label>
        <label className="field">
          <span>Kind</span>
          <select name="relationship_context_type" defaultValue="mastermind">
            <option value="mastermind">Mastermind</option>
            <option value="conference">Conference</option>
            <option value="board">Board</option>
            <option value="community">Community</option>
            <option value="company">Company</option>
            <option value="cohort">Cohort</option>
            <option value="school">School</option>
            <option value="event">Event</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field">
          <span>Note <small>Optional</small></span>
          <input maxLength={1200} name="relationship_context_description" />
        </label>
      </div>

      <label className="field context-search">
        <span>People</span>
        <span className="search-input-shell">
          <Search aria-hidden="true" size={15} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the Book"
            type="search"
            value={query}
          />
        </span>
      </label>

      {selectedContacts.length > 0 ? (
        <div className="person-tags" aria-label="Selected people">
          {selectedContacts.map((contact) => (
            <button
              className="pill context-person-chip"
              key={contact.id}
              onClick={() =>
                setSelectedIds((current) =>
                  current.filter((contactId) => contactId !== contact.id),
                )
              }
              type="button"
            >
              {contact.full_name} ×
            </button>
          ))}
        </div>
      ) : null}

      <div className="context-contact-list">
        {visibleContacts.map((contact) => {
          const selected = selectedIds.includes(contact.id);
          return (
            <label key={contact.id}>
              <input
                checked={selected}
                onChange={() =>
                  setSelectedIds((current) =>
                    selected
                      ? current.filter((contactId) => contactId !== contact.id)
                      : [...current, contact.id],
                  )
                }
                type="checkbox"
              />
              <span>
                <b>{contact.full_name}</b>
                <small>{contact.company_name ?? "Independent"}</small>
              </span>
            </label>
          );
        })}
      </div>

      <PendingSubmitButton
        className="button ghost"
        disabled={selectedIds.length === 0}
        pendingLabel="Creating…"
      >
        <Users aria-hidden="true" size={15} />
        Create group
      </PendingSubmitButton>
    </form>
  );
}
