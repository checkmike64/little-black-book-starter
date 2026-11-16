"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { PendingSubmitButton } from "@/app/(portal)/pending-submit-button";
import { replaceRelationshipGroupMembers } from "@/app/(portal)/networking/actions";
import type {
  NetworkingContactOption,
  NetworkingRelationshipContext,
} from "@/lib/networking/data";

export function RelationshipGroupEditor({
  contacts,
  relationshipContext,
}: {
  contacts: NetworkingContactOption[];
  relationshipContext: NetworkingRelationshipContext;
}) {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState(
    relationshipContext.member_ids,
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleContacts = useMemo(
    () =>
      contacts
        .filter((contact) => {
          if (!normalizedQuery) {
            return relationshipContext.member_ids.includes(contact.id);
          }
          return [contact.full_name, contact.company_name]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery);
        })
        .slice(0, 40),
    [contacts, normalizedQuery, relationshipContext.member_ids],
  );

  function toggle(contactId: string) {
    setSelectedIds((current) =>
      current.includes(contactId)
        ? current.filter((id) => id !== contactId)
        : [...current, contactId],
    );
  }

  return (
    <form
      action={replaceRelationshipGroupMembers}
      aria-label={`Edit ${relationshipContext.name}`}
      className="relationship-group-editor"
    >
      <input name="relationship_context_id" type="hidden" value={relationshipContext.id} />
      <input name="return_to" type="hidden" value="/networking" />
      {selectedIds.map((contactId) => (
        <input key={contactId} name="contact_ids" type="hidden" value={contactId} />
      ))}

      <label className="field context-search">
        <span>Add or remove people</span>
        <span className="search-input-shell">
          <Search aria-hidden="true" size={15} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your Book"
            type="search"
            value={query}
          />
        </span>
      </label>

      <div className="context-contact-list">
        {visibleContacts.length > 0 ? (
          visibleContacts.map((contact) => {
            const selected = selectedIds.includes(contact.id);
            return (
              <label key={contact.id}>
                <input
                  checked={selected}
                  onChange={() => toggle(contact.id)}
                  type="checkbox"
                />
                <span>
                  <b>{contact.full_name}</b>
                  <small>{contact.company_name ?? "Independent"}</small>
                </span>
              </label>
            );
          })
        ) : (
          <p className="empty-copy">No matches.</p>
        )}
      </div>

      <div className="relationship-group-editor-footer">
        <span>{selectedIds.length} {selectedIds.length === 1 ? "person" : "people"}</span>
        <PendingSubmitButton className="button small ghost" pendingLabel="Saving…">
          Save people
        </PendingSubmitButton>
      </div>
    </form>
  );
}
