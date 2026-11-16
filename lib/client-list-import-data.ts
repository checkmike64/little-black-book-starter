import type { ClientListImportIdentity } from "@/lib/client-list-import";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/tenant-context";

export type ClientImportBatch = {
  id: string;
  file_name: string;
  status: "applied" | "rolled_back";
  ready_count: number;
  created_at: string;
  rolled_back_at: string | null;
};

export async function getClientListImportIdentities() {
  const context = await getTenantContext();
  const admin = createSupabaseAdminClient();
  if (!admin || context?.role !== "operator") return [] as ClientListImportIdentity[];

  const rows: ClientListImportIdentity[] = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    const { data, error } = await admin
      .from("contacts")
      .select("id, full_name, email, company_name, linkedin")
      .eq("tenant_id", context.tenantId)
      .is("archived_at", null)
      .order("id")
      .range(offset, offset + 999);
    if (error) return rows;
    const page = ((data ?? []) as unknown) as ClientListImportIdentity[];
    rows.push(...page);
    if (page.length < 1000) break;
  }

  return rows;
}

export async function getClientListImportBatches() {
  const context = await getTenantContext();
  const admin = createSupabaseAdminClient();
  if (!admin || context?.role !== "operator") return [] as ClientImportBatch[];

  const { data } = await admin
    .from("client_import_batches")
    .select("id, file_name, status, ready_count, created_at, rolled_back_at")
    .eq("tenant_id", context.tenantId)
    .order("created_at", { ascending: false })
    .limit(20);

  return ((data ?? []) as unknown) as ClientImportBatch[];
}
