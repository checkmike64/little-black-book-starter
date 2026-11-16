"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  contactEnrichmentIntentKey,
  enqueueContactEnrichmentJob,
  enqueueInitialContactEnrichment,
} from "@/lib/contact-enrichment-jobs";
import { createContactOnce } from "@/lib/contact-creation";
import { syncContactContentScanSources } from "@/lib/automation/content-scans";
import { requireOperatorAccess } from "@/lib/operator-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/tenant-context";

const textFields = [
  "full_name",
  "email",
  "phone",
  "company_name",
  "company_description",
  "one_line_summary",
  "trust_level",
  "touch_cadence",
  "relationship_strength",
  "how_we_met",
  "why_stay_in_touch",
  "linkedin",
  "website",
  "current_asks",
  "wants_help_with",
  "what_they_want_more_of",
  "ideal_referral",
  "do_not_refer_for",
  "referral_intro_blurb",
  "podcast_fit",
  "recent_activity",
  "personal_notes",
  "private_notes",
] as const;

const arrayFields = [
  "role_title",
  "relationship_type",
  "location",
  "services_offered",
  "could_refer_me_for",
  "primary_category",
  "top_3_tags",
  "keywords",
] as const;

const dateFields = ["last_spoke", "met_date"] as const;

type TextField = (typeof textFields)[number];
type ArrayField = (typeof arrayFields)[number];
type DateField = (typeof dateFields)[number];
type ContactUpdate = Partial<
  Record<TextField, string | null> &
    Record<ArrayField, string[] | null> &
    Record<DateField, string | null>
> & {
  relationship_strength_override?: boolean;
  relationship_strength_reason?: string | null;
};
function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function cleanText(formData: FormData, key: string, maxLength = 3000) {
  const value = String(formData.get(key) ?? "").trim().replace(/\s+/g, " ");
  return value ? value.slice(0, maxLength) : null;
}

function cleanLongText(formData: FormData, key: string, maxLength = 8000) {
  const value = String(formData.get(key) ?? "").trim();
  return value ? value.slice(0, maxLength) : null;
}

function cleanArray(formData: FormData, key: string) {
  const raw = String(formData.get(key) ?? "");
  const values = raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);

  return values.length > 0 ? Array.from(new Set(values)) : null;
}

function cleanDate(formData: FormData, key: string) {
  const value = cleanText(formData, key, 10);
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function contactRedirect(path: string, message: string): never {
  redirect(`${path}?message=${encodeURIComponent(message)}`);
}

function requireDuplicateReview(formData: FormData, fallback: string) {
  if (formData.get("duplicate_reviewed") !== "on") {
    contactRedirect(fallback, "Review possible duplicates before saving.");
  }
}

function collectCreateFields(formData: FormData) {
  const fields: ContactUpdate = {};

  for (const field of textFields) {
    const value =
      field === "private_notes" ||
      field === "personal_notes" ||
      field === "recent_activity" ||
      field === "company_description" ||
      field === "one_line_summary" ||
      field === "why_stay_in_touch" ||
      field === "current_asks" ||
      field === "wants_help_with" ||
      field === "ideal_referral" ||
      field === "podcast_fit"
        ? cleanLongText(formData, field)
        : cleanText(formData, field);
    fields[field] = value;
  }

  for (const field of arrayFields) {
    fields[field] = cleanArray(formData, field);
  }

  for (const field of dateFields) {
    fields[field] = cleanDate(formData, field);
  }

  const strengthReason = cleanLongText(formData, "relationship_strength_reason");
  if (strengthReason) fields.relationship_strength_reason = strengthReason;
  if (fields.relationship_strength) {
    fields.relationship_strength_override = true;
  }

  return fields;
}

function collectEnrichmentFields(formData: FormData) {
  const fields = collectCreateFields(formData);
  const update: ContactUpdate = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && value !== undefined) {
      update[key as keyof ContactUpdate] = value as never;
    }
  }

  return update;
}

