import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  contactDuplicateInputFromPayload,
  duplicateMatchesToPayloadCandidates,
  findExactIdentityDuplicate,
  findDuplicateCandidates,
  hasStrongIdentityIdentifier,
  mergeDuplicateCandidatesIntoPayload,
  recommendedExistingContact,
  type ContactDuplicateRecord,
} from "../lib/contact-duplicate-detection.js";

const contacts: ContactDuplicateRecord[] = [
  {
    id: "alicia",
    full_name: "Alicia Stone",
    email: "alicia@samplefinance.example.com",
    phone: "+1 (212) 555-1200",
    company_name: "Stone Capital LLC",
    role_title: ["Founder", "Investor"],
    linkedin: "https://www.linkedin.com/in/alicia-stone/",
    website: "https://samplefinance.example.com",
    relationship_type: ["Investor"],
  },
  {
    id: "alex",
    full_name: "Alex Stone",
    email: "alex@example.com",
    phone: null,
    company_name: "Northwind Partners",
    role_title: ["Partner"],
    linkedin: null,
    website: null,
    relationship_type: ["Referral partner"],
  },
  {
    id: "same-first-name",
    full_name: "Alicia Ramirez",
    email: "alicia.ramirez@example.com",
    phone: null,
    company_name: "Different Co",
    role_title: ["Operator"],
    linkedin: null,
    website: null,
    relationship_type: ["Founder"],
  },
];

describe("contact duplicate detection", () => {
  test("treats exact email and LinkedIn matches as high-confidence duplicates", () => {
    const matches = findDuplicateCandidates(
      {
        full_name: "Alicia S.",
        email: "ALICIA@SAMPLEFINANCE.EXAMPLE.COM",
        phone: null,
        company_name: "Stone Capital",
        linkedin: "linkedin.com/in/alicia-stone",
      },
      contacts,
    );

    assert.equal(matches[0]?.contact.id, "alicia");
    assert.equal(matches[0]?.confidence, "high");
    assert.match(matches[0]?.reasons.join(" "), /Exact email match/);
    assert.match(matches[0]?.reasons.join(" "), /Exact LinkedIn match/);
  });

  test("finds likely duplicates from name and company even without identifiers", () => {
    const matches = findDuplicateCandidates(
      {
        full_name: "Alicia Stone",
        email: null,
        phone: null,
        company_name: "Stone Capital",
      },
      contacts,
    );

    assert.equal(matches[0]?.contact.id, "alicia");
    assert.equal(matches[0]?.confidence, "medium");
    assert.match(matches[0]?.reasons.join(" "), /Exact name match/);
    assert.match(matches[0]?.reasons.join(" "), /Company match/);
  });

  test("does not flag a shared first name as a duplicate by itself", () => {
    const matches = findDuplicateCandidates(
      {
        full_name: "Alicia",
        email: null,
        phone: null,
        company_name: null,
      },
      contacts,
    );

    assert.equal(matches.length, 0);
  });

  test("returns one exact identity only when normalized name and email both match", () => {
    const match = findExactIdentityDuplicate(
      {
        full_name: "  ALICIA   STONE ",
        email: "ALICIA@SAMPLEFINANCE.EXAMPLE.COM",
      },
      contacts,
    );

    assert.equal(match?.contact.id, "alicia");
    assert.equal(match?.reason, "Exact name and email match");
    assert.equal(
      findExactIdentityDuplicate(
        { full_name: "Alicia Stone", email: "different@example.com" },
        contacts,
      ),
      null,
    );
  });

  test("fails closed when the same normalized identity matches more than one record", () => {
    const match = findExactIdentityDuplicate(
      {
        full_name: "Alicia Stone",
        email: "alicia@samplefinance.example.com",
      },
      [contacts[0]!, { ...contacts[0]!, id: "duplicate-row" }],
    );

    assert.equal(match, null);
  });

  test("recommends one existing contact for a unique exact email even when the name is incomplete", () => {
    const matches = findDuplicateCandidates(
      {
        full_name: "Alicia",
        email: "alicia@samplefinance.example.com",
      },
      contacts,
    );
    const recommended = recommendedExistingContact(matches);

    assert.equal(recommended?.contact.id, "alicia");
    assert.equal(hasStrongIdentityIdentifier(recommended), true);
  });

  test("treats a unique exact full name as a review recommendation, not a strong identifier", () => {
    const matches = findDuplicateCandidates(
      {
        full_name: "Alex Stone",
        email: null,
      },
      contacts,
    );
    const recommended = recommendedExistingContact(matches);

    assert.equal(recommended?.contact.id, "alex");
    assert.equal(hasStrongIdentityIdentifier(recommended), false);
  });

  test("fails closed when more than one contact shares the exact identity signal", () => {
    const repeatedEmail = [
      contacts[0]!,
      {
        ...contacts[0]!,
        id: "shared-inbox",
        full_name: "Alicia Stone II",
      },
    ];
    const emailMatches = findDuplicateCandidates(
      {
        full_name: "Alicia",
        email: "alicia@samplefinance.example.com",
      },
      repeatedEmail,
    );
    const repeatedName = [
      contacts[1]!,
      { ...contacts[1]!, id: "same-name", email: "other@example.com" },
    ];
    const nameMatches = findDuplicateCandidates(
      {
        full_name: "Alex Stone",
        email: null,
      },
      repeatedName,
    );

    assert.equal(recommendedExistingContact(emailMatches), null);
    assert.equal(recommendedExistingContact(nameMatches), null);
  });

  test("excludes the current contact id from duplicate results", () => {
    const matches = findDuplicateCandidates(
      {
        id: "alicia",
        full_name: "Alicia Stone",
        email: "alicia@samplefinance.example.com",
        phone: "+12125551200",
        company_name: "Stone Capital",
      },
      contacts,
    );

    assert.equal(matches.some((match) => match.contact.id === "alicia"), false);
  });

  test("builds duplicate input from nested Claude payloads", () => {
    const input = contactDuplicateInputFromPayload({
      contact: {
        full_name: "Alicia Stone",
        company_name: "Stone Capital",
        role_title: ["Investor"],
      },
      evidence: {
        source: "call transcript",
      },
    });

    assert.equal(input.full_name, "Alicia Stone");
    assert.equal(input.company_name, "Stone Capital");
    assert.deepEqual(input.role_title, ["Investor"]);
  });

  test("merges app duplicate candidates into Claude payloads without repeats", () => {
    const matches = findDuplicateCandidates(
      {
        full_name: "Alicia Stone",
        email: "alicia@samplefinance.example.com",
        phone: null,
        company_name: "Stone Capital",
      },
      contacts,
    );
    const appCandidates = duplicateMatchesToPayloadCandidates(matches);
    const payload = mergeDuplicateCandidatesIntoPayload(
      {
        contact: {
          full_name: "Alicia Stone",
        },
        duplicate_candidates: [
          {
            id: "alicia",
            full_name: "Alicia Stone",
            reason: "Claude suggested this candidate.",
          },
        ],
      },
      appCandidates,
    );

    const candidates = payload.duplicate_candidates as Array<Record<string, unknown>>;

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.id, "alicia");
    assert.equal(candidates[0]?.source, "app_duplicate_check");
    assert.match(String(candidates[0]?.reason), /Exact email match/);
  });
});
