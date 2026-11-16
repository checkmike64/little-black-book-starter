export function isMachineAuthenticatedPath(pathname: string) {
  return (
    pathname === "/auth/callback" ||
    pathname.startsWith("/api/claude/") ||
    pathname === "/api/automation/daily" ||
    pathname === "/api/automation/enrichment" ||
    pathname === "/api/automation/networking" ||
    pathname === "/api/automation/recordings" ||
    pathname === "/api/integrations/apify/webhook" ||
    pathname === "/api/integrations/notion/webhook" ||
    pathname.startsWith("/api/integrations/recordings/fathom/") ||
    pathname.startsWith("/api/integrations/recordings/fireflies/")
  );
}

export function isSupabaseAuthCookieName(name: string) {
  return /^sb-[a-z0-9]+-auth-token(?:\.\d+)?$/i.test(name);
}

export function isInvalidRefreshTokenError(error: {
  code?: string;
  message?: string;
} | null | undefined) {
  const normalized = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return (
    normalized.includes("refresh_token_not_found") ||
    normalized.includes("refresh_token_already_used") ||
    normalized.includes("refresh token not found") ||
    normalized.includes("invalid refresh token")
  );
}
