import type { SupabaseClient } from "@supabase/supabase-js";

export type PendingChangeQueueRow = {
  id: string;
  contact_id: string | null;
  change_type: string;
  summary: string;
  payload: Record<string, unknown>;
  risk_level: string | null;
  source: string | null;
  created_at: string;
  replaces_pending_change_id: string | null;
  replaced_by_pending_change_id: string | null;
  superseded_at: string | null;
};

const pageSize = 1000;
const selectedColumns = [
  "id",
  "contact_id",
  "change_type",
  "summary",
  "payload",
  "risk_level",
  "source",
  "created_at",
  "replaces_pending_change_id",
  "replaced_by_pending_change_id",
  "superseded_at",
].join(", ");

export async function loadPendingChangeQueueRows(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const rows: PendingChangeQueueRow[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("pending_changes")
      .select(selectedColumns)
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      return { data: [] as PendingChangeQueueRow[], error: true };
    }

    const page = ((data ?? []) as unknown) as PendingChangeQueueRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return { data: rows, error: false };
}
