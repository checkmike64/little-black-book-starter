"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseEnv } from "@/lib/env";

export function createSupabaseBrowserClient() {
  const { url, anonKey, hasEnv } = getPublicSupabaseEnv();

  if (!hasEnv || !url || !anonKey) {
    throw new Error("Supabase browser environment variables are not configured.");
  }

  return createBrowserClient(url, anonKey);
}
