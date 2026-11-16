import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export type ContactCreationResult = {
  contactId: string;
  created: boolean;
  replayed: boolean;
  approvalReplayed?: boolean;
};

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function parseCreationResult(data: unknown): ContactCreationResult | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const result = data as Record<string, unknown>;
  if (!isUuid(result.contact_id)) return null;
  return {
    contactId: result.contact_id,
    created: result.created === true,
    replayed: result.replayed === true,
    approvalReplayed:
      typeof result.approval_replayed === "boolean"
        ? result.approval_replayed
        : undefined,
  };
}

export async function createContactOnce({
  admin,
  tenantId,
  actorUserId,
  requestKey,
  fields,
  source,
  extra = {},
}: {
  admin: AdminClient;
  tenantId: string;
  actorUserId: string;
  requestKey: string;
  fields: Record<string, unknown>;
  source: string;
  extra?: Record<string, unknown>;
}) {
  const { data, error } = await admin.rpc("lbb_create_contact_once", {
    p_tenant_id: tenantId,
    p_actor_user_id: actorUserId,
    p_creation_request_key: requestKey,
    p_contact_fields: fields,
    p_source: source,
    p_extra: extra,
  });
  if (error) return { result: null, error };
  const result = parseCreationResult(data);
  return {
    result,
    error: result ? null : new Error("Contact creation returned an invalid result."),
  };
}

export async function approveNewContactOnce({
  admin,
  tenantId,
  pendingChangeId,
  actorUserId,
  fields,
  source,
  extra = {},
}: {
  admin: AdminClient;
  tenantId: string;
  pendingChangeId: string;
  actorUserId: string;
  fields: Record<string, unknown>;
  source: string;
  extra?: Record<string, unknown>;
}) {
  const { data, error } = await admin.rpc("lbb_approve_new_contact_once", {
    p_tenant_id: tenantId,
    p_pending_change_id: pendingChangeId,
    p_actor_user_id: actorUserId,
    p_contact_fields: fields,
    p_source: source,
    p_extra: extra,
  });
  if (error) return { result: null, error };
  const result = parseCreationResult(data);
  return {
    result,
    error: result ? null : new Error("Contact approval returned an invalid result."),
  };
}
