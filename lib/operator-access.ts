import { cookies } from "next/headers";
import { adminToolsCookieName, shouldUseAdminTools } from "@/lib/admin-mode";
import { getOperatorEmailAllowlist } from "@/lib/env";
import { shouldAllowOperatorSurface } from "@/lib/operator-surface-access";
import { canAccessOperatorTools } from "@/lib/operator-access-policy";
import { redirectWithMessage } from "@/lib/server-action-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant-context";

export { isOperatorMode } from "@/lib/operator-access-policy";

export async function requireOperatorAccess() {
  const context = await getTenantContext();
  const cookieStore = await cookies();

  if (!context) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

    if (
      canAccessOperatorTools({
        role: null,
        setupUserEmail: user?.email,
        operatorEmails: getOperatorEmailAllowlist(),
      })
    ) {
      return null;
    }

    redirectWithMessage("/dashboard", "Setup tools are operator-only for this install.");
  }

  if (context.role !== "operator") {
    redirectWithMessage("/dashboard", "Setup tools are operator-only for this install.");
  }

  const adminMode = shouldUseAdminTools({
    cookieValue: cookieStore.get(adminToolsCookieName)?.value,
    role: context.role,
  });

  if (
    !shouldAllowOperatorSurface({
      adminMode,
      role: context.role,
      setupMode: false,
    })
  ) {
    redirectWithMessage(
      "/dashboard",
      "Admin mode is off. Turn on admin tools before opening operator setup.",
    );
  }

  return context;
}
