import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

function rpcObject(value: unknown) {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved && typeof resolved === "object" && !Array.isArray(resolved)
    ? resolved as Record<string, unknown>
    : null;
}

export async function confirmMeetingContacts({
  admin,
  tenantId,
  transcriptId,
  actorUserId,
  contactIds,
  expectedTranscriptUpdatedAt = null,
}: {
  admin: AdminClient;
  tenantId: string;
  transcriptId: string;
  actorUserId: string;
  contactIds: string[];
  expectedTranscriptUpdatedAt?: string | null;
}) {
  const { data, error } = await admin.rpc("lbb_confirm_meeting_contacts", {
    p_tenant_id: tenantId,
    p_transcript_id: transcriptId,
    p_actor_user_id: actorUserId,
    p_contact_ids: contactIds,
    p_expected_transcript_updated_at: expectedTranscriptUpdatedAt,
  });
  const result = rpcObject(data);
  if (error || !result || result.transcript_id !== transcriptId) {
    throw new Error(error?.message ?? "Meeting contacts could not be confirmed.");
  }
  return result;
}
