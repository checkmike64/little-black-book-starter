import { PendingSubmitButton } from "@/app/(portal)/pending-submit-button";
import { updatePromiseStatus } from "@/app/(portal)/promises/actions";

type PromiseStatusControlsProps = {
  label?: string;
  promiseId: string;
  returnTo: string;
};

export function PromiseStatusControls({
  label = "promise",
  promiseId,
  returnTo,
}: PromiseStatusControlsProps) {
  return (
    <div className="promise-status-controls">
      <form action={updatePromiseStatus}>
        <input name="promise_id" type="hidden" value={promiseId} />
        <input name="status" type="hidden" value="completed" />
        <input name="return_to" type="hidden" value={returnTo} />
        <PendingSubmitButton
          aria-label={`Mark ${label} done`}
          className="button small hot"
          pendingLabel="Saving…"
        >
          Mark done
        </PendingSubmitButton>
      </form>

      <details className="promise-outcome-disclosure">
        <summary aria-label={`Other outcome for ${label}`}>Other outcome</summary>
        <div className="promise-outcome-forms">
          <form action={updatePromiseStatus} className="inline-edit promise-outcome-form">
            <input name="promise_id" type="hidden" value={promiseId} />
            <input name="status" type="hidden" value="skipped" />
            <input name="return_to" type="hidden" value={returnTo} />
            <label className="field compact">
              <span>Skip reason</span>
              <input name="status_note" placeholder="Why is this no longer needed?" required />
            </label>
            <PendingSubmitButton
              aria-label={`Skip ${label}`}
              className="button small ghost"
              pendingLabel="Saving…"
            >
              Skip
            </PendingSubmitButton>
          </form>
          <form action={updatePromiseStatus} className="inline-edit promise-outcome-form">
            <input name="promise_id" type="hidden" value={promiseId} />
            <input name="status" type="hidden" value="stopped" />
            <input name="return_to" type="hidden" value={returnTo} />
            <label className="field compact">
              <span>Stop reason</span>
              <input name="status_note" placeholder="Why should tracking end?" required />
            </label>
            <PendingSubmitButton
              aria-label={`Stop tracking ${label}`}
              className="button small ghost"
              pendingLabel="Saving…"
            >
              Stop tracking
            </PendingSubmitButton>
          </form>
        </div>
      </details>
    </div>
  );
}
