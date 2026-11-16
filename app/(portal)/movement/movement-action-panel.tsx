import { ArrowRight, CircleDot, RotateCcw } from "lucide-react";
import Link from "next/link";
import { PendingSubmitButton } from "@/app/(portal)/pending-submit-button";
import {
  logMovementTouch,
  quickAdvanceIntroduction,
} from "@/app/(portal)/movement/actions";
import { PromiseStatusControls } from "@/app/(portal)/promises/promise-status-controls";
import type { RelationshipMovementItem } from "@/lib/relationship-movement";
import { ownerSafeHref } from "@/runtime/owner-route-policy.js";

type MovementActionPanelProps = {
  item: RelationshipMovementItem;
  returnTo: string;
};

type ContactTouchButtonProps = {
  actionKind?: "log_touch" | "use_opportunity";
  contactId: string;
  label?: string;
  returnTo: string;
  summary: string;
  tone?: "hot" | "ghost" | "quiet";
};

function askHref(item: RelationshipMovementItem) {
  return `/ask?mode=search&q=${encodeURIComponent(`${item.title}: ${item.detail}`)}`;
}

function defaultTouchSummary(item: RelationshipMovementItem) {
  if (item.kind === "opportunity") {
    return `Used opportunity from movement queue: ${item.detail}`;
  }

  return `Relationship touch from movement queue: ${item.detail}`;
}

function introductionActionLabel(item: RelationshipMovementItem) {
  switch (item.actionKind) {
    case "advance_intro":
      return "Mark made";
    case "follow_up_intro":
      return "Log follow-up";
    case "close_intro":
      return "Close outcome";
    default:
      return item.action;
  }
}

export function ContactTouchButton({
  actionKind = "log_touch",
  contactId,
  label = "Log touch",
  returnTo,
  summary,
  tone = "ghost",
}: ContactTouchButtonProps) {
  return (
    <form action={logMovementTouch}>
      <input name="contact_id" type="hidden" value={contactId} />
      <input name="action_kind" type="hidden" value={actionKind} />
      <input name="return_to" type="hidden" value={returnTo} />
      <input name="summary" type="hidden" value={summary} />
      <PendingSubmitButton className={`button small ${tone}`} pendingLabel="Saving…">
        {label}
      </PendingSubmitButton>
    </form>
  );
}

export function MovementActionPanel({ item, returnTo }: MovementActionPanelProps) {
  const href = ownerSafeHref(item.href);

  if (item.kind === "promise") {
    if (item.actionKind !== "complete_promise") {
      return (
        <div className="movement-actions">
          <Link className="button hot" href={href}>
            Inspect promise
            <ArrowRight aria-hidden="true" size={15} />
          </Link>
          <Link className="button ghost" href={askHref(item)}>
            Ask context
          </Link>
        </div>
      );
    }

    return (
      <div className="movement-actions">
        <PromiseStatusControls
          label={item.title}
          promiseId={item.recordId}
          returnTo={returnTo}
        />
        <Link className="button ghost" href={href}>
          Context
        </Link>
      </div>
    );
  }

  if (item.kind === "introduction") {
    return (
      <form action={quickAdvanceIntroduction} className="movement-action-form">
        <input name="introduction_id" type="hidden" value={item.recordId} />
        <input name="movement_action" type="hidden" value={item.actionKind} />
        <input name="return_to" type="hidden" value={returnTo} />
        {item.actionKind === "close_intro" ? (
          <label className="movement-note-field">
            <span>Outcome note</span>
            <input
              name="outcome"
              placeholder="Outcome before closing"
              required
              type="text"
            />
          </label>
        ) : null}
        <div className="movement-actions">
          <PendingSubmitButton className="button hot" pendingLabel="Saving…">
            <CircleDot aria-hidden="true" size={15} />
            {introductionActionLabel(item)}
          </PendingSubmitButton>
          <Link className="button ghost" href={href}>
            Review intros
          </Link>
          <Link className="button ghost" href={askHref(item)}>
            Ask context
          </Link>
        </div>
      </form>
    );
  }

  return (
    <form action={logMovementTouch} className="movement-action-form">
      <input name="contact_id" type="hidden" value={item.recordId} />
      <input name="action_kind" type="hidden" value={item.actionKind} />
      <input name="return_to" type="hidden" value={returnTo} />
      <label className="movement-note-field">
        <span>Touch note</span>
        <input
          defaultValue={defaultTouchSummary(item)}
          name="summary"
          type="text"
        />
      </label>
      <div className="movement-actions">
        <PendingSubmitButton className="button hot" pendingLabel="Saving…">
          <RotateCcw aria-hidden="true" size={15} />
          Log touch
        </PendingSubmitButton>
        <Link className="button ghost" href={href}>
          Open profile
        </Link>
        <Link className="button ghost" href={askHref(item)}>
          Ask context
        </Link>
      </div>
    </form>
  );
}
