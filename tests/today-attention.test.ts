import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildTodayAttention } from "../lib/today-attention.js";

describe("Today attention", () => {
  test("puts overdue owner promises before lower-risk work", () => {
    const items = buildTodayAttention({
      today: "2026-09-12",
      promises: [
        {
          id: "promise-1",
          promise_text: "Send the introduction",
          direction: "owner_owes_contact",
          due_on: "2026-09-10",
          contacts: { id: "contact-1", full_name: "Example Person" },
        },
      ],
      changes: [
        {
          id: "change-1",
          change_type: "field_update",
          summary: "Update company",
          risk_level: "low",
          source: "owner_note",
          created_at: "2026-09-12T10:00:00Z",
        },
      ],
      actions: [],
    });

    assert.equal(items[0].key, "promise:promise-1");
    assert.equal(items[0].label, "You owe");
    assert.match(items[0].detail, /2 days overdue/);
    assert.equal(items[0].href, "/promises?filter=owner");
  });

  test("labels waiting promises separately", () => {
    const [item] = buildTodayAttention({
      today: "2026-09-12",
      promises: [
        {
          id: "promise-1",
          promise_text: "Send availability",
          direction: "contact_owes_owner",
          due_on: null,
          contacts: { full_name: "Example Person" },
        },
      ],
      changes: [],
      actions: [],
    });

    assert.equal(item.label, "Waiting on them");
    assert.equal(item.href, "/promises?filter=contact");
    assert.match(item.detail, /No due date/);
  });

  test("does not present an unapproved meeting proposal as an active promise", () => {
    const [item] = buildTodayAttention({
      today: "2026-09-12",
      promises: [
        {
          id: "promise-review",
          promise_text: "Send the notes",
          direction: "owner_owes_contact",
          due_on: "2026-09-12",
          review_status: "pending_owner",
          contacts: { full_name: "Example Person" },
        },
      ],
      changes: [],
      actions: [],
    });

    assert.equal(item.label, "Meeting proposal");
    assert.equal(item.action, "Review proposal");
    assert.match(item.detail, /Not active until you approve it/);
  });

  test("keeps identity and high-risk changes explicit", () => {
    const items = buildTodayAttention({
      today: "2026-09-12",
      promises: [],
      changes: [
        {
          id: "identity-change",
          change_type: "contact_candidate",
          summary: "Review a new person",
          risk_level: "high",
          source: "claude_intake",
          created_at: "2026-09-12T10:00:00Z",
        },
      ],
      actions: [],
    });

    assert.equal(items[0].label, "Identity decision");
    assert.equal(items[0].href, "/changes/identity-change");
    assert.equal(items[0].tone, "warn");
  });

  test("turns the intake summary into a plain new-person row", () => {
    const [item] = buildTodayAttention({
      today: "2026-09-12",
      promises: [],
      changes: [
        {
          id: "identity-change",
          change_type: "contact_candidate",
          summary: "Add Alex Example (Acme) to the book — Met on a recent call",
          risk_level: "high",
          source: "claude_intake",
          created_at: "2026-09-12T10:00:00Z",
        },
      ],
      actions: [],
    });

    assert.equal(item.title, "Add Alex Example to the Book");
    assert.equal(item.detail, "Acme · Met on a recent call");
    assert.equal(item.action, "Review");
  });

  test("limits the visible list after deterministic sorting", () => {
    const items = buildTodayAttention({
      today: "2026-09-12",
      promises: [],
      changes: [],
      actions: Array.from({ length: 12 }, (_, index) => ({
        id: `action-${index}`,
        title: `Action ${index}`,
        action_type: "follow_up",
        status: "open",
        priority: "normal",
        due_on: `2026-09-${String(12 + index).padStart(2, "0")}`,
        contacts: null,
      })),
      limit: 5,
    });

    assert.equal(items.length, 5);
    assert.equal(items[0].key, "action:action-0");
  });
});
