import { PlusCircle } from "lucide-react";
import { PendingSubmitButton } from "@/app/(portal)/pending-submit-button";
import { captureRelationshipAction } from "@/app/(portal)/movement/actions";
import { suggestedRelationshipActionDueDate } from "@/lib/relationship-action-due-date";

type NextMoveCaptureFormProps = {
  collapsed?: boolean;
  contactId: string;
  defaultDueOn?: string | null;
  defaultTitle?: string | null;
  defaultType?: string;
  defaultPriority?: string;
  evidenceSummary?: string | null;
  notes?: string | null;
  returnTo: string;
  source: string;
  sourceLabel?: string;
  sourceRef?: string | null;
  title?: string;
};

export function NextMoveCaptureForm({
  collapsed = false,
  contactId,
  defaultDueOn,
  defaultTitle,
  defaultType = "follow_up",
  defaultPriority = "normal",
  evidenceSummary,
  notes,
  returnTo,
  source,
  sourceLabel,
  sourceRef,
  title = "Capture next move",
}: NextMoveCaptureFormProps) {
  const dueOn =
    defaultDueOn === null
      ? ""
      : defaultDueOn ??
        suggestedRelationshipActionDueDate({
          priority: defaultPriority,
          type: defaultType,
        });
  const visibleSource = sourceLabel ?? source.replaceAll("_", " ");

  const form = (
    <form
      action={captureRelationshipAction}
      className={`next-move-capture${collapsed ? " collapsed" : ""}`}
    >
      <input name="contact_id" type="hidden" value={contactId} />
      <input name="return_to" type="hidden" value={returnTo} />
      <input name="source" type="hidden" value={source} />
      {sourceRef ? <input name="source_ref" type="hidden" value={sourceRef} /> : null}
      {evidenceSummary ? (
        <input name="evidence_summary" type="hidden" value={evidenceSummary} />
      ) : null}
      {!collapsed ? (
        <div className="mini-item-head">
          <b>{title}</b>
          <span className="pill cool">{visibleSource}</span>
        </div>
      ) : null}
      {evidenceSummary ? (
        <p className="capture-context">
          <b>Source context</b>
          <span>{evidenceSummary}</span>
        </p>
      ) : null}
      <label className="field compact">
        <span>Move</span>
        <input
          defaultValue={defaultTitle ?? ""}
          name="title"
          placeholder="What should happen next?"
          required
        />
      </label>
      <div className="next-move-fields">
        <label className="field compact">
          <span>Type</span>
          <select defaultValue={defaultType} name="action_type">
            <option value="follow_up">Follow-up</option>
            <option value="reconnect">Reconnect</option>
            <option value="promise">Promise</option>
            <option value="introduction">Introduction</option>
            <option value="referral">Referral</option>
            <option value="podcast">Podcast</option>
            <option value="owner_verification">Owner verification</option>
            <option value="claude_draft">Claude draft</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field compact">
          <span>Priority</span>
          <select defaultValue={defaultPriority} name="priority">
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="field compact">
          <span>Due</span>
          <input defaultValue={dueOn} name="due_on" type="date" />
        </label>
      </div>
      {notes ? <input name="notes" type="hidden" value={notes} /> : null}
      <PendingSubmitButton className="button small" pendingLabel="Saving…">
        <PlusCircle aria-hidden="true" size={14} />
        Save move
      </PendingSubmitButton>
    </form>
  );

  if (!collapsed) return form;

  return (
    <details className="next-move-disclosure">
      <summary>
        <span>{title}</span>
        <span className="pill cool">{visibleSource}</span>
      </summary>
      {form}
    </details>
  );
}
