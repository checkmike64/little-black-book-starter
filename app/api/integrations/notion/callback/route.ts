import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  exchangeNotionCode,
  notionOwnerIdentity,
  notionRedirectUri,
} from "@/lib/integrations/recordings/notion";
import { reconcileNotionArtifactReceipts } from "@/lib/integrations/recordings/ingest";
import { requireOperatorAccess } from "@/lib/operator-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const expiredCookie = {
  httpOnly: true,
  maxAge: 0,
  path: "/api/integrations/notion",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

function finish(request: NextRequest, message: string) {
  const response = NextResponse.redirect(
    new URL(`/recordings?message=${encodeURIComponent(message)}`, request.url),
  );
  response.cookies.set("lbb_notion_oauth_state", "", expiredCookie);
  return response;
}

export async function GET(request: NextRequest) {
  const context = await requireOperatorAccess();
  const admin = createSupabaseAdminClient();
  if (!context) return finish(request, "An active client install is required before connecting Notion.");
  // Effective operator mode may wrap an underlying owner membership. The
  // service-only consume/save RPCs remain the source of truth for owner access.
  if (!admin) return finish(request, "The private data connection is unavailable.");
  if (request.nextUrl.searchParams.get("error")) {
    return finish(request, "Notion authorization was not completed.");
  }
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const savedState = request.cookies.get("lbb_notion_oauth_state")?.value;
  if (!state || !code || !savedState || state !== savedState) {
    return finish(request, "Notion authorization could not be verified.");
  }
  const { data: validState, error: stateError } = await admin.rpc(
    "lbb_consume_notion_oauth_transaction",
    {
      p_tenant_id: context.tenantId,
      p_user_id: context.userId,
      p_state_hash: createHash("sha256").update(state).digest("hex"),
    },
  );
  if (stateError || validState !== true) {
    return finish(request, "Notion authorization expired or was already used. Please try again.");
  }
  try {
    const redirectUri = notionRedirectUri(new URL(request.url).origin);
    const token = await exchangeNotionCode({ code, redirectUri });
    const identity = notionOwnerIdentity(token);
    if (!identity.email || !identity.workspaceId || !token.access_token || !token.refresh_token) {
      throw new Error("Notion did not return a verified owner and workspace identity.");
    }
    const { data: connectionId, error: saveError } = await admin.rpc(
      "lbb_save_notion_recording_connection",
      {
        p_tenant_id: context.tenantId,
        p_owner_user_id: context.userId,
        p_external_account_email: identity.email,
        p_workspace_id: identity.workspaceId,
        p_workspace_name: identity.workspaceName,
        p_access_token: token.access_token,
        p_refresh_token: token.refresh_token,
      },
    );
    if (saveError || typeof connectionId !== "string") {
      throw new Error("Notion authorization could not be saved.");
    }
    const reconciliation = await reconcileNotionArtifactReceipts({
      admin,
      connectionId,
      trigger: "manual",
    });
    return finish(
      request,
      `Notion connected. ${reconciliation.enqueued} recent meeting note${reconciliation.enqueued === 1 ? "" : "s"} queued for private review.`,
    );
  } catch (caught) {
    const message = caught instanceof Error
      ? caught.message
      : "Notion meeting notes could not be connected.";
    return finish(request, message);
  }
}
