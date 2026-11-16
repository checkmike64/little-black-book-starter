import { findActiveContactEnrichmentJob } from "@/lib/contact-enrichment-jobs";
import {
  buildQualityCleanupFocus,
  type QualityContact,
} from "@/lib/data-quality";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type ContactRow = QualityContact & {
  tenant_id: string | null;
};

const contactSelect =
  "id, tenant_id, full_name, email, phone, company_name, role_title, one_line_summary, trust_level, relationship_strength, relationship_type, last_spoke, how_we_met, why_stay_in_touch, current_asks, wants_help_with, ideal_referral, podcast_fit, linkedin, instagram, facebook, x_twitter, youtube, podcast_url, website, recent_activity, private_notes";

async function loadContact({
  admin,
  contactId,
  tenantId,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  contactId: string;
  tenantId: string;
}) {
  const { data, error } = await admin
    .from("contacts")
    .select(contactSelect)
    .eq("tenant_id", tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .maybeSingle();

  if (error || !data) return null;
  return data as ContactRow;
}

async function queueCleanupJob({
  admin,
  contact,
  requestedBy,
  tenantId,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  contact: ContactRow;
  requestedBy: string;
  tenantId: string;
}) {
  const activeJob = await findActiveContactEnrichmentJob({
    admin,
    tenantId,
    contactId: contact.id,
  });

  if (activeJob) return { id: activeJob.id, created: false };

  const quality_focus = buildQualityCleanupFocus(contact);
  const { data: job, error } = await admin
    .from("jobs")
    .insert({
      tenant_id: tenantId,
      job_type: "contact_enrichment",
      status: "queued",
      payload: {
        contact_id: contact.id,
        trigger: "quality_cleanup",
        source: "operator_quality_workspace",
        requested_by: requestedBy,
        quality_focus,
        required_steps: [
          "preserve_existing_book_membership",
          "inspect_quality_gaps",
          "review_existing_context",
          "gather_authorized_claude_source_context",
          "separate_facts_from_judgments",
          "owner_verification_for_judgment_fields",
          "pending_change_proposals",
        ],
        verification: {
          required: true,
          owner_conversation: "claude",
          rule: "This is an existing known relationship. Keep the contact in the Book. Use owner verification for trust, relationship strength, referral safety, private notes, and relationship thesis.",
        },
      },
      result: {
        created_from: "quality_workspace",
        quality_readiness: quality_focus.readiness,
      },
    })
    .select("id")
    .single();

  if (error || !job) return null;

  await admin.from("usage_events").insert({
    tenant_id: tenantId,
    actor_user_id: requestedBy,
    actor_type: "client",
    event_type: "quality_cleanup_queued",
    quantity: 1,
    unit: "job",
    metadata: {
      contact_id: contact.id,
      job_id: job.id,
      readiness: quality_focus.readiness,
      missing: quality_focus.missing,
    },
  });

  return { id: job.id as string, created: true };
}

export async function queueQualityCleanupBatch({
  contactIds,
  requestedBy,
  tenantId,
}: {
  contactIds: string[];
  requestedBy: string;
  tenantId: string;
}) {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return {
      configured: false,
      created: 0,
      existing: 0,
      requestedCount: contactIds.length,
      skipped: 0,
    };
  }

  let created = 0;
  let existing = 0;
  let skipped = 0;

  for (const contactId of contactIds) {
    const contact = await loadContact({
      admin,
      contactId,
      tenantId,
    });

    if (!contact) {
      skipped += 1;
      continue;
    }

    const focus = buildQualityCleanupFocus(contact);
    if (focus.readiness >= 80 && focus.missing.length === 0) {
      skipped += 1;
      continue;
    }

    const result = await queueCleanupJob({
      admin,
      contact,
      requestedBy,
      tenantId,
    });

    if (!result) {
      skipped += 1;
      continue;
    }

    if (result.created) created += 1;
    else existing += 1;
  }

  await admin.from("audit_log").insert({
    tenant_id: tenantId,
    actor_user_id: requestedBy,
    actor_type: "client",
    action: "quality.cleanup_batch_queued",
    table_name: "jobs",
    after: {
      requested_count: contactIds.length,
      created,
      existing,
      skipped,
    },
  });

  return {
    configured: true,
    created,
    existing,
    requestedCount: contactIds.length,
    skipped,
  };
}
