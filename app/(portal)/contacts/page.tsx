import { cookies } from "next/headers";
import { adminToolsCookieName, shouldUseAdminTools } from "@/lib/admin-mode";
import {
  buildContactSignal,
} from "@/lib/contact-signals";
import {
  getContactsListData,
  type ContactsListPromiseRow,
} from "@/lib/contacts/data";
import { buildDataLoadHealth } from "@/lib/data-load-health";
import { DataLoadNotice } from "@/app/(portal)/data-load-notice";
import { getTenantContext } from "@/lib/tenant-context";
import Link from "next/link";
import { BookLiveSearch } from "@/app/(portal)/contacts/book-live-search";

type ContactsSearchParams = Promise<{
  industry?: string;
  page?: string;
  q?: string;
  tag?: string;
  tier?: string;
  work_type?: string;
}>;

function cleanParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function uniqueOptions(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))))
    .sort((a, b) => a.localeCompare(b));
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams?: ContactsSearchParams;
}) {
  const params = searchParams ? await searchParams : {};
  const query = cleanParam(params.q).trim();
  const industry = cleanParam(params.industry);
  const workType = cleanParam(params.work_type);
  const tag = cleanParam(params.tag);
  const tier = cleanParam(params.tier);
  const requestedPage = Number.parseInt(cleanParam(params.page), 10);
  const tenantContext = await getTenantContext();
  const cookieStore = await cookies();
  const adminMode = shouldUseAdminTools({
    cookieValue: cookieStore.get(adminToolsCookieName)?.value,
    role: tenantContext?.role,
    setupMode: false,
  });
  const { contacts, openPromises, count, setupMode, error, promisesError } =
    await getContactsListData(tenantContext?.tenantId ?? null);
  const loadHealth = buildDataLoadHealth("My Book", [
    { key: "contacts", label: "relationships", error, blocksSurface: true },
    { key: "promises", label: "promise risk", error: promisesError },
  ]);
  const promisesByContact = new Map<string, ContactsListPromiseRow[]>();
  openPromises.forEach((promise) => {
    if (!promise.contact_id) return;
    promisesByContact.set(promise.contact_id, [
      ...(promisesByContact.get(promise.contact_id) ?? []),
      promise,
    ]);
  });
  const contactSignals = contacts.map((contact) => ({
    contact,
    signal: buildContactSignal(contact, promisesByContact.get(contact.id) ?? []),
  }));
  const industryOptions = uniqueOptions(contacts.flatMap((contact) => contact.primary_category ?? []));
  const workTypeOptions = uniqueOptions(contacts.flatMap((contact) => contact.role_title ?? []));
  const tagOptions = uniqueOptions(contacts.flatMap((contact) => [
    ...(contact.relationship_type ?? []),
    ...(contact.top_3_tags ?? []),
  ]));
  const tierOptions = uniqueOptions(contacts.map((contact) => contact.trust_level));
  const visibleContacts = contactSignals
    .filter(({ contact }) => industry ? contact.primary_category?.includes(industry) : true)
    .filter(({ contact }) => workType ? contact.role_title?.includes(workType) : true)
    .filter(({ contact }) => tag ? [...(contact.relationship_type ?? []), ...(contact.top_3_tags ?? [])].includes(tag) : true)
    .filter(({ contact }) => tier ? contact.trust_level === tier : true)
    .sort((a, b) => b.signal.score - a.signal.score
      || a.contact.full_name.localeCompare(b.contact.full_name));
  const initialPage = Number.isFinite(requestedPage) && requestedPage > 0
    ? requestedPage
    : 1;

  return (
    <div className="minimal-page book-minimal">
      <header className="minimal-page-header">
        <div className="minimal-title-line"><h1>My Book</h1><span>{count} people</span></div>
        <div className="minimal-header-actions">
          <Link className="button quiet" href="/ask">
            Ask the Book
          </Link>
          {adminMode ? (
            <Link className="button hot" href="/contacts/new">
              Add person
            </Link>
          ) : null}
        </div>
      </header>

      {setupMode ? (
        <div className="notice">
          Your private Book is still being prepared. A small preview is shown
          until verified relationship context is ready.
        </div>
      ) : null}

      <DataLoadNotice health={loadHealth} />

      {loadHealth.isBlocked ? (
        <section className="empty-state promise-load-blocked">
          <b>Your contacts couldn’t load.</b>
          <p>Refresh before using this list.</p>
          <Link className="button ghost" href="/dashboard">
            Return to Today
          </Link>
        </section>
      ) : (
        <>
          <BookLiveSearch
            candidates={visibleContacts.map(({ contact, signal }) => ({
              id: contact.id,
              full_name: contact.full_name,
              email: contact.email,
              company_name: contact.company_name,
              role_title: contact.role_title,
              primary_category: contact.primary_category,
              relationship_type: contact.relationship_type,
              top_3_tags: contact.top_3_tags,
              keywords: contact.keywords,
              last_spoke: contact.last_spoke,
              location: contact.location,
              open_promise_count: promisesError ? 0 : signal.openPromiseCount,
              relationship_strength: contact.relationship_strength,
            }))}
            filterOptions={{
              industries: industryOptions,
              tags: tagOptions,
              tiers: tierOptions,
              workTypes: workTypeOptions,
            }}
            filters={{ industry, tag, tier, workType }}
            initialPage={initialPage}
            initialQuery={query}
          />
        </>
      )}
    </div>
  );
}
