import type { QualityContact } from "@/lib/data-quality";
import {
  buildPreinstallReview,
  type PreinstallEnrichmentJob,
  type PreinstallPendingChange,
} from "@/lib/preinstall-review";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function exactReadIsComplete(count: number | null, rows: unknown[]) {
  return Number.isSafeInteger(count) && (count ?? -1) >= 0 && count === rows.length;
}

export async function getPreinstallReviewData(tenantId: string | null | undefined) {
  const admin = tenantId ? createSupabaseAdminClient() : null;
  if (!tenantId || !admin) {
    return {
      review: buildPreinstallReview({ changes: [], contacts: [], jobs: [] }),
      contacts: [] as QualityContact[],
      loadError: true,
      setupMode: true,
    };
  }

  const [changesResult, contactsResult, jobsResult] = await Promise.all([
    admin
      .from("pending_changes")
      .select("id, change_type, summary, payload, source, created_at", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(250),
    admin
      .from("contacts")
      .select(
        "id, full_name, email, phone, company_name, role_title, one_line_summary, trust_level, relationship_strength, relationship_type, last_spoke, how_we_met, why_stay_in_touch, current_asks, wants_help_with, ideal_referral, podcast_fit, linkedin, instagram, facebook, x_twitter, youtube, podcast_url, website, recent_activity, private_notes",
        { count: "exact" },
      )
      .eq("tenant_id", tenantId)
      .is("archived_at", null)
      .order("full_name", { ascending: true })
      .limit(1000),
    admin
      .from("jobs")
      .select("id, status, attempts, run_after, payload", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("job_type", "contact_enrichment")
      .in("status", ["queued", "running"])
      .order("run_after", { ascending: true })
      .limit(500),
  ]);

  const changes = (changesResult.data ?? []) as PreinstallPendingChange[];
  const contacts = (contactsResult.data ?? []) as unknown as QualityContact[];
  const jobs = ((jobsResult.data ?? []) as PreinstallEnrichmentJob[]).filter(
    (job) => job.payload.test_mode !== true,
  );
  const loadError = Boolean(
    changesResult.error
      || contactsResult.error
      || jobsResult.error
      || !exactReadIsComplete(changesResult.count, changes)
      || !exactReadIsComplete(contactsResult.count, contacts)
      || !exactReadIsComplete(jobsResult.count, jobsResult.data ?? []),
  );

  return {
    review: buildPreinstallReview({ changes, contacts, jobs }),
    contacts,
    loadError,
    setupMode: false,
  };
}
