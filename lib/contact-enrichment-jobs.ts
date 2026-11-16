import {
  runContentScansForTenant,
  syncContactContentScanSources,
} from "@/lib/automation/content-scans";
import {
  contactEnrichmentIntentKey,
  contactEnrichmentPayloadHash,
  hasProfileArray,
  hasProfileText,
  profileEnrichmentGaps,
  profileGapIdempotencyKey,
  selectProfileGapCandidates,
  type ProfileGapCandidate,
  type ProfileGapContact,
  type ProfileResearchField,
} from "@/lib/contact-enrichment-policy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export {
  contactEnrichmentIntentKey,
  profileEnrichmentGaps,
  profileGapIdempotencyKey,
  profileRefreshWindow,
  selectProfileGapCandidates,
  type ProfileEnrichmentGap,
  type ProfileGapCandidate,
  type ProfileGapContact,
  type ProfileResearchField,
} from "@/lib/contact-enrichment-policy";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export type ActiveEnrichmentJob = {
  id: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type EnrichmentQueueResult = {
  id: string;
  status: string;
  created: boolean;
  reason: "created" | "active" | "idempotent_replay";
};

export async function syncAndStartContactContentDiscovery({
  admin,
  tenantId,
  contactId,
  reason,
}: {
  admin: AdminClient;
  tenantId: string;
  contactId: string;
  reason: "initial_contact" | "approved_profile_source" | "corrected_profile_source";
}) {
  const sources = await syncContactContentScanSources({ admin, tenantId, contactId });
  if (sources.error || sources.registered === 0) {
    return {
      registered: sources.registered,
      started: 0,
      failed: sources.error ? 1 : 0,
      status: sources.error ? "source_sync_failed" : "waiting_for_sources",
    };
  }

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("settings")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantError || !tenant) {
    return {
      registered: sources.registered,
      started: 0,
      failed: 1,
      status: "settings_unavailable",
    };
  }

  try {
    const scan = await runContentScansForTenant({
      admin,
      tenantId,
      rawSettings: tenant.settings,
      force: true,
      priorityContactIds: [contactId],
    });
    await admin.from("audit_log").insert({
      tenant_id: tenantId,
      actor_type: "system",
      action: "contact.initial_content_scan_requested",
      table_name: "contacts",
      record_id: contactId,
      metadata: {
        reason,
        registered_sources: sources.registered,
        started: scan.started,
        failed: scan.failed,
        status: scan.status,
      },
    });
    return { registered: sources.registered, ...scan };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message.slice(0, 500) : "Content scan failed.";
    await admin.from("audit_log").insert({
      tenant_id: tenantId,
      actor_type: "system",
      action: "contact.initial_content_scan_failed",
      table_name: "contacts",
      record_id: contactId,
      metadata: { reason, error: message },
    });
    return {
      registered: sources.registered,
      started: 0,
      failed: 1,
      status: "scan_failed",
    };
  }
}

export async function findActiveContactEnrichmentJob({
  admin,
  tenantId,
  contactId,
}: {
  admin: AdminClient;
  tenantId: string;
  contactId: string;
}) {
  const { data, error } = await admin
    .from("jobs")
    .select("id, status, payload, created_at")
    .eq("tenant_id", tenantId)
    .eq("job_type", "contact_enrichment")
    .in("status", ["queued", "running"])
    .contains("payload", { contact_id: contactId })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as ActiveEnrichmentJob;
}

async function findIdempotentJob({
  admin,
  tenantId,
  idempotencyKey,
}: {
  admin: AdminClient;
  tenantId: string;
  idempotencyKey: string;
}) {
  const { data, error } = await admin
    .from("jobs")
    .select("id, status, payload, payload_hash, created_at")
    .eq("tenant_id", tenantId)
    .eq("job_type", "contact_enrichment")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error || !data) return null;
  return data as ActiveEnrichmentJob & { payload_hash: string | null };
}

