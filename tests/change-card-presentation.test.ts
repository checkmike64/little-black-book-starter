import assert from "node:assert/strict";
import test from "node:test";
import {
  changeApprovalLabel,
  changeCardGroupKey,
  changeCardIdentity,
  changeRecommendationLines,
  changeRationale,
} from "../lib/change-card-presentation.js";

test("presents a peer proposal as a direct owner decision", () => {
  const change = {
    change_type: "field_update",
    summary: "Propose relationship type",
    payload: {
      fields: { relationship_type: ["Peer"] },
      confidence: "low",
      evidence: {
        verification_summary: "The stored context says you share a mastermind.",
      },
    },
    contact: { full_name: "Nick Deck", company_name: null },
  };

  assert.deepEqual(changeCardIdentity(change), { name: "Nick Deck", company: null });
  assert.deepEqual(changeRecommendationLines(change), [
    "Set the relationship type to Peer.",
  ]);
  assert.equal(changeApprovalLabel(change), "Approve Peer");
  assert.equal(
    changeRationale(change).summary,
    "The stored context says you share a mastermind.",
  );
});

test("uses concise labels for common field updates", () => {
  assert.equal(
    changeApprovalLabel({
      change_type: "field_update",
      summary: "Role update",
      payload: { fields: { role_title: ["Managing Partner"] } },
    }),
    "Approve title",
  );
  assert.equal(
    changeApprovalLabel({
      change_type: "field_update",
      summary: "Relationship note",
      payload: { fields: { why_stay_in_touch: "Close friend." } },
    }),
    "Save reason",
  );
});

test("keeps multiple changes inside one plain-language recommendation", () => {
  const change = {
    change_type: "contact_enrichment",
    summary: "Relationship update",
    payload: {
      fields: {
        relationship_type: ["Peer"],
        why_stay_in_touch: "A close friend from my men's mastermind group.",
      },
    },
    contact: { full_name: "Caleb Fowler", company_name: null },
  };

  assert.deepEqual(changeRecommendationLines(change), [
    "Set the relationship type to Peer.",
    "Save this reason to stay in touch: “A close friend from my men's mastermind group.”",
  ]);
  assert.equal(changeApprovalLabel(change), "Approve changes");
});

test("uses the contact id to keep one card per person", () => {
  const base = {
    contact_id: "contact-1",
    change_type: "field_update",
    summary: "Update",
    payload: { fields: { company_name: "Acme" } },
    contact: { full_name: "Alicia Harper", company_name: "Acme" },
  };

  assert.equal(changeCardGroupKey(base), changeCardGroupKey({
    ...base,
    payload: { fields: { role_title: ["CEO"] } },
  }));
});

test("presents legacy field payloads as the actual contact update", () => {
  const change = {
    contact_id: "contact-2",
    change_type: "field_update",
    summary: "Recommended change",
    payload: {
      contact_id: "contact-2",
      field: "email",
      proposed_value: "brooks@example.com",
      why: "Shared during a later conversation.",
    },
    contact: { full_name: "Brooks Golden", company_name: "Growth Architects" },
  };

  assert.deepEqual(changeCardIdentity(change), {
    name: "Brooks Golden",
    company: "Growth Architects",
  });
  assert.deepEqual(changeRecommendationLines(change), [
    "Update the email to brooks@example.com.",
  ]);
  assert.equal(changeApprovalLabel(change), "Approve");
});
