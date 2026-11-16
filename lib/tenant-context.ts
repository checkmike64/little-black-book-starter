import { cache } from "react";
import { getEffectiveTenantRole } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type TenantRole = "owner" | "operator";

export type TenantContext = {
  tenantId: string;
  tenantName: string;
  role: TenantRole;
  settings: unknown;
  settingsVersion?: number;
  userId: string;
  userEmail: string | null;
};

type MembershipRow = {
  tenant_id: string;
  role: TenantRole;
};

async function getTenantContextUncached(): Promise<TenantContext | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const membership = data as MembershipRow;
  // Full settings contain operator-only policy, provider, pricing, and prompt
  // configuration. Fetch them only with the server-held service role so an
  // owner cannot query the hidden strategy through the Data API.
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("name, settings, settings_version")
    .eq("id", membership.tenant_id)
    .maybeSingle();
  if (tenantError || !tenant) return null;

  return {
    tenantId: membership.tenant_id,
    tenantName: tenant?.name ?? "Current install",
    role: getEffectiveTenantRole(membership.role, user.email) as TenantRole,
    settings: tenant?.settings ?? {},
    settingsVersion: tenant?.settings_version ?? 1,
    userId: user.id,
    userEmail: user.email ?? null,
  };
}

// Server Components, module gates, and data loaders often need the same tenant
// context during one render. React cache is request-scoped, so it removes the
// duplicate Auth/membership/settings round trips without sharing data between
// requests, users, or tenants.
export const getTenantContext = cache(getTenantContextUncached);