export async function enqueueContactEnrichmentJob({
  admin,
  tenantId,
  contactId,
  idempotencyKey,
  payload,
  requestedBy = null,
  actorType = requestedBy ? "client" : "system",
  usageEventType = "contact_enrichment_queued",
  result = {},
}: {
  admin: AdminClient;
  tenantId: string;
  contactId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  requestedBy?: string | null;
  actorType?: "client" | "operator" | "system";
  usageEventType?: string;
  result?: Record<string, unknown>;
}): Promise<EnrichmentQueueResult | null> {
  const active = await findActiveContactEnrichmentJob({
    admin,
    tenantId,
    contactId,
  });
  if (active) {
    return {
      id: active.id,
      status: active.status,
      created: false,
      reason: "active",
    };
  }

  const boundedKey = idempotencyKey.trim().slice(0, 240);
  if (!boundedKey) return null;
  const completePayload: Record<string, unknown> = {
    ...payload,
    contact_id: contactId,
  };
  const hash = contactEnrichmentPayloadHash(completePayload);
  const { data: inserted, error: insertError } = await admin
    .from("jobs")
    .insert({
      tenant_id: tenantId,
      job_type: "contact_enrichment",
      status: "queued",
      payload: completePayload,
      result,
      idempotency_key: boundedKey,
      payload_hash: hash,
    })
    .select("id, status")
    .single();

  if (insertError || !inserted) {
    const existing = await findIdempotentJob({
      admin,
      tenantId,
      idempotencyKey: boundedKey,
    });
    if (!existing || existing.payload_hash !== hash) return null;
    return {
      id: existing.id,
      status: existing.status,
      created: false,
      reason: "idempotent_replay",
    };
  }

  await Promise.all([
    admin.from("usage_events").insert({
      tenant_id: tenantId,
      actor_user_id: requestedBy,
      actor_type: actorType,
      event_type: usageEventType,
      quantity: 1,
      unit: "job",
      metadata: {
        contact_id: contactId,
        job_id: inserted.id,
        idempotency_key: boundedKey,
        trigger: completePayload.trigger ?? null,
      },
    }),
    admin.from("audit_log").insert({
      tenant_id: tenantId,
      actor_user_id: requestedBy,
      actor_type: actorType,
      action: "contact_enrichment.queued",
      table_name: "jobs",
      record_id: inserted.id,
      after: {
        status: "queued",
        job_type: "contact_enrichment",
      },
      metadata: {
        contact_id: contactId,
        idempotency_key: boundedKey,
        trigger: completePayload.trigger ?? null,
        required_fields: completePayload.required_fields ?? [],
      },
    }),
  ]);

  return {
    id: inserted.id as string,
    status: String(inserted.status),
    created: true,
    reason: "created",
  };
}