function provenanceRows({
  tenantId,
  contactId,
  fields,
  sourceNotes,
  action,
}: {
  tenantId: string;
  contactId: string;
  fields: ContactUpdate;
  sourceNotes: string | null;
  action: string;
}) {
  return Object.entries(fields)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([fieldName, value]) => ({
      tenant_id: tenantId,
      table_name: "contacts",
      record_id: contactId,
      field_name: fieldName,
      source_type: "manual",
      source_ref: "person_intake",
      summary: sourceNotes ?? `Saved from ${action}.`,
      metadata: {
        action,
        value_type: Array.isArray(value) ? "array" : typeof value,
      },
    }));
}

async function queueContactEnrichment({
  admin,
  tenantId,
  userId,
  contactId,
  trigger,
  sourceNotes,
  fields,
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  tenantId: string;
  userId: string;
  contactId: string;
  trigger: "manual_add" | "manual_enrichment";
  sourceNotes: string | null;
  fields: ContactUpdate;
}) {
  const manualFields = Object.entries(fields)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([field]) => field);

  if (trigger === "manual_add") {
    return enqueueInitialContactEnrichment({
      admin,
      tenantId,
      userId,
      contactId,
      trigger,
      source: "manual_intake",
      sourceNotes,
      manualFields,
    });
  }

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
      prefix: "manual-contact-enrichment",
      contactId,
      intent: { fields, sourceNotes },
    }),
    requestedBy: userId,
    payload: {
      trigger,
      source: "manual_intake",
      source_notes: sourceNotes,
      requested_by: userId,
      manual_fields: manualFields,
      required_steps: [
        "review_manual_updates",
        "review_owner_authorized_context",
        "public_profile_discovery",
        "public_profile_verification",
        "pending_change_proposals",
      ],
      known_profile_scan_sources: scanSources.registered,
      research_policy:
        "Use owner-authorized transcript, correspondence, and public profile sources. Propose uncertain fields for owner review.",
    },
  });
}

function revalidateContactSurfaces(contactId: string) {
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/ask");
  revalidatePath("/networking");
  revalidatePath("/dashboard");
  revalidatePath("/ops");
}

export async function createContactFromIntake(formData: FormData) {
  await requireOperatorAccess();

  const context = await getTenantContext();
  const admin = createSupabaseAdminClient();
  const fallback = "/contacts/new";

  if (!context) redirect("/login");
  if (!admin) contactRedirect(fallback, "Supabase admin environment is not configured.");

  requireDuplicateReview(formData, fallback);

  const fields = collectCreateFields(formData);
  if (!fields.full_name || fields.full_name.length < 2) {
    contactRedirect(fallback, "Add the person's full name before saving.");
  }

  const sourceNotes = cleanLongText(formData, "source_notes");
  const requestId = String(formData.get("creation_request_id") ?? "");
  if (!isValidUuid(requestId)) {
    contactRedirect(fallback, "This add-person request expired. Reload and try again.");
  }
  const extra = {
    intake: {
      source_notes: sourceNotes,
      reviewed_duplicates: true,
      saved_by: context.userId,
    },
  };
  const { result: creation, error } = await createContactOnce({
    admin,
    tenantId: context.tenantId,
    actorUserId: context.userId,
    requestKey: `manual-intake:${requestId}`,
    fields,
    source: "manual_intake",
    extra,
  });

  if (error || !creation) {
    contactRedirect(fallback, "The person could not be saved.");
  }

  if (creation.created) {
    await admin.from("field_provenance").insert(
      provenanceRows({
        tenantId: context.tenantId,
        contactId: creation.contactId,
        fields,
        sourceNotes,
        action: "contact.created_from_intake",
      }),
    );
  }

  const enrichmentJobId = await queueContactEnrichment({
    admin,
    tenantId: context.tenantId,
    userId: context.userId,
    contactId: creation.contactId,
    trigger: "manual_add",
    sourceNotes,
    fields,
  });

  if (creation.created) {
    await admin.from("audit_log").insert({
      tenant_id: context.tenantId,
      actor_user_id: context.userId,
      actor_type: "client",
      action: "contact.created_from_intake",
      table_name: "contacts",
      record_id: creation.contactId,
      after: { ...fields, source: "manual_intake", extra },
      metadata: {
        creation_request_id: requestId,
        reviewed_duplicates: true,
        source_notes_present: Boolean(sourceNotes),
        enrichment_job_id: enrichmentJobId?.id ?? null,
        enrichment_queued: Boolean(enrichmentJobId),
        enrichment_job_created: enrichmentJobId?.created ?? false,
      },
    });
  }

  revalidateContactSurfaces(creation.contactId);
  contactRedirect(
    `/contacts/${creation.contactId}`,
    enrichmentJobId?.created
      ? "Person added. Relationship research queued."
      : enrichmentJobId
        ? "Person added. Relationship research was already queued."
        : "Person added, but enrichment could not be queued.",
  );
}

