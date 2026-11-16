import { privateJson } from "@/app/api/claude/_shared";
import { processContactEnrichmentQueue } from "@/lib/enrichment/worker";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;
// Do not start another person after this point; one person can take ~2 minutes.
export const enrichmentClaimCutoffMs = 150_000;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`,
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return privateJson({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return privateJson(
      { error: "The private data connection is unavailable." },
      { status: 500 },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await processContactEnrichmentQueue({
      admin,
      deadline: startedAt + enrichmentClaimCutoffMs,
    });
    return privateJson({ ...result, duration_ms: Date.now() - startedAt });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Enrichment queue failed.";
    console.error("[automation.enrichment] failed", { error: message.slice(0, 500) });
    return privateJson({ error: "Enrichment queue processing failed." }, { status: 500 });
  }
}
