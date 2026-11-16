import { type QualityContact } from "@/lib/data-quality";
import { sampleContacts } from "@/lib/sample-data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActiveQualityJob = {
  id: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
};

function isQualityRelevantJob(job: ActiveQualityJob) {
  return (
    job.payload.trigger === "quality_cleanup" ||
    job.payload.source === "quality_cleanup_job" ||
    job.payload.source === "operator_quality_workspace"
  );
}

export async function getQualityContacts(tenantId?: string) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      contacts: sampleContacts as unknown as QualityContact[],
      activeJobs: [] as ActiveQualityJob[],
      count: sampleContacts.length,
      setupMode: true,
    };
  }

  const contactsResult = await supabase
    .from("contacts")
    .select(
        "id, full_name, email, phone, company_name, role_title, one_line_summary, trust_level, relationship_strength, relationship_type, last_spoke, how_we_met, why_stay_in_touch, current_asks, wants_help_with, ideal_referral, podcast_fit, linkedin, instagram, facebook, x_twitter, youtube, podcast_url, website, recent_activity, private_notes",
      { count: "exact" },
    )
    .is("archived_at", null)
    .order("full_name")
    .limit(1000);

  const admin = tenantId ? createSupabaseAdminClient() : null;
  const jobsQuery = admin
    ? admin
        .from("jobs")
        .select("id, status, payload, created_at")
        .eq("tenant_id", tenantId)
        .eq("job_type", "contact_enrichment")
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: false })
        .limit(500)
    : supabase
        .from("jobs")
        .select("id, status, payload, created_at")
        .eq("job_type", "contact_enrichment")
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: false })
        .limit(500);

  const jobsResult = await jobsQuery;

  return {
    contacts: ((contactsResult.data ?? []) as unknown) as QualityContact[],
    activeJobs: (((jobsResult.data ?? []) as unknown) as ActiveQualityJob[]).filter(
      isQualityRelevantJob,
    ),
    count: contactsResult.count ?? contactsResult.data?.length ?? 0,
    setupMode: false,
  };
}