export async function enrichContactFromIntake(formData: FormData) {
  await requireOperatorAccess();

  const context = await getTenantContext();
  const admin = createSupabaseAdminClient();
  const contactId = String(formData.get("contact_id") ?? "");
  const fallback = isValidUuid(contactId) ? `/contacts/new?contact_id=${contactId}` : "/contacts/new";

  if (!context) redirect("/login");
  if (!admin) contactRedirect(fallback, "Supabase admin environment is not configured.");
  if (!isValidUuid(contactId)) contactRedirect("/contacts/new", "Choose a contact to enrich.");

  requireDuplicateReview(formData, fallback);

  const fields = collectEnrichmentFields(formData);
  if (Object.keys(fields).length === 0) {
    contactRedirect(fallback, "Add at least one field before saving enrichment.");
  }

  const { data: before, error: readError } = await admin
    .from("contacts")
    .select(Object.keys(fields).join(", "))
    .eq("tenant_id", context.tenantId)
    .eq("id", contactId)
    .single();

  if (readError || !before) {
    contactRedirect("/contacts/new", "That contact is not available in this book.");
  }

  const sourceNotes = cleanLongText(formData, "source_notes");
  const { error } = await admin
    .from("contacts")
    .update(fields)
    .eq("tenant_id", context.tenantId)
    .eq("id", contactId);

  if (error) {
    contactRedirect(fallback, "The enrichment could not be saved.");
  }

  await admin.from("field_provenance").insert(
    provenanceRows({
      tenantId: context.tenantId,
      contactId,
      fields,
      sourceNotes,
      action: "contact.enriched_from_intake",
    }),
  );

  const enrichmentJobId = await queueContactEnrichment({
    admin,
    tenantId: context.tenantId,
    userId: context.userId,
    contactId,
    trigger: "manual_enrichment",
    sourceNotes,
    fields,
  });

  await admin.from("audit_log").insert({
    tenant_id: context.tenantId,
    actor_user_id: context.userId,
    actor_type: "client",
    action: "contact.enriched_from_intake",
    table_name: "contacts",
    record_id: contactId,
    before,
    after: fields,
    metadata: {
      reviewed_duplicates: true,
      source_notes_present: Boolean(sourceNotes),
      enrichment_job_id: enrichmentJobId?.id ?? null,
      enrichment_queued: Boolean(enrichmentJobId),
      enrichment_job_created: enrichmentJobId?.created ?? false,
    },
  });

  revalidateContactSurfaces(contactId);
  contactRedirect(
    `/contacts/${contactId}`,
    enrichmentJobId?.created
      ? "Manual research saved. Follow-up research queued."
      : enrichmentJobId
        ? "Manual research saved. Follow-up research was already queued."
        : "Manual research saved, but follow-up research could not be queued.",
  );
}
