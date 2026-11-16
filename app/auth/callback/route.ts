import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authErrorMessage, loginPathWithMessage } from "@/lib/auth-messages";
import { getPublicSupabaseEnv } from "@/lib/env";
import { safeReturnPath } from "@/lib/return-path";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const next = safeReturnPath(requestUrl.searchParams.get("next"), "/dashboard");

  if (!code && !tokenHash) {
    const url = new URL(
      loginPathWithMessage("The sign-in link was missing a login code.", next),
      requestUrl.origin,
    );
    return NextResponse.redirect(url);
  }

  const { url, anonKey, hasEnv } = getPublicSupabaseEnv();
  if (!hasEnv || !url || !anonKey) {
    const loginUrl = new URL(
      loginPathWithMessage("missing-env", next),
      requestUrl.origin,
    );
    return NextResponse.redirect(loginUrl);
  }

  const redirectUrl = new URL(next, requestUrl.origin);
  let response = NextResponse.redirect(redirectUrl);
  response.headers.set("Cache-Control", "private, no-store");

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
      },
    },
  });

  const { error } = tokenHash
    ? await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "email",
      })
    : await supabase.auth.exchangeCodeForSession(code as string);
  if (error) {
    const loginUrl = new URL(
      loginPathWithMessage(authErrorMessage(error), next),
      requestUrl.origin,
    );
    response = NextResponse.redirect(loginUrl);
    response.headers.set("Cache-Control", "private, no-store");
  }

  return response;
}
