const newPersonChangeTypes = new Set(["new_contact", "contact_candidate"]);

export function isNewPersonChangeType(changeType: string) {
  return newPersonChangeTypes.has(changeType);
}

type OwnerActionableChange = {
  change_type: string;
  contact_id?: string | null;
  source?: string | null;
  payload?: Record<string, unknown> | null;
  replaced_by_pending_change_id?: string | null;
  superseded_at?: string | null;
};

export function isOwnerActionableChange(change: OwnerActionableChange) {
  if (change.replaced_by_pending_change_id || change.superseded_at) return false;
  if (change.payload?.dry_run === true || change.source?.includes("dry_run")) return false;
  if (isNewPersonChangeType(change.change_type)) return true;

  const payloadContactId = change.payload?.contact_id;
  const hasContact = Boolean(
    change.contact_id
    || (typeof payloadContactId === "string" && payloadContactId.trim()),
  );
  if (!hasContact) return false;

  if (["field_update", "contact_enrichment"].includes(change.change_type)) return true;
  return change.change_type === "recording_action" && change.source === "recording_operator";
}
