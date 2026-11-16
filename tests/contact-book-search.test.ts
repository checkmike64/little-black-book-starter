import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  rankedBookSearch,
  rankBookSearchContact,
  type BookSearchContact,
} from "../lib/contacts/search.js";

function contact(overrides: Partial<BookSearchContact> & Pick<BookSearchContact, "id" | "full_name">): BookSearchContact {
  return {
    company_name: null,
    email: null,
    keywords: null,
    primary_category: null,
    relationship_type: null,
    role_title: null,
    top_3_tags: null,
    ...overrides,
  };
}

describe("My Book identity search", () => {
  test("ranks names before primary email, company, role, and profile fields", () => {
    const results = rankedBookSearch([
      contact({ id: "tag", full_name: "Ari Bell", keywords: ["Joshua network"] }),
      contact({ id: "role", full_name: "Sam Lee", role_title: ["Joshua Advisor"] }),
      contact({ id: "company", full_name: "Ana Ray", company_name: "Joshua Studio" }),
      contact({ id: "email", full_name: "Ben Hall", email: "josh@example.com" }),
      contact({ id: "name", full_name: "Josh Schachnow" }),
    ], "josh");

    assert.deepEqual(results.map(({ contact: result }) => result.id), [
      "name",
      "email",
      "company",
      "role",
      "tag",
    ]);
    assert.deepEqual(results.map(({ match }) => match.label), [
      "Name",
      "Primary email",
      "Company or role",
      "Company or role",
      "Profile",
    ]);
  });

  test("does not search narrative or private relationship text", () => {
    const noisyContact = {
      ...contact({ id: "jamie", full_name: "Jamie Sample" }),
      current_asks: "Join a podcast",
      private_notes: "Joe recommended him",
      recent_activity: "Met Josh yesterday",
      wants_help_with: "Job search",
    } as BookSearchContact;

    assert.equal(rankBookSearchContact(noisyContact, "jo"), null);
  });

  test("keeps short structured matches to token prefixes", () => {
    assert.equal(
      rankBookSearchContact(contact({ id: "contains", full_name: "Ana Ray", company_name: "Major Works" }), "jo"),
      null,
    );
    assert.equal(
      rankBookSearchContact(contact({ id: "prefix", full_name: "Ana Ray", company_name: "Joe and Co" }), "jo")?.label,
      "Company or role",
    );
    assert.equal(
      rankBookSearchContact(contact({ id: "profile", full_name: "Ana Ray", keywords: ["Journalist"] }), "jo"),
      null,
    );
  });

  test("ships live URL search and the compact empty-state contract", () => {
    const liveSearch = readFileSync("app/(portal)/contacts/book-live-search.tsx", "utf8");
    const ledgerCss = readFileSync("app/private-ledger.css", "utf8");
    const page = readFileSync("app/(portal)/contacts/page.tsx", "utf8");

    assert.match(liveSearch, /useDeferredValue/);
    assert.match(liveSearch, /history\.replaceState/);
    assert.match(liveSearch, /aria-label="Potential matches"/);
    assert.match(liveSearch, /No matching relationships exist\./);
    assert.match(liveSearch, />\s*Clear filters\s*</);
    assert.doesNotMatch(`${page}\n${liveSearch}`, /Ask about this view|firstUse\.proof|contactSearchText/);
    assert.match(ledgerCss, /\.search-field:focus-within\s*\{[^}]*box-shadow:\s*inset/s);
    assert.match(ledgerCss, /\.search-field input:focus[\s\S]*?box-shadow:\s*none/);
  });
});
