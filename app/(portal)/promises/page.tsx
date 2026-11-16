import Link from "next/link";
import { PendingSubmitButton } from "@/app/(portal)/pending-submit-button";
import {
  createManualPromise,
  reviewOperatorRoutedPromise,
  updatePromiseDetails,
} from "@/app/(portal)/promises/actions";
import { PromiseStatusControls } from "@/app/(portal)/promises/promise-status-controls";
import { requireEnabledModule } from "@/lib/module-gate";
import { getPromiseLedgerData, type PromiseLedgerRow } from "@/lib/promises/data";
import { buildDataLoadHealth } from "@/lib/data-load-health";
import { DataLoadNotice } from "@/app/(portal)/data-load-notice";
import { dayDelta, movementDueLabel } from "@/lib/relationship-movement";
import { getTenantContext } from "@/lib/tenant-context";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type PromiseFilter = "open" | "owner" | "contact" | "overdue" | "closed" | "all";

const filters: Array<{ label: string; value: PromiseFilter }> = [
  { label: "Open", value: "open" },
  { label: "You owe", value: "owner" },
  { label: "They owe", value: "contact" },
  { label: "Overdue", value: "overdue" },
  { label: "Closed", value: "closed" },
  { label: "All", value: "all" },
];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validFilter(value: string | undefined): PromiseFilter {
  return filters.some((filter) => filter.value === value) ? value as PromiseFilter : "open";
}

function contactName(promise: PromiseLedgerRow) {
  return promise.contacts?.full_name ?? "No person linked";
}

function ownerOwes(promise: PromiseLedgerRow) {
  return promise.direction === "owner_owes_contact";
}

function isClosed(promise: PromiseLedgerRow) {
  return ["completed", "skipped", "stopped"].includes(promise.status);
}

function filterPromises(promises: PromiseLedgerRow[], filter: PromiseFilter, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return promises
    .filter((promise) => promise.review_status !== "pending_owner")
    .filter((promise) => {
      const delta = dayDelta(promise.due_on);
      if (filter === "open") return promise.status === "open";
      if (filter === "owner") return promise.status === "open" && ownerOwes(promise);
      if (filter === "contact") return promise.status === "open" && !ownerOwes(promise);
      if (filter === "overdue") return promise.status === "open" && delta !== null && delta < 0;
      if (filter === "closed") return isClosed(promise);
      return true;
    })
    .filter((promise) => !normalizedQuery || [
      promise.promise_text,
      promise.contacts?.full_name,
      promise.contacts?.company_name,
      promise.source,
    ].filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery))
    .sort((a, b) => (a.due_on ?? "9999-12-31").localeCompare(b.due_on ?? "9999-12-31"));
}

function promiseLabel(promise: PromiseLedgerRow) {
  return ownerOwes(promise) ? "You owe" : "They owe";
}

