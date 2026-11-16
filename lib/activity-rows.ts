type ClientAuditRowInput = {
  tenantId: string;
  actorUserId: string;
  action: string;
  tableName: string;
  recordId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
};

type ClientUsageEventInput = {
  tenantId: string;
  actorUserId: string;
  eventType: string;
  unit: string;
  quantity?: number;
  metadata?: Record<string, unknown>;
};

export function buildClientAuditRow({
  tenantId,
  actorUserId,
  action,
  tableName,
  recordId,
  before,
  after,
  metadata,
}: ClientAuditRowInput) {
  return {
    tenant_id: tenantId,
    actor_user_id: actorUserId,
    actor_type: "client",
    action,
    table_name: tableName,
    record_id: recordId,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export function buildClientUsageEvent({
  tenantId,
  actorUserId,
  eventType,
  quantity = 1,
  unit,
  metadata,
}: ClientUsageEventInput) {
  return {
    tenant_id: tenantId,
    actor_user_id: actorUserId,
    actor_type: "client",
    event_type: eventType,
    quantity,
    unit,
    ...(metadata === undefined ? {} : { metadata }),
  };
}
