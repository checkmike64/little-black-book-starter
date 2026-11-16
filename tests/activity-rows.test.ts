import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildClientAuditRow, buildClientUsageEvent } from "../lib/activity-rows.js";

describe("activity row helpers", () => {
  test("builds client audit rows without losing before or after evidence", () => {
    assert.deepEqual(
      buildClientAuditRow({
        tenantId: "tenant-1",
        actorUserId: "user-1",
        action: "promise.status_updated",
        tableName: "promises",
        recordId: "promise-1",
        before: { status: "open" },
        after: { status: "completed" },
        metadata: { source: "test" },
      }),
      {
        tenant_id: "tenant-1",
        actor_user_id: "user-1",
        actor_type: "client",
        action: "promise.status_updated",
        table_name: "promises",
        record_id: "promise-1",
        before: { status: "open" },
        after: { status: "completed" },
        metadata: { source: "test" },
      },
    );
  });

  test("keeps usage event actor and quantity fields explicit", () => {
    assert.deepEqual(
      buildClientUsageEvent({
        tenantId: "tenant-1",
        actorUserId: "user-1",
        eventType: "relationship_action_captured",
        unit: "action",
        metadata: { action_id: "action-1" },
      }),
      {
        tenant_id: "tenant-1",
        actor_user_id: "user-1",
        actor_type: "client",
        event_type: "relationship_action_captured",
        quantity: 1,
        unit: "action",
        metadata: { action_id: "action-1" },
      },
    );
  });
});