export default async function PromisesPage({ searchParams }: { searchParams?: SearchParams }) {
  await requireEnabledModule("networking");
  const params = searchParams ? await searchParams : {};
  const filter = validFilter(firstParam(params.filter));
  const query = firstParam(params.q) ?? "";
  const message = firstParam(params.message);
  const tenantContext = await getTenantContext();
  const { promises, contacts, error: promisesError, contactsError } = await getPromiseLedgerData(tenantContext?.tenantId ?? null);
  const loadHealth = buildDataLoadHealth("Promises", [
    { key: "promises", label: "promises", error: promisesError, blocksSurface: true },
  ]);
  const visiblePromises = filterPromises(promises, filter, query);
  const pendingOwnerReview = promises.filter((promise) => (
    promise.review_status === "pending_owner"
    && promise.status === "pending_review"
    && promise.owner_user_id === tenantContext?.userId
  ));
  const openCount = promises.filter((promise) => promise.status === "open").length;
  const returnTo = `/promises?filter=${filter}${query ? `&q=${encodeURIComponent(query)}` : ""}`;

  return (
    <div className="minimal-page promises-minimal">
      <header className="minimal-page-header">
        <div className="minimal-title-line"><h1>Promises</h1><span>{openCount} open</span></div>
        <details className="header-disclosure">
          <summary className="button hot">Create manually</summary>
          <form action={createManualPromise} className="minimal-create-form">
            <input name="return_to" type="hidden" value="/promises" />
            <label className="field"><span>Person</span><select name="contact_id" required><option value="">Choose someone</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.full_name}{contact.company_name ? ` — ${contact.company_name}` : ""}</option>)}</select></label>
            <label className="field"><span>Direction</span><select name="direction" required><option value="owner_owes_contact">I owe them</option><option value="contact_owes_owner">They owe me</option></select></label>
            <label className="field"><span>Promise</span><input maxLength={1200} name="promise_text" required /></label>
            <label className="field"><span>Due date</span><input name="due_on" type="date" /></label>
            <PendingSubmitButton className="button hot" pendingLabel="Creating…">Create promise</PendingSubmitButton>
            {contactsError ? <p className="form-error">{contactsError}</p> : null}
          </form>
        </details>
      </header>

      {message ? <div className="notice" role="status">{message}</div> : null}
      <DataLoadNotice health={loadHealth} />

      {!loadHealth.isBlocked && pendingOwnerReview.length > 0 ? (
        <section className="minimal-section" aria-labelledby="promise-review-heading">
          <div className="minimal-section-head"><h2 id="promise-review-heading">Review from meeting notes</h2><span>{pendingOwnerReview.length}</span></div>
          <div className="minimal-list">
            {pendingOwnerReview.map((promise) => (
              <article className="minimal-list-row" key={promise.id}>
                <div><span className="minimal-row-label">Proposed promise</span><h3>{promise.promise_text}</h3><p>{promiseLabel(promise)} · {contactName(promise)} · {movementDueLabel(promise.due_on)}</p></div>
                <form action={reviewOperatorRoutedPromise} className="row-actions">
                  <input name="promise_id" type="hidden" value={promise.id} /><input name="expected_updated_at" type="hidden" value={promise.updated_at} /><input name="return_to" type="hidden" value="/promises" />
                  <button className="button small hot" name="decision" type="submit" value="accept">Approve</button>
                  <button className="button small ghost" name="decision" type="submit" value="already_done">Already done</button>
                  <button className="button small quiet" name="decision" type="submit" value="decline">Decline</button>
                </form>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {loadHealth.isBlocked ? null : (
        <section className="minimal-section" aria-labelledby="promise-list-heading">
          <div className="minimal-section-head">
            <h2 id="promise-list-heading">{visiblePromises.length} promise{visiblePromises.length === 1 ? "" : "s"}</h2>
            <details className="inline-disclosure"><summary>Filter</summary><form action="/promises" className="compact-filter"><select defaultValue={filter} name="filter">{filters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><input defaultValue={query} name="q" placeholder="Search" /><button className="button ghost small" type="submit">Apply</button></form></details>
          </div>
          {visiblePromises.length > 0 ? (
            <div className="minimal-list">{visiblePromises.map((promise) => <PromiseRow key={promise.id} promise={promise} returnTo={returnTo} />)}</div>
          ) : <p className="minimal-empty">{promises.length === 0 ? "No commitments are waiting." : "No promises match this view."}</p>}
        </section>
      )}
    </div>
  );
}

function PromiseRow({ promise, returnTo }: { promise: PromiseLedgerRow; returnTo: string }) {
  const contactHref = promise.contacts?.id ? `/contacts/${promise.contacts.id}` : null;
  return (
    <article className="minimal-list-row promise-row">
      <div>
        <span className="minimal-row-label">{promiseLabel(promise)} · {movementDueLabel(promise.due_on)}</span>
        <h3>{promise.promise_text}</h3>
        <p>{contactHref ? <Link href={contactHref}>{contactName(promise)}</Link> : contactName(promise)} · Source: {promise.source ?? "not stored"}</p>
      </div>
      <div className="row-actions">
        {promise.status === "open" ? <PromiseStatusControls label={promise.promise_text} promiseId={promise.id} returnTo={returnTo} /> : <span>{promise.status}</span>}
        <details className="inline-disclosure"><summary>Edit</summary><form action={updatePromiseDetails} className="minimal-create-form"><input name="promise_id" type="hidden" value={promise.id} /><input name="return_to" type="hidden" value={returnTo} /><label className="field"><span>Promise</span><input defaultValue={promise.promise_text} name="promise_text" /></label><label className="field"><span>Due</span><input defaultValue={promise.due_on ?? ""} name="due_on" type="date" /></label><PendingSubmitButton className="button small ghost" pendingLabel="Saving…">Save</PendingSubmitButton></form></details>
      </div>
    </article>
  );
}
