import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import {
  getPublicSupabaseEnv,
  isSetupModeAllowed,
  missingSupabaseEnvMessage,
} from "@/lib/env";
import { privateHeaderValues } from "@/lib/private-headers";
import {
  isInvalidRefreshTokenError,
  isMachineAuthenticatedPath,
  isSupabaseAuthCookieName,
} from "@/lib/proxy-routing";

const publicPaths = ["/login", "/auth/callback", "/robots.txt", "/sitemap.xml"];

function isPublicPath(pathname: string) {
  return (
    publicPaths.includes(pathname) ||
    pathname.startsWith("/api/claude/") ||
    pathname === "/api/automation/daily" ||
    pathname === "/api/automation/enrichment" ||
    pathname === "/api/automation/networking" ||
    pathname === "/api/automation/recordings" ||
    pathname === "/api/integrations/apify/webhook" ||
    pathname === "/api/integrations/notion/webhook" ||
    pathname.startsWith("/api/integrations/recordings/") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  );
}

function withPrivateHeaders(response: NextResponse) {
  Object.entries(privateHeaderValues).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

function clearInvalidSupabaseAuthCookies(
  request: NextRequest,
  response: NextResponse,
) {
  request.cookies.getAll().forEach(({ name }) => {
    if (isSupabaseAuthCookieName(name)) {
      response.cookies.set(name, "", {
        httpOnly: true,
        maxAge: 0,
        path: "/",
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
      });
    }
  });
}

// Forward the request unchanged. `request` passes the (possibly cookie-refreshed)
// request headers through to the route; never also pass them as response
// `headers`, which echoes every inbound header back to the browser. That echo
// leaked Vercel's internal proxy signature and stamped a Server Action's form
// upload content type and another invocation's routing headers onto its
// redirect response, which left "Mark done" stuck on "Saving…" in production.
function continueRequest(request: NextRequest) {
  return withPrivateHeaders(NextResponse.next({ request }));
}

export async function proxy(request: NextRequest) {
  let response = continueRequest(request);

  const { url: supabaseUrl, anonKey: supabaseAnonKey } = getPublicSupabaseEnv();

  if (!supabaseUrl || !supabaseAnonKey) {
    if (!isSetupModeAllowed() && !isPublicPath(request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      url.searchParams.set("message", missingSupabaseEnvMessage());
      url.searchParams.set("next", request.nextUrl.pathname);
      return withPrivateHeaders(NextResponse.redirect(url));
    }

    return response;
  }

  // These endpoints authenticate with their own scoped bearer, cron, or
  // webhook contract. They never consume a browser session, so avoid an Auth
  // round trip on every machine request.
  if (isMachineAuthenticatedPath(request.nextUrl.pathname)) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = continueRequest(request);
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const hasVerifiedUser = Boolean(claimsData?.claims?.sub);

  if (!hasVerifiedUser && !isPublicPath(request.nextUrl.pathname)) {
    const intendedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", intendedPath);
    const invalidRefreshToken = isInvalidRefreshTokenError(claimsError);
    if (invalidRefreshToken) {
      url.searchParams.set("message", "Your session ended. Sign in again.");
    }
    const redirectResponse = withPrivateHeaders(NextResponse.redirect(url));
    if (invalidRefreshToken) {
      clearInvalidSupabaseAuthCookies(request, redirectResponse);
    }
    return redirectResponse;
  }

  if (hasVerifiedUser && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return withPrivateHeaders(NextResponse.redirect(url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!.*\\..*|_next/static|_next/image).*)"],
};
