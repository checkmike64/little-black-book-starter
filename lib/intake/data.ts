import {
  buildIntakeRevisionHistory,
  type IntakeRevisionAuditRow,
} from "@/lib/intake-revisions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getIntakeRevisionHistory(tenantId: string | undefined) {
  const supabase = await createSupabaseServerClient();
  if (!supabase || !tenantId) return [];

  const { data } = await supabase
    .from("audit_log")
    .select("id, actor_type, actor_user_id, action, before, after, created_at")
    .eq("tenant_id", tenantId)
    .in("action", ["tenant.intake.updated", "tenant.settings.updated"])
    .order("created_at", { ascending: false })
    .limit(10);

  return buildIntakeRevisionHistory(
    ((data ?? []) as unknown) as IntakeRevisionAuditRow[],
  );
}
