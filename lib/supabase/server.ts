import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { getPublicSupabaseEnv } from "@/lib/env";

async function createSupabaseServerClientUncached() {
  const cookieStore = await cookies();
  const { url, anonKey, hasEnv } = getPublicSupabaseEnv();

  if (!hasEnv || !url || !anonKey) {
    return null;
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server components cannot always set cookies; middleware refreshes them.
        }
      },
    },
  });
}

// A render can reach the server client through the layout, a module gate, and a
// route data loader. Keep one cookie-bound client per request so those callers
// share Auth state and refresh work instead of rebuilding the client repeatedly.
export const createSupabaseServerClient = cache(
  createSupabaseServerClientUncached,
);
