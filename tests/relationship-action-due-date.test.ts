import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  dateInDays,
  suggestedRelationshipActionDueDate,
} from "../lib/relationship-action-due-date.js";

const now = new Date("2026-07-22T12:00:00.000Z");

describe("relationship action due date defaults", () => {
  test("formats UTC dates from relative day counts", () => {
    assert.equal(dateInDays(7, now), "2026-07-29");
  });

  test("keeps high-priority moves close and low-priority moves lighter", () => {
    assert.equal(
      suggestedRelationshipActionDueDate({ now, priority: "high", type: "referral" }),
      "2026-07-24",
    );
    assert.equal(
      suggestedRelationshipActionDueDate({ now, priority: "low", type: "follow_up" }),
      "2026-08-12",
    );
  });

  test("uses relationship type when priority is normal", () => {
    assert.equal(
      suggestedRelationshipActionDueDate({
        now,
        priority: "normal",
        type: "owner_verification",
      }),
      "2026-07-25",
    );
    assert.equal(
      suggestedRelationshipActionDueDate({ now, priority: "normal", type: "reconnect" }),
      "2026-08-05",
    );
  });
});
