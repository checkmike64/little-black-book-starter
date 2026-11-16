import type { AdminClient } from "@/lib/server-action-context";

export async function enforceTranscriptRetention({
  admin,
  tenantId,
}: {
  admin: AdminClient;
  tenantId: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("transcripts")
    .select("id,storage_path")
    .eq("tenant_id", tenantId)
    .lte("retention_until", today)
    .not("retention_until", "is", null)
    .not("storage_path", "is", null)
    .is("purged_at", null)
    .limit(500);
  if (error) throw new Error("Transcript retention candidates could not be loaded.");

  let purged = 0;
  for (const transcript of data ?? []) {
    if (transcript.storage_path) {
      const { error: storageError } = await admin.storage
        .from("transcripts")
        .remove([transcript.storage_path]);
      if (storageError) throw new Error("A retained transcript object could not be removed.");
    }
    const purgedAt = new Date().toISOString();
    const { error: updateError } = await admin
      .from("transcripts")
      .update({
        storage_path: null,
        purged_at: purgedAt,
        updated_at: purgedAt,
      })
      .eq("tenant_id", tenantId)
      .eq("id", transcript.id)
      .is("purged_at", null);
    if (updateError) throw new Error("Transcript purge state could not be recorded.");
    const { error: auditError } = await admin.from("audit_log").insert({
      tenant_id: tenantId,
      actor_type: "system",
      action: "recording.raw_transcript_purged",
      table_name: "transcripts",
      record_id: transcript.id,
      metadata: { storage_object_removed: Boolean(transcript.storage_path) },
    });
    if (auditError) throw new Error("Transcript purge receipt could not be recorded.");
    purged += 1;
  }
  return { purged };
}

export async function purgeConnectionRawTranscripts({
  admin,
  tenantId,
  connectionId,
}: {
  admin: AdminClient;
  tenantId: string;
  connectionId: string;
}) {
  const { data, error } = await admin
    .from("transcripts")
    .select("id,storage_path")
    .eq("tenant_id", tenantId)
    .eq("connection_id", connectionId)
    .not("storage_path", "is", null)
    .is("purged_at", null);
  if (error) return { purged: 0, cleanupPending: true };
  let purged = 0;
  let cleanupPending = false;
  for (const transcript of data ?? []) {
    if (transcript.storage_path) {
      const { error: storageError } = await admin.storage
        .from("transcripts")
        .remove([transcript.storage_path]);
      if (storageError) {
        cleanupPending = true;
        continue;
      }
    }
    const purgedAt = new Date().toISOString();
    const { error: updateError } = await admin
      .from("transcripts")
      .update({
        storage_path: null,
        purged_at: purgedAt,
        updated_at: purgedAt,
      })
      .eq("tenant_id", tenantId)
      .eq("connection_id", connectionId)
      .eq("id", transcript.id);
    if (updateError) cleanupPending = true;
    else purged += 1;
  }
  return { purged, cleanupPending };
}
