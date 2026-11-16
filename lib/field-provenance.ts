type ManualFieldProvenanceInput = {
  tenantId: string;
  actorUserId: string;
  tableName?: string;
  recordId: string;
  fields: string[];
  sourceRef: string;
  summary: string;
  metadata?: Record<string, unknown>;
};

export function buildManualFieldProvenanceRows({
  tenantId,
  actorUserId,
  tableName = "contacts",
  recordId,
  fields,
  sourceRef,
  summary,
  metadata = {},
}: ManualFieldProvenanceInput) {
  return fields.map((field) => ({
    tenant_id: tenantId,
    table_name: tableName,
    record_id: recordId,
    field_name: field,
    source_type: "manual",
    source_ref: sourceRef,
    summary,
    confidence: 1,
    metadata: {
      ...metadata,
      actor_user_id: actorUserId,
    },
  }));
}
