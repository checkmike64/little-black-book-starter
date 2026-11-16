import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildReviewQueueObservation,
  reviewQueueLane,
  type ReviewQueueRow,
} from "../lib/review-queue-observation.js";

function row(overrides: Partial<ReviewQueueRow> = {}): ReviewQueueRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    contact_id: "22222222-2222-4222-8222-222222222222",
    change_type: "field_update",
    payload: { fields: { company_name: "Example" } },
    risk_level: "low",
    source: "claude_enrichment",
    created_at: "2026-09-10T12:00:00.000Z",
    replaces_pending_change_id: null,
    replaced_by_pending_change_id: null,
    superseded_at: null,
    ...overrides,
  };
}

describe("review queue observation", () => {
  test("assigns every pending proposal to an explicit lane", () => {
    const rows = [
      row(),
      row({
        id: "33333333-3333-4333-8333-333333333333",
        payload: { fields: { trust_level: "trusted" } },
        risk_level: "high",
      }),
      row({
        id: "44444444-4444-4444-8444-444444444444",
        contact_id: null,
        change_type: "new_contact",
        payload: { contact: { full_name: "New person" } },
      }),
      row({
        id: "55555555-5555-4555-8555-555555555555",
        payload: {
          fields: { trust_level: "trusted" },
          quality_cleanup: {
            blocked_fields: ["trust_level"],
            field_needs_owner_verification: true,
            proposed_field: "trust_level",
          },
        },
      }),
      row({
        id: "66666666-6666-4666-8666-666666666666",
        payload: {
          fields: { trust_level: "trusted" },
          owner_context: { status: "revision_queued" },
        },
      }),
      row({
        id: "77777777-7777-4777-8777-777777777777",
        change_type: "unknown_change",
        payload: { unexpected: "value" },
      }),
      row({
        id: "88888888-8888-4888-8888-888888888888",
        payload: { dry_run: true, fields: { company_name: "Test" } },
      }),
      row({
        id: "99999999-9999-4999-8999-999999999999",
        replaced_by_pending_change_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ];

    assert.deepEqual(rows.map(reviewQueueLane), [
      "ready",
      "detailed",
      "new_person",
      "needs_context",
      "waiting_revision",
      "unsupported",
      "controlled_test",
      "replaced",
    ]);

    const observation = buildReviewQueueObservation({
      rows,
      exactCount: rows.length,
    });

    assert.equal(observation.state, "complete");
    assert.equal(observation.totalCount, 8);
    assert.equal(observation.actionableCount, 6);
    assert.equal(observation.excludedCount, 2);
    assert.equal(observation.lanes.find((lane) => lane.key === "ready")?.count, 1);
    assert.equal(
      observation.lanes.find((lane) => lane.key === "controlled_test")?.blocking,
      false,
    );
  });

  test("keeps operator-routed meeting actions in detailed review", () => {
    assert.equal(
      reviewQueueLane(
        row({
          source: "recording_operator",
          change_type: "recording_action",
          payload: { action: { title: "Send the document" } },
        }),
      ),
      "detailed",
    );
  });

  test("fails closed when the exact count and returned rows differ", () => {
    const observation = buildReviewQueueObservation({
      rows: [row()],
      exactCount: 2,
    });

    assert.equal(observation.state, "incomplete");
    assert.equal(observation.actionableCount, null);
    assert.match(observation.reason ?? "", /could not be reconciled/);
  });

  test("fails closed on null, fractional, duplicate, or malformed observations", () => {
    for (const observation of [
      buildReviewQueueObservation({ rows: [], exactCount: null }),
      buildReviewQueueObservation({ rows: [], exactCount: 0.5 }),
      buildReviewQueueObservation({ rows: [row(), row()], exactCount: 2 }),
      buildReviewQueueObservation({
        rows: [row({ created_at: "not-a-date" })],
        exactCount: 1,
      }),
      buildReviewQueueObservation({ rows: [], exactCount: 0, error: "query failed" }),
    ]) {
      assert.equal(observation.state, "incomplete");
      assert.equal(observation.actionableCount, null);
    }
  });
});