export async function enqueueInitialContactEnrichment({
  admin,
  tenantId,
  userId,
  contactId,
  trigger,
  source,
  sourceNotes = null,
  pendingChangeId = null,
  manualFields = [],
}: {
  admin: AdminClient;
  tenantId: string;
  userId: string;
  contactId: string;
  trigger: "calendar_review" | "manual_add" | "approved_new_contact";
  source: string;
  sourceNotes?: string | null;
  pendingChangeId?: string | null;
  manualFields?: string[];
}) {
  const { data: contact, error } = await admin
    .from("contacts")
    .select(
      "id, full_name, email, company_name, role_title, one_line_summary, website, linkedin, instagram, facebook, x_twitter, youtube, podcast_url",
    )
    .eq("tenant_id", tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .maybeSingle();
  if (error || !contact) return null;

  const gaps = profileEnrichmentGaps(contact as ProfileGapContact);
  const requiredFields = [...new Set([
    ...gaps,
    "website",
    "social_profiles",
    "podcast_presence",
  ])];
  const contentScan = await syncAndStartContactContentDiscovery({
    admin,
    tenantId,
    contactId,
    reason: "initial_contact",
  });
  return enqueueContactEnrichmentJob({
    admin,
    tenantId,
    contactId,
    idempotencyKey: `initial-contact-enrichment:${contactId}`,
    requestedBy: userId,
    payload: {
      trigger,
      source,
      source_notes: sourceNotes,
      pending_change_id: pendingChangeId,
      requested_by: userId,
      manual_fields: manualFields,
      required_fields: requiredFields,
      initial_discovery: true,
      discovery_scope: [
        "website",
        "social_profiles",
        "recent_posts",
        "podcast_presence",
      ],
      required_steps: [
        "dedupe_check",
        "meeting_transcript_context",
        "correspondence_context",
        "public_profile_discovery",
        "public_profile_verification",
        "field_by_field_gap_disposition",
        "content_scan_source_sync",
        "user_verification",
        "pending_change_proposals",
      ],
      known_profile_scan_sources: contentScan.registered,
      initial_content_scan: {
        started: contentScan.started,
        failed: contentScan.failed,
        status: contentScan.status,
      },
      research_policy:
        "Use owner-authorized transcript, correspondence, and public web/profile sources. Required fields must each be proposed, verified as current, or closed with the sources checked and a reason.",
      verification: {
        required: true,
        owner_conversation: "claude",
        rule:
          "Public identity facts may be proposed from verified sources. Relationship judgments still require owner verification.",
      },
    },
  });
}

export async function enqueueProfileResearch({
  admin,
  tenantId,
  userId,
  contactId,
  requiredFields,
  requestId,
}: {
  admin: AdminClient;
  tenantId: string;
  userId: string;
  contactId: string;
  requiredFields: ProfileResearchField[];
  requestId: string;
}) {
  const requested = Array.from(new Set(requiredFields));
  if (requested.length === 0) return null;
  const { data: contact, error } = await admin
    .from("contacts")
    .select(
      "id, email, company_name, role_title, one_line_summary, website, linkedin, instagram, facebook, x_twitter, youtube",
    )
    .eq("tenant_id", tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .maybeSingle();
  if (error || !contact) return null;

  const missing = requested.filter((field) => {
    if (field === "primary_email") return !hasProfileText(contact.email);
    if (field === "role_title") return !hasProfileArray(contact.role_title);
    return !hasProfileText(contact[field]);
  });
  if (missing.length === 0) return null;

  const scanSources = await syncContactContentScanSources({
    admin,
    tenantId,
    contactId,
  });
  return enqueueContactEnrichmentJob({
    admin,
    tenantId,
    contactId,
    idempotencyKey: contactEnrichmentIntentKey({
      prefix: `profile-research:${requestId}`,
      contactId,
      intent: missing,
    }),
    requestedBy: userId,
    payload: {
      trigger: "owner_requested_profile_search",
      source: "contact_profile",
      requested_by: userId,
      required_fields: missing,
      required_steps: [
        "review_current_profile",
        "search_public_identity_sources",
        "verify_profile_ownership",
        "field_by_field_gap_disposition",
        "pending_change_proposals",
      ],
      known_profile_scan_sources: scanSources.registered,
      research_policy:
        "Find only the requested primary email and public profile facts. Never propose alternate or extra emails. Every requested field needs a source-backed disposition.",
    },
  });
}

export async function reconcileProfileEnrichmentGaps({
  admin,
  tenantId,
  limit = 5,
}: {
  admin: AdminClient;
  tenantId: string;
  limit?: number;
}) {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 25));
  const { data: contacts, error } = await admin
    .from("contacts")
    .select(
      "id, full_name, email, company_name, role_title, one_line_summary, website, linkedin, instagram, facebook, x_twitter, youtube, created_at",
    )
    .eq("tenant_id", tenantId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error("Profile gaps could not be reviewed.");

  const candidates: ProfileGapCandidate[] = (contacts ?? [])
    .map((contact) => ({
      contact: contact as ProfileGapContact,
      gaps: profileEnrichmentGaps(contact as ProfileGapContact),
    }))
    .filter((candidate) => candidate.gaps.length > 0);

  const cooldownStart = new Date(Date.now() - (30 * 86_400_000)).toISOString();
  const [recentJobs, activeJobs, recentChanges] = await Promise.all([
    admin
      .from("jobs")
      .select("id, payload, created_at")
      .eq("tenant_id", tenantId)
      .eq("job_type", "contact_enrichment")
      .gte("created_at", cooldownStart)
      .limit(1000),
    admin
      .from("jobs")
      .select("id, status, payload")
      .eq("tenant_id", tenantId)
      .eq("job_type", "contact_enrichment")
      .in("status", ["queued", "running"])
      .limit(1000),
    admin
      .from("pending_changes")
      .select("id, contact_id, created_at")
      .eq("tenant_id", tenantId)
      .eq("change_type", "contact_enrichment")
      .gte("created_at", cooldownStart)
      .not("contact_id", "is", null)
      .limit(1000),
  ]);
  if (recentJobs.error || activeJobs.error || recentChanges.error) {
    throw new Error("Recent enrichment work could not be reviewed.");
  }
  const contactIdFromJob = (job: { payload: Record<string, unknown> }) =>
    typeof job.payload.contact_id === "string" ? job.payload.contact_id : null;
  const recentJobContactIds = new Set(
    ((recentJobs.data ?? []) as Array<{ payload: Record<string, unknown> }>)
      .map(contactIdFromJob)
      .filter((id): id is string => Boolean(id)),
  );
  const activeContactIds = new Set(
    ((activeJobs.data ?? []) as Array<{ payload: Record<string, unknown> }>)
      .map(contactIdFromJob)
      .filter((id): id is string => Boolean(id)),
  );
  const recentlyProposedContactIds = new Set(
    ((recentChanges.data ?? []) as Array<{ contact_id: string | null }>)
      .map((change) => change.contact_id)
      .filter((id): id is string => Boolean(id)),
  );

  let created = 0;
  let existing = 0;
  let failed = 0;
  // The contact query is already capped at 1,000. Walk the full bounded result
  // so a run of recent/active contacts cannot permanently starve older gaps.
  const scanLimit = candidates.length;
  const selected = selectProfileGapCandidates({
    candidates,
    skippedContactIds: new Set([
      ...recentJobContactIds,
      ...activeContactIds,
      ...recentlyProposedContactIds,
    ]),
    limit: boundedLimit,
    scanLimit,
  });
  existing += selected.skipped;

  for (const candidate of selected.selected) {
    const idempotencyKey = profileGapIdempotencyKey({
      contactId: candidate.contact.id,
      gaps: candidate.gaps,
    });
    const scanSources = await syncContactContentScanSources({
      admin,
      tenantId,
      contactId: candidate.contact.id,
    });
    const result = await enqueueContactEnrichmentJob({
      admin,
      tenantId,
      contactId: candidate.contact.id,
      idempotencyKey,
      payload: {
        trigger: "profile_gap_refresh",
        source: "book_profile_gap_reconciliation",
        required_fields: candidate.gaps,
        required_steps: [
          "inspect_current_profile",
          "review_owner_authorized_context",
          "search_public_identity_sources",
          "verify_public_profile_matches",
          "field_by_field_gap_disposition",
          "pending_change_proposals",
        ],
        known_profile_scan_sources: scanSources.registered,
        quality_focus: {
          missing: candidate.gaps,
          owner_verification_required: false,
          next_step:
            "Research the missing public identity fields and propose source-backed updates.",
        },
        research_policy:
          "Do not return no_change_needed unless every required field has a source-backed disposition.",
      },
      actorType: "system",
      usageEventType: "profile_gap_enrichment_queued",
      result: {
        created_from: "profile_gap_reconciliation",
      },
    });
    if (!result) failed += 1;
    else if (result.created) {
      created += 1;
      activeContactIds.add(candidate.contact.id);
      recentJobContactIds.add(candidate.contact.id);
    } else existing += 1;
  }

  return {
    created,
    existing,
    failed,
    considered: selected.considered,
    incomplete: candidates.length,
    limit: boundedLimit,
  };
}
