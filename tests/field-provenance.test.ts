import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildManualFieldProvenanceRows } from "../lib/field-provenance.js";

describe("field provenance helpers", () => {
  test("builds one manual provenance row per changed field", () => {
    assert.deepEqual(
      buildManualFieldProvenanceRows({
        tenantId: "tenant-1",
        actorUserId: "user-1",
        recordId: "contact-1",
        fields: ["trust_level", "relationship_strength"],
        sourceRef: "owner_posture_control",
        summary: "Updated from owner controls.",
      }),
      [
        {
          tenant_id: "tenant-1",
          table_name: "contacts",
          record_id: "contact-1",
          field_name: "trust_level",
          source_type: "manual",
          source_ref: "owner_posture_control",
          summary: "Updated from owner controls.",
          confidence: 1,
          metadata: {
            actor_user_id: "user-1",
          },
        },
        {
          tenant_id: "tenant-1",
          table_name: "contacts",
          record_id: "contact-1",
          field_name: "relationship_strength",
          source_type: "manual",
          source_ref: "owner_posture_control",
          summary: "Updated from owner controls.",
          confidence: 1,
          metadata: {
            actor_user_id: "user-1",
          },
        },
      ],
    );
  });

  test("preserves extra metadata while keeping actor provenance explicit", () => {
    const [row] = buildManualFieldProvenanceRows({
      tenantId: "tenant-1",
      actorUserId: "user-1",
      tableName: "want_to_know",
      recordId: "candidate-1",
      fields: ["stage"],
      sourceRef: "owner_review",
      summary: "Owner reviewed the stage.",
      metadata: {
        surface: "quality",
      },
    });

    assert.equal(row.table_name, "want_to_know");
    assert.deepEqual(row.metadata, {
      surface: "quality",
      actor_user_id: "user-1",
    });
  });
});
