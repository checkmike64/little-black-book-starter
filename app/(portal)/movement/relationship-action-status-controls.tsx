import { updateRelationshipActionStatus } from "@/app/(portal)/contacts/[id]/actions";
import { PendingSubmitButton } from "@/app/(portal)/pending-submit-button";

type RelationshipActionStatus = "open" | "deferred" | "done" | "skipped" | string;

type RelationshipActionStatusControlsProps = {
  actionId: string;
  contactId: string;
  currentStatus?: RelationshipActionStatus | null;
  returnTo: string;
};

function statusChoices(status: RelationshipActionStatus | null | undefined) {
  if (status === "done" || status === "skipped") return ["open", "deferred"] as const;
  if (status === "deferred") return ["open", "done", "skipped"] as const;
  return ["done", "deferred", "skipped"] as const;
}

function statusLabel(status: string) {
  switch (status) {
    case "done":
      return "Mark done";
    case "deferred":
      return "Defer";
    case "skipped":
      return "Skip";
    case "open":
      return "Reopen";
    default:
      return status.replaceAll("_", " ");
  }
}

function statusReasonLabel(status: string) {
  return status === "deferred" ? "Defer reason" : "Skip reason";
}

function statusReasonPlaceholder(status: string) {
  return status === "deferred"
    ? "What should happen before this comes back?"
    : "Why is this no longer worth doing?";
}

function needsReason(status: string) {
  return status === "deferred" || status === "skipped";
}

export function RelationshipActionStatusControls({
  actionId,
  contactId,
  currentStatus,
  returnTo,
}: RelationshipActionStatusControlsProps) {
  return (
    <>
      {statusChoices(currentStatus).map((status) => (
        <form
          action={updateRelationshipActionStatus}
          className={needsReason(status) ? "inline-edit action-status-form" : "action-status-form"}
          key={status}
        >
          <input name="action_id" type="hidden" value={actionId} />
          <input name="contact_id" type="hidden" value={contactId} />
          <input name="status" type="hidden" value={status} />
          <input name="return_to" type="hidden" value={returnTo} />
          {needsReason(status) ? (
            <label className="field compact">
              <span>{statusReasonLabel(status)}</span>
              <input
                name="status_note"
                placeholder={statusReasonPlaceholder(status)}
                required
              />
            </label>
          ) : null}
          <PendingSubmitButton
            className={status === "done" ? "button small hot" : "button small ghost"}
            pendingLabel="Saving…"
          >
            {statusLabel(status)}
          </PendingSubmitButton>
        </form>
      ))}
    </>
  );
}
