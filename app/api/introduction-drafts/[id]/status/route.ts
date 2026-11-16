import { NextResponse } from "next/server";
import { introductionDraftState } from "@/lib/introduction-draft-state";
import { privateHeaderValues } from "@/lib/private-headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isValidUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const responseHeaders = {
  ...privateHeaderValues,
  "Cache-Control": "private, no-store",
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: responseHeaders });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const requestId = new URL(request.url).searchParams.get("request_id") ?? "";
  if (!isValidUuid(id) || !isValidUuid(requestId)) {
    return privateJson({ status: "invalid" }, 400);
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ status: "unavailable" }, 503);

  // The browser session and introductions RLS are the authorization boundary.
  // Return only lifecycle state; never return draft text, evidence, or identity.
  const { data, error } = await supabase
    .from("introductions")
    .select("draft_evidence, draft_subject, draft_body")
    .eq("id", id)
    .maybeSingle();
  if (error) return privateJson({ status: "unavailable" }, 503);
  if (!data) return privateJson({ status: "not_found" }, 404);

  const state = introductionDraftState({
    evidence: data.draft_evidence,
    hasDraft: Boolean(data.draft_subject && data.draft_body),
  });
  return privateJson({
    status: state.requestId === requestId ? state.status : "superseded",
  });
}
