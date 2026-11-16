import { isModuleEnabled, type ModuleKey } from "@/lib/modules";
import { redirectWithMessage } from "@/lib/server-action-redirect";
import { getTenantContext } from "@/lib/tenant-context";

export async function requireEnabledModule(key: ModuleKey) {
  const context = await getTenantContext();

  if (context && !isModuleEnabled(context.settings, key)) {
    const target = context.role === "operator" ? "/settings" : "/dashboard";
    redirectWithMessage(target, "That module is hidden for this install.");
  }
}
