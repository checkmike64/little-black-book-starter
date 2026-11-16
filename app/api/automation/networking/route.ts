import { privateJson } from "@/app/api/claude/_shared";
import { refillNetworkingRecommendations } from "@/lib/automation/networking-refill";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`,
  );
}

export async function POST(request: Request) {
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

  const { data: tenants, error } = await admin.from("tenants").select("id, settings");
  if (error) {
    return privateJson({ error: "Automation state could not be loaded." }, { status: 500 });
  }

  const results = [];
  for (const tenant of tenants ?? []) {
    try {
      const result = await refillNetworkingRecommendations({
        admin,
        tenantId: tenant.id,
        settings: tenant.settings,
      });
      results.push({ tenant_id: tenant.id, ok: true, ...result });
    } catch {
      results.push({ tenant_id: tenant.id, ok: false });
    }
  }

  return privateJson(
    { networking: results, completed_at: new Date().toISOString() },
    { status: results.some((result) => !result.ok) ? 500 : 200 },
  );
}
