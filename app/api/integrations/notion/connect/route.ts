import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  createNotionOauthState,
  notionAuthorizationUrl,
  notionOauthConfigured,
  notionRedirectUri,
} from "@/lib/integrations/recordings/notion";
import { requireOperatorAccess } from "@/lib/operator-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const cookieOptions = {
  httpOnly: true,
  maxAge: 10 * 60,
  path: "/api/integrations/notion",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

function recordings(request: NextRequest, message: string) {
  return NextResponse.redirect(
    new URL(`/recordings?message=${encodeURIComponent(message)}`, request.url),
  );
}

export async function GET(request: NextRequest) {
  const context = await requireOperatorAccess();
  const admin = createSupabaseAdminClient();
  if (!context) return recordings(request, "An active client install is required before connecting Notion.");
  // An allowlisted owner's membership is intentionally presented as operator mode through
  // the operator-email allowlist. The service-only RPC still verifies the raw
  // tenant membership is an active owner before it creates OAuth state.
  if (!admin) return recordings(request, "The private data connection is unavailable.");
  if (!notionOauthConfigured()) {
    return recordings(request, "Notion meeting notes are not configured for this install yet.");
  }
  const state = createNotionOauthState();
  const stateHash = createHash("sha256").update(state).digest("hex");
  const { error } = await admin.rpc("lbb_create_notion_oauth_transaction", {
    p_tenant_id: context.tenantId,
    p_user_id: context.userId,
    p_state_hash: stateHash,
  });
  if (error) return recordings(request, "Notion authorization could not be started.");

  const redirectUri = notionRedirectUri(new URL(request.url).origin);
  const response = NextResponse.redirect(notionAuthorizationUrl({ redirectUri, state }));
  response.cookies.set("lbb_notion_oauth_state", state, cookieOptions);
  return response;
}
