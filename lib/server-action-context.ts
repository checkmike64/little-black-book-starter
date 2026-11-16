import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTenantContext, type TenantContext } from "@/lib/tenant-context";

export type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export type TenantActionContext = {
  admin: AdminClient;
  context: TenantContext;
};

export async function requireTenantActionContext(
  onMissingAdmin: () => never,
): Promise<TenantActionContext> {
  const context = await getTenantContext();
  const admin = createSupabaseAdminClient();

  if (!context) redirect("/login");
  if (!admin) onMissingAdmin();

  return { admin, context };
}

export async function requireOperatorTenantActionContext(
  onMissingAdmin: () => never,
  onForbidden: () => never,
): Promise<TenantActionContext> {
  const actionContext = await requireTenantActionContext(onMissingAdmin);

  if (actionContext.context.role !== "operator") onForbidden();

  return actionContext;
}
