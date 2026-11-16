"use client";

import { CheckCircle2, X } from "lucide-react";
import { useId, useRef } from "react";
import { markConnectionAlreadyConnected } from "@/app/(portal)/networking/actions";
import type { NetworkingRelationshipContext } from "@/lib/networking/data";

type AlreadyConnectedDialogProps = {
  connectionId: string;
  personA: string;
  personB: string;
  relationshipContexts: NetworkingRelationshipContext[];
  sharedContexts: NetworkingRelationshipContext[];
};

export function AlreadyConnectedDialog({
  connectionId,
  personA,
  personB,
  relationshipContexts,
  sharedContexts,
}: AlreadyConnectedDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const defaultContextId = sharedContexts[0]?.id ?? "";

  return (
    <>
      <button
        className="button quiet"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        <CheckCircle2 aria-hidden="true" size={15} />
        They already know each other
      </button>
      <dialog
        aria-labelledby={titleId}
        className="connection-context-dialog"
        onClick={(event) => {
          if (event.currentTarget === event.target) event.currentTarget.close();
        }}
        ref={dialogRef}
      >
        <form action={markConnectionAlreadyConnected} className="settings-form">
          <input name="connection_id" type="hidden" value={connectionId} />
          <div className="dialog-heading">
            <div>
              <span className="section-label">Confirm their connection</span>
              <h2 id={titleId}>{personA} ↔ {personB}</h2>
            </div>
            <button
              aria-label="Close"
              className="icon-button"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              <X aria-hidden="true" size={17} />
            </button>
          </div>

          {sharedContexts.length > 0 ? (
            <div className="context-suggestions" aria-label="Shared group found">
              <span>Shared group</span>
              <div className="person-tags">
                {sharedContexts.map((relationshipContext) => (
                  <span className="pill cool" key={relationshipContext.id}>
                    {relationshipContext.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <label className="field">
            <span>How do they know each other?</span>
            <select
              defaultValue={defaultContextId}
              name="relationship_context_id"
            >
              <option value="">Choose a group</option>
              {relationshipContexts.map((relationshipContext) => (
                <option key={relationshipContext.id} value={relationshipContext.id}>
                  {relationshipContext.name}
                </option>
              ))}
            </select>
          </label>

          <div className="form-grid two-fields">
            <label className="field">
              <span>New group</span>
              <input
                maxLength={160}
                name="relationship_context_name"
                placeholder="Founders Mastermind"
              />
            </label>
            <label className="field">
              <span>Type</span>
              <select name="relationship_context_type" defaultValue="other">
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
          </div>

          <label className="field">
            <span>Add a note</span>
            <textarea maxLength={500} name="owner_note" rows={3} />
          </label>

          <div className="actions dialog-actions">
            <button
              className="button hot"
              name="capture_context"
              type="submit"
              value="true"
            >
              Save connection
            </button>
            <button
              className="button quiet"
              name="capture_context"
              type="submit"
              value="false"
            >
              Mark connected without details
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
