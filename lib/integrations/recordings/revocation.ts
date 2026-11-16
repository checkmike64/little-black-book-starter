import { deleteFathomWebhook } from "./fathom-webhooks.ts";
import type { RecordingConnectionSecret } from "./types.ts";
import type { AdminClient } from "@/lib/server-action-context";

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "Fathom webhook cleanup failed.")
    .replace(/\s+/g, " ")
    .slice(0, 400);
}

export async function processPendingRecordingRevocations({
  admin,
  limit = 5,
}: {
  admin: AdminClient;
  limit?: number;
}) {
  const { data, error } = await admin
    .from("integration_connections")
    .select("id,metadata")
    .eq("provider", "fathom")
    .eq("status", "disconnected")
    .eq("upstream_revoke_status", "cleanup_pending")
    .order("updated_at", { ascending: true })
    .limit(Math.min(20, Math.max(1, limit)));
  if (error) throw new Error("Pending recording revocations could not be loaded.");

  let revoked = 0;
  let failed = 0;
  for (const row of data ?? []) {
    const { data: secretRows, error: secretError } = await admin.rpc(
      "lbb_recording_connection_secrets",
      { p_connection_id: row.id },
    );
    const connection = (Array.isArray(secretRows) ? secretRows[0] : secretRows) as
      | RecordingConnectionSecret
      | null;
    const webhookId = row.metadata && typeof row.metadata === "object"
      ? String((row.metadata as Record<string, unknown>).upstream_webhook_id ?? "")
      : "";
    try {
      if (secretError || !connection?.api_key || !webhookId) {
        throw new Error("Fathom cleanup credential or webhook ID is unavailable.");
      }
      await deleteFathomWebhook({ apiKey: connection.api_key, webhookId });
      const { data: finalized, error: finalizeError } = await admin.rpc(
        "lbb_finalize_recording_revocation",
        { p_connection_id: row.id, p_succeeded: true, p_error: null },
      );
      if (finalizeError || !finalized) throw new Error("Fathom cleanup could not be finalized.");
      revoked += 1;
    } catch (caught) {
      failed += 1;
      const { error: finishError } = await admin.rpc(
        "lbb_finalize_recording_revocation",
        {
          p_connection_id: row.id,
          p_succeeded: false,
          p_error: safeError(caught),
        },
      );
      if (finishError) throw new Error("Fathom cleanup failure could not be recorded.");
    }
  }
  return { reviewed: (data ?? []).length, revoked, failed };
}
