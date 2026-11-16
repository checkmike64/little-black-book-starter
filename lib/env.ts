export function getPublicSupabaseEnv() {
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const legacyAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const anonKey = publishableKey || legacyAnonKey;

  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey,
    keySource: publishableKey
      ? "publishable"
      : legacyAnonKey
        ? "legacy_anon"
        : null,
    hasEnv: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && anonKey),
  };
}

export function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

type EnvLike = Record<string, string | undefined>;

export function isProductionRuntime(env: EnvLike = process.env) {
  return env.VERCEL_ENV === "production" || env.APP_ENV === "production";
}

export function isSetupModeAllowed(env: EnvLike = process.env) {
  return env.ALLOW_SETUP_MODE === "true";
}

export function missingSupabaseEnvMessage() {
  return "The private data connection is not configured for this deployment.";
}

export function getOperatorEmailAllowlist() {
  const raw = process.env.OPERATOR_EMAILS ?? process.env.OPERATOR_EMAIL ?? "";

  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function getSupportEmail(env: EnvLike = process.env) {
  return env.SUPPORT_EMAIL?.trim().toLowerCase() || null;
}

export function isOperatorEmail(email: string | null | undefined) {
  if (!email) return false;
  return getOperatorEmailAllowlist().includes(email.trim().toLowerCase());
}

export function getEffectiveTenantRole<T extends string | null | undefined>(
  role: T,
  email: string | null | undefined,
) {
  if (role === "operator" || isOperatorEmail(email)) return "operator";
  return role;
}
