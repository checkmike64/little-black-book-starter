import { NextResponse } from "next/server";
import {
  engageableSocialPostPlatform,
  normalizeExternalContentUrl,
} from "@/lib/engagement-source";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/tenant-context";

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getTenantContext();
  const admin = createSupabaseAdminClient();
  const { id } = await params;

  if (!context) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (!admin || !validUuid(id)) {
    return NextResponse.redirect(
      new URL("/engagement?message=That+post+could+not+be+opened.", request.url),
    );
  }

  const { data } = await admin
    .from("signals")
    .select("source_url")
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  const sourceUrl = normalizeExternalContentUrl(data?.source_url ?? "");

  if (!sourceUrl || !engageableSocialPostPlatform(sourceUrl)) {
    return NextResponse.redirect(
      new URL(
        "/engagement?message=That+link+is+not+an+engageable+social+post.",
        request.url,
      ),
    );
  }

  const { error } = await admin.rpc("lbb_set_engagement_signal_state", {
    p_signal_id: id,
    p_tenant_id: context.tenantId,
    p_actor_user_id: context.userId,
    p_action: "opened",
  });
  if (error) {
    return NextResponse.redirect(
      new URL(
        "/engagement?message=The+post+is+available,+but+its+open+status+could+not+be+recorded.",
        request.url,
      ),
    );
  }

  return NextResponse.redirect(sourceUrl);
}
