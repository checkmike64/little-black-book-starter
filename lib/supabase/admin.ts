import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv, getServiceRoleKey } from "@/lib/env";

export function createSupabaseAdminClient() {
  const { url } = getPublicSupabaseEnv();
  const serviceRoleKey = getServiceRoleKey();

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
