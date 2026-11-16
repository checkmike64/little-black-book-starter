"use client";

import Link from "next/link";
import {
  type FormEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  rankedBookSearch,
  type BookSearchContact,
} from "@/lib/contacts/search";
import { locationWithFlag } from "@/lib/location-flag";

export type BookResultContact = BookSearchContact & {
  last_spoke: string | null;
  location: string[] | null;
  open_promise_count: number;
  relationship_strength: string | null;
};

type BookLiveSearchProps = {
  candidates: BookResultContact[];
  filterOptions: {
    industries: string[];
    tags: string[];
    tiers: string[];
    workTypes: string[];
  };
  filters: {
    industry: string;
    tag: string;
    tier: string;
    workType: string;
  };
  initialPage: number;
  initialQuery: string;
};

const pageSize = 25;
const historyDelay = 120;

function formatDate(value: string | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function queryFromLocation() {
  return new URLSearchParams(window.location.search).get("q") ?? "";
}

function pageFromLocation() {
  const value = Number.parseInt(
    new URLSearchParams(window.location.search).get("page") ?? "1",
    10,
  );
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function BookLiveSearch({
  candidates,
  filterOptions,
  filters,
  initialPage,
  initialQuery,
}: BookLiveSearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [page, setPage] = useState(initialPage);
  const deferredQuery = useDeferredValue(query.trim());

  const rankedMatches = useMemo(
    () => deferredQuery ? rankedBookSearch(candidates, deferredQuery) : [],
    [candidates, deferredQuery],
  );
  const visibleContacts = deferredQuery
    ? rankedMatches.map(({ contact }) => contact)
    : candidates;
  const totalPages = Math.max(1, Math.ceil(visibleContacts.length / pageSize));
  const effectivePage = Math.min(page, totalPages);
  const pageStart = (effectivePage - 1) * pageSize;
  const paginatedContacts = visibleContacts.slice(pageStart, pageStart + pageSize);
  const potentialMatches = rankedMatches.slice(0, 6);
  const hasCategoryFilters = Boolean(
    filters.industry || filters.tag || filters.tier || filters.workType,
  );

  useEffect(() => {
    function restoreUrlState() {
      setQuery(queryFromLocation());
      setPage(pageFromLocation());
    }
    window.addEventListener("popstate", restoreUrlState);
    return () => window.removeEventListener("popstate", restoreUrlState);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = new URL(window.location.href);
      const cleaned = query.trim();
      if (cleaned) next.searchParams.set("q", cleaned);
      else next.searchParams.delete("q");
      if (effectivePage > 1) next.searchParams.set("page", String(effectivePage));
      else next.searchParams.delete("page");
      if (next.href !== window.location.href) {
        window.history.replaceState(window.history.state, "", next);
      }
    }, historyDelay);
    return () => window.clearTimeout(timer);
  }, [effectivePage, query]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  function clearLocalState() {
    setQuery("");
    setPage(1);
  }

  return (
    <>
      <div className="book-search-shell">
        <form className="book-controls" action="/contacts" onSubmit={submitSearch} role="search">
          <label className="search-field">
            <span className="sr-only">Search My Book by name, primary email, company, or role</span>
            <input
              aria-controls="book-results"
              autoComplete="off"
              name="q"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Search by name, email, company, or role…"
              type="search"
              value={query}
            />
          </label>
          {query ? (
            <button className="button quiet small" onClick={clearLocalState} type="button">
              Clear
            </button>
          ) : null}
        </form>

        {deferredQuery && potentialMatches.length > 0 ? (
          <section
            aria-label="Potential matches"
            className="book-potential-matches"
            id="book-potential-matches"
          >
            <div className="section-label">Potential matches</div>
            <ul>
              {potentialMatches.map(({ contact, match }) => (
                <li key={contact.id}>
                  <Link href={`/contacts/${contact.id}`}>
                    <span>
                      <b>{contact.full_name}</b>
                      <small>
                        {match.kind === "email"
                          ? contact.email
                          : [contact.role_title?.join(", "), contact.company_name]
                              .filter(Boolean)
                              .join(" · ") || contact.email || "Relationship profile"}
                      </small>
                    </span>
                    <em>{match.label}</em>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <details className="minimal-disclosure book-filters" open={hasCategoryFilters}>
        <summary>Filters</summary>
        <form className="book-filter-row" action="/contacts">
          {query ? <input name="q" type="hidden" value={query} /> : null}
          <label>
            <span className="sr-only">Industry</span>
            <select defaultValue={filters.industry} name="industry">
              <option value="">Industry — all</option>
              {filterOptions.industries.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Work type</span>
            <select defaultValue={filters.workType} name="work_type">
              <option value="">Work type — all</option>
              {filterOptions.workTypes.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Tags</span>
            <select defaultValue={filters.tag} name="tag">
              <option value="">Tags — all</option>
              {filterOptions.tags.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Tier</span>
            <select defaultValue={filters.tier} name="tier">
              <option value="">Tiers — all</option>
              {filterOptions.tiers.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <button className="button ghost" type="submit">Apply</button>
        </form>
      </details>

      {visibleContacts.length > 0 ? (
        <>
          <div className="section-label" aria-live="polite">
            {`Showing ${pageStart + 1}–${Math.min(
              pageStart + paginatedContacts.length,
              visibleContacts.length,
            )} of ${visibleContacts.length} people`}
          </div>
          <div className="table-wrap" id="book-results">
            <table className="contact-table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Relationship</th>
                  <th scope="col">Last contact</th>
                  <th scope="col"><span className="sr-only">Open profile</span></th>
                </tr>
              </thead>
              <tbody>
                {paginatedContacts.map((contact) => (
                  <tr key={contact.id}>
                    <td data-label="Name">
                      <Link className="person-name link-quiet" href={`/contacts/${contact.id}`}>
                        {contact.full_name}
                      </Link>
                      <div className="person-sub">
                        {[contact.role_title?.join(", "), contact.company_name]
                          .filter(Boolean)
                          .join(" · ") || "No role or company stored"}
                      </div>
                      <ContactLocation locations={contact.location} />
                    </td>
                    <td data-label="Relationship">
                      {contact.relationship_type?.join(" · ") || contact.relationship_strength || "Not set"}
                      {contact.open_promise_count > 0 ? (
                        <div className="person-sub">
                          {contact.open_promise_count} open promise{contact.open_promise_count === 1 ? "" : "s"}
                        </div>
                      ) : null}
                    </td>
                    <td data-label="Last contact">{formatDate(contact.last_spoke)}</td>
                    <td data-label="">
                      <Link
                        aria-label={`Open ${contact.full_name}`}
                        className="button small ghost"
                        href={`/contacts/${contact.id}`}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <nav className="pagination-actions" aria-label="People pages">
              {effectivePage > 1 ? (
                <button className="button ghost" onClick={() => setPage(effectivePage - 1)} type="button">
                  Previous 25
                </button>
              ) : <span />}
              <span className="source-note">Page {effectivePage} of {totalPages}</span>
              {effectivePage < totalPages ? (
                <button className="button hot" onClick={() => setPage(effectivePage + 1)} type="button">
                  Show next {Math.min(pageSize, visibleContacts.length - effectivePage * pageSize)}
                </button>
              ) : <span />}
            </nav>
          ) : null}
        </>
      ) : (
        <div className="book-no-results" id="book-results">
          <span role="status">No matching relationships exist.</span>
          {hasCategoryFilters ? (
            <Link className="button quiet small" href="/contacts">Clear filters</Link>
          ) : query ? (
            <button className="button quiet small" onClick={clearLocalState} type="button">
              Clear filters
            </button>
          ) : null}
        </div>
      )}
    </>
  );
}

function ContactLocation({ locations }: { locations: string[] | null | undefined }) {
  const location = locationWithFlag(locations);
  if (!location) return null;

  return (
    <div className="person-location">
      {location.flag ? <span aria-hidden="true">{location.flag}</span> : null}
      <span>{location.label}</span>
    </div>
  );
}
