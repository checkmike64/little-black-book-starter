"use server";

import { redirect } from "next/navigation";
import { buildClientAuditRow } from "@/lib/activity-rows";
import { activityDayWindow } from "@/lib/activity-settings";
import {
  enqueueProfileResearch,
  type ProfileResearchField,
} from "@/lib/contact-enrichment-jobs";
import { buildManualFieldProvenanceRows } from "@/lib/field-provenance";
import { requireOperatorAccess } from "@/lib/operator-access";
import { findDuplicateOpenRelationshipAction } from "@/lib/relationship-action-dedupe";
import {
  isValidUuid,
  parseRelationshipActionCreateForm,
  parseRelationshipActionStatusForm,
  relationshipActionNotesWithStatusNote,
  relationshipActionCompletedAt,
  relationshipActionStatusNeedsNote,
} from "@/lib/relationship-action-validation";
import { redirectToFormReturn } from "@/lib/server-action-redirect";
import { revalidateContactRelationshipSurfaces } from "@/lib/server-action-revalidation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getTenantContext } from "@/lib/tenant-context";
import { normalizeTenantSettings } from "@/lib/tenant-settings";

function redirectToContact(contactId: string, message: string): never {
  redirect(`/contacts/${contactId}?message=${encodeURIComponent(message)}`);
}

function redirectToReturn(formData: FormData, fallback: string, message: string): never {
  redirectToFormReturn(formData, fallback, message);
}

function listFromForm(formData: FormData, key: string) {
  return String(formData.get(key) ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function cleanText(formData: FormData, key: string, maxLength = 500) {
  const value = String(formData.get(key) ?? "").trim().slice(0, maxLength);
  return value || null;
}

function cleanDate(formData: FormData, key: string) {
  const value = cleanText(formData, key, 10);
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function optionalEngagementTarget(formData: FormData) {
  const value = String(formData.get("engagement_target_per_month") ?? "").trim();
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(parsed, 0), 8);
}

const interactionTypes = new Set([
  "meeting",
  "call",
  "email",
  "message",
  "note",
  "manual_touch",
]);

function interactionType(formData: FormData) {
  const value = String(formData.get("interaction_type") ?? "");
  return interactionTypes.has(value) ? value : null;
}

function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  return Object.keys(after).filter((key) => {
    const previous = before[key];
    const next = after[key];
    if (Array.isArray(previous) || Array.isArray(next)) {
      const previousList = Array.isArray(previous) ? previous : [];
      const nextList = Array.isArray(next) ? next : [];
      return (
        previousList.length !== nextList.length ||
        previousList.some((value, index) => value !== nextList[index])
      );
    }
    return previous !== next;
  });
}

export async function requestContactEnrichment(formData: FormData) {
  await requireOperatorAccess();

  const context = await getTenantContext();
  const admin = createSupabaseAdminClient();
  const contactId = String(formData.get("contact_id") ?? "");
  const requestId = String(formData.get("research_request_id") ?? "");
  const supportedFields = new Set<ProfileResearchField>([
    "primary_email",
    "company_name",
    "role_title",
    "one_line_summary",
    "website",
    "linkedin",
    "instagram",
    "facebook",
    "x_twitter",
    "youtube",
  ]);
  const missingFields = listFromForm(formData, "missing_fields").filter(
    (field): field is ProfileResearchField =>
      supportedFields.has(field as ProfileResearchField),
  );
  const returnTo = isValidUuid(contactId) ? `/contacts/${contactId}` : "/contacts";

  if (!context) redirect("/login");
  if (!admin) redirect(`${returnTo}?message=${encodeURIComponent("Supabase admin environment is not configured.")}`);
  if (!isValidUuid(contactId)) redirect("/contacts?message=Choose%20a%20contact%20to%20enrich.");
  if (!isValidUuid(requestId) || missingFields.length === 0) {
    redirectToContact(contactId, "There are no supported profile fields to research.");
  }

  const job = await enqueueProfileResearch({
    admin,
    tenantId: context.tenantId,
    userId: context.userId,
    contactId,
    requiredFields: missingFields,
    requestId,
  });

  if (!job) {
    redirectToContact(contactId, "Relationship research could not be queued.");
  }

  revalidateContactRelationshipSurfaces(contactId, {
    includeEngagement: false,
    includeOps: true,
  });
  if (job.status === "failed") {
    redirectToContact(contactId, "The earlier research request stopped. Reload and try again.");
  }
  redirectToContact(
    contactId,
    job.created
      ? "Profile research queued for this contact."
      : `Profile research is already ${job.status} for this contact.`,
  );
}

export async function updateContactPosture(formData: FormData) {
  const context = await getTenantContext();
  const admin = createSupabaseAdminClient();
  const contactId = String(formData.get("contact_id") ?? "");

  if (!context) redirect("/login");
  if (!isValidUuid(contactId)) redirect("/contacts?message=Choose%20a%20contact%20to%20update.");
  if (!admin) redirectToContact(contactId, "Supabase admin environment is not configured.");

  const { data: before, error: readError } = await admin
    .from("contacts")
    .select(
      "id, tenant_id, trust_level, relationship_strength, relationship_strength_reason, relationship_strength_override, touch_cadence, last_spoke",
    )
    .eq("tenant_id", context.tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();

  if (readError || !before) {
    redirect("/contacts?message=That%20contact%20is%20not%20available%20in%20this%20book.");
  }

  const after = {
    trust_level: cleanText(formData, "trust_level", 120),
    relationship_strength: cleanText(formData, "relationship_strength", 120),
    relationship_strength_reason: cleanText(
      formData,
      "relationship_strength_reason",
      1000,
    ),
    relationship_strength_override: formData.has("relationship_strength_override"),
    touch_cadence: cleanText(formData, "touch_cadence", 120),
    last_spoke: cleanDate(formData, "last_spoke"),
  };
  const fields = changedFields(before as Record<string, unknown>, after);

  if (fields.length === 0) {
    redirectToContact(contactId, "No owner judgment changes were needed.");
  }

  const { error } = await admin
    .from("contacts")
    .update(after)
    .eq("tenant_id", context.tenantId)
    .eq("id", contactId);

  if (error) {
    redirectToContact(contactId, "Owner judgment could not be updated.");
  }

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: context.tenantId,
      actor_user_id: context.userId,
      actor_type: "client",
      action: "contact.owner_posture_updated",
      table_name: "contacts",
      record_id: contactId,
      before,
      after,
      metadata: {
        fields,
        manual_override: after.relationship_strength_override,
      },
    }),
    admin.from("field_provenance").insert(
      buildManualFieldProvenanceRows({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        recordId: contactId,
        fields,
        sourceRef: "owner_posture_control",
        summary: "Updated from the contact profile owner controls.",
      }),
    ),
  ]);

  revalidateContactRelationshipSurfaces(contactId, { includeAsk: true });
  redirectToContact(contactId, "Owner judgment updated.");
}

export async function updateContactProfile(formData: FormData) {
  const editScope = String(formData.get("edit_scope") ?? "owner_facts");
  if (editScope === "operator") {
    await requireOperatorAccess();
  }
  const context = await getTenantContext();
  const admin = createSupabaseAdminClient();
  const contactId = String(formData.get("contact_id") ?? "");

  if (!context) redirect("/login");
  if (!isValidUuid(contactId)) {
    redirect("/contacts?message=Choose%20a%20contact%20to%20update.");
  }
  if (!admin) {
    redirectToReturn(
      formData,
      `/contacts/${contactId}?view=edit`,
      "Supabase admin environment is not configured.",
    );
  }

  const fields = [
    "full_name",
    "email",
    "phone",
    "linkedin",
    "instagram",
    "facebook",
    "x_twitter",
    "youtube",
    "podcast_url",
    "website",
    "company_name",
    "company_description",
    "role_title",
    "one_line_summary",
    "trust_level",
    "relationship_strength",
    "relationship_strength_override",
    "relationship_type",
    "location",
    "touch_cadence",
    "engagement_target_per_month",
    "how_we_met",
    "why_stay_in_touch",
    "current_asks",
    "wants_help_with",
    "what_they_want_more_of",
    "services_offered",
    "ideal_referral",
    "do_not_refer_for",
    "could_refer_me_for",
    "referral_intro_blurb",
    "podcast_fit",
    "primary_category",
    "top_3_tags",
    "keywords",
    "recent_activity",
    "personal_notes",
    "private_notes",
  ] as const;
  const { data: before, error: readError } = await admin
    .from("contacts")
    .select(fields.join(", "))
    .eq("tenant_id", context.tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();

  if (readError || !before) {
    redirect("/contacts?message=That%20contact%20is%20not%20available%20in%20this%20book.");
  }

  const relationshipStrength = cleanText(formData, "relationship_strength", 120);
  const completeProfile = {
    full_name: cleanText(formData, "full_name", 200),
    email: cleanText(formData, "email", 320),
    phone: cleanText(formData, "phone", 80),
    linkedin: cleanText(formData, "linkedin", 500),
    instagram: cleanText(formData, "instagram", 500),
    facebook: cleanText(formData, "facebook", 500),
    x_twitter: cleanText(formData, "x_twitter", 500),
    youtube: cleanText(formData, "youtube", 500),
    podcast_url: cleanText(formData, "podcast_url", 500),
    website: cleanText(formData, "website", 500),
    company_name: cleanText(formData, "company_name", 240),
    company_description: cleanText(formData, "company_description", 1200),
    role_title: listFromForm(formData, "role_title"),
    one_line_summary: cleanText(formData, "one_line_summary", 500),
    trust_level: cleanText(formData, "trust_level", 120),
    relationship_strength: relationshipStrength,
    relationship_strength_override: Boolean(relationshipStrength),
    relationship_type: listFromForm(formData, "relationship_type"),
    location: listFromForm(formData, "location"),
    touch_cadence: cleanText(formData, "touch_cadence", 120),
    engagement_target_per_month: optionalEngagementTarget(formData),
    how_we_met: cleanText(formData, "how_we_met", 1200),
    why_stay_in_touch: cleanText(formData, "why_stay_in_touch", 1200),
    current_asks: cleanText(formData, "current_asks", 1200),
    wants_help_with: cleanText(formData, "wants_help_with", 1200),
    what_they_want_more_of: cleanText(
      formData,
      "what_they_want_more_of",
      1200,
    ),
    services_offered: listFromForm(formData, "services_offered"),
    ideal_referral: cleanText(formData, "ideal_referral", 1200),
    do_not_refer_for: cleanText(formData, "do_not_refer_for", 1200),
    could_refer_me_for: listFromForm(formData, "could_refer_me_for"),
    referral_intro_blurb: cleanText(formData, "referral_intro_blurb", 1200),
    podcast_fit: cleanText(formData, "podcast_fit", 1200),
    primary_category: listFromForm(formData, "primary_category"),
    top_3_tags: listFromForm(formData, "top_3_tags").slice(0, 3),
    keywords: listFromForm(formData, "keywords"),
    recent_activity: cleanText(formData, "recent_activity", 2000),
    personal_notes: cleanText(formData, "personal_notes", 4000),
    private_notes: cleanText(formData, "private_notes", 8000),
  };
  const ownerFactFields = [
    "full_name",
    "email",
    "phone",
    "linkedin",
    "instagram",
    "facebook",
    "x_twitter",
    "youtube",
    "podcast_url",
    "website",
    "company_name",
    "company_description",
    "role_title",
    "one_line_summary",
    "location",
    "personal_notes",
    "private_notes",
  ] as const;
  const after = editScope === "operator"
    ? completeProfile
    : Object.fromEntries(
        ownerFactFields.map((field) => [field, completeProfile[field]]),
      );
  const changed = changedFields(before as unknown as Record<string, unknown>, after);

  if (changed.length === 0) {
    redirectToReturn(formData, `/contacts/${contactId}?view=edit`, "No profile changes were needed.");
  }

  const { error } = await admin
    .from("contacts")
    .update(after)
    .eq("tenant_id", context.tenantId)
    .eq("id", contactId);

  if (error) {
    redirectToReturn(formData, `/contacts/${contactId}?view=edit`, "The profile could not be updated.");
  }

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: context.tenantId,
      actor_user_id: context.userId,
      actor_type: "client",
      action: "contact.profile_updated",
      table_name: "contacts",
      record_id: contactId,
      before,
      after,
      metadata: { fields: changed },
    }),
    admin.from("field_provenance").insert(
      buildManualFieldProvenanceRows({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        recordId: contactId,
        fields: changed,
        sourceRef: "profile_editor",
        summary: "Updated directly from the contact profile.",
      }),
    ),
  ]);

  revalidateContactRelationshipSurfaces(contactId, { includeAsk: true });
  redirectToReturn(formData, `/contacts/${contactId}`, "Profile updated.");
}

export async function logContactActivity(formData: FormData) {
  const context = await getTenantContext();
  const admin = createSupabaseAdminClient();
  const contactId = String(formData.get("contact_id") ?? "");
  const activityDate = cleanDate(formData, "activity_date");
  const occurredAt = activityDate ? `${activityDate}T12:00:00Z` : null;
  const type = interactionType(formData);
  const title = cleanText(formData, "activity_title", 240);
  const summary = cleanText(formData, "activity_summary", 4000);
  const requestId = String(formData.get("activity_request_id") ?? "");

  if (!context) redirect("/login");
  if (!isValidUuid(contactId)) {
    redirect("/contacts?message=Choose%20a%20contact%20to%20update.");
  }
  if (!admin) {
    redirectToReturn(
      formData,
      `/contacts/${contactId}?view=activity`,
      "Supabase admin environment is not configured.",
    );
  }
  if (!activityDate || !occurredAt || !type || !summary || !isValidUuid(requestId)) {
    redirectToReturn(
      formData,
      `/contacts/${contactId}?view=activity`,
      "Add a date, activity type, and a short note, then try again.",
    );
  }
  const ownerToday = activityDayWindow(
    normalizeTenantSettings(context.settings).activity.time_zone,
  ).date;
  if (activityDate > ownerToday) {
    redirectToReturn(
      formData,
      `/contacts/${contactId}?view=activity`,
      "Choose today or an earlier date for a completed touchpoint.",
    );
  }

  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();
  if (contactError || !contact) {
    redirect("/contacts?message=That%20contact%20is%20not%20available%20in%20this%20book.");
  }

  const { data, error } = await admin.rpc("lbb_log_interaction", {
    p_tenant_id: context.tenantId,
    p_idempotency_key: `profile:${contactId}:${requestId}`,
    p_occurred_at: occurredAt,
    p_interaction_type: type,
    p_title: title,
    p_summary: summary,
    p_source: "owner_profile",
    p_source_ref: "contact_activity_form",
    p_metadata: {
      created_from: "contact_profile",
      actor_user_id: context.userId,
    },
    p_contact_ids: [contactId],
    p_update_last_spoke: true,
    p_promises: [],
    p_connection_edges: [],
  });

  if (error || !data) {
    redirectToReturn(
      formData,
      `/contacts/${contactId}?view=activity`,
      "That activity could not be saved.",
    );
  }

  const result = data as {
    id?: string;
    duplicate?: boolean;
    last_spoke_updated?: string[];
  };

  await Promise.all([
    admin.from("audit_log").insert(
      buildClientAuditRow({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: result.duplicate
          ? "interaction.owner_log_duplicate"
          : "interaction.owner_logged",
        tableName: "interactions",
        recordId: result.id,
        after: {
          contact_id: contactId,
          occurred_at: occurredAt,
          interaction_type: type,
          title,
          summary,
          duplicate: Boolean(result.duplicate),
        },
      }),
    ),
    Array.isArray(result.last_spoke_updated) &&
    result.last_spoke_updated.includes(contactId)
      ? admin.from("field_provenance").insert({
          tenant_id: context.tenantId,
          table_name: "contacts",
          record_id: contactId,
          field_name: "last_spoke",
          source_type: "manual",
          source_ref: "contact_activity_form",
          summary: "Updated from a touchpoint logged on the contact profile.",
          confidence: 1,
          metadata: {
            interaction_id: result.id,
            actor_user_id: context.userId,
          },
        })
      : Promise.resolve(),
  ]);

  revalidateContactRelationshipSurfaces(contactId, { includeAsk: true });
  redirectToReturn(
    formData,
    `/contacts/${contactId}?view=activity`,
    result.duplicate ? "That touchpoint was already saved." : "Touchpoint logged.",
  );
}

export async function updateContactCommandFields(formData: FormData) {
  const context = await getTenantContext();
  const admin = createSupabaseAdminClient();
  const contactId = String(formData.get("contact_id") ?? "");

  if (!context) redirect("/login");
  if (!isValidUuid(contactId)) redirect("/contacts?message=Choose%20a%20contact%20to%20update.");
  if (!admin) redirectToReturn(formData, `/contacts/${contactId}`, "Supabase admin environment is not configured.");

  const { data: before, error: readError } = await admin
    .from("contacts")
    .select(
      "id, tenant_id, trust_level, relationship_strength, relationship_strength_reason, relationship_strength_override, touch_cadence, last_spoke, current_asks, wants_help_with, ideal_referral, do_not_refer_for, referral_intro_blurb, podcast_fit, why_stay_in_touch",
    )
    .eq("tenant_id", context.tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();

  if (readError || !before) {
    redirect("/contacts?message=That%20contact%20is%20not%20available%20in%20this%20book.");
  }

  const after = {
    trust_level: cleanText(formData, "trust_level", 120),
    relationship_strength: cleanText(formData, "relationship_strength", 120),
    relationship_strength_reason: cleanText(
      formData,
      "relationship_strength_reason",
      1000,
    ),
    relationship_strength_override: formData.has("relationship_strength_override"),
    touch_cadence: cleanText(formData, "touch_cadence", 120),
    last_spoke: cleanDate(formData, "last_spoke"),
    current_asks: cleanText(formData, "current_asks", 1200),
    wants_help_with: cleanText(formData, "wants_help_with", 1200),
    ideal_referral: cleanText(formData, "ideal_referral", 1200),
    do_not_refer_for: cleanText(formData, "do_not_refer_for", 1200),
    referral_intro_blurb: cleanText(formData, "referral_intro_blurb", 1200),
    podcast_fit: cleanText(formData, "podcast_fit", 1200),
    why_stay_in_touch: cleanText(formData, "why_stay_in_touch", 1200),
  };
  const fields = changedFields(before as Record<string, unknown>, after);

  if (fields.length === 0) {
    redirectToReturn(formData, `/contacts/${contactId}`, "No command-center changes were needed.");
  }

  const { error } = await admin
    .from("contacts")
    .update(after)
    .eq("tenant_id", context.tenantId)
    .eq("id", contactId);

  if (error) {
    redirectToReturn(formData, `/contacts/${contactId}`, "Command-center fields could not be updated.");
  }

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: context.tenantId,
      actor_user_id: context.userId,
      actor_type: "client",
      action: "contact.command_fields_updated",
      table_name: "contacts",
      record_id: contactId,
      before,
      after,
      metadata: {
        fields,
        manual_override: after.relationship_strength_override,
      },
    }),
    admin.from("field_provenance").insert(
      buildManualFieldProvenanceRows({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        recordId: contactId,
        fields,
        sourceRef: "relationship_command_center",
        summary: "Updated from the contact relationship command center.",
      }),
    ),
  ]);

  revalidateContactRelationshipSurfaces(contactId, { includeAsk: true });
  redirectToReturn(formData, `/contacts/${contactId}`, "Command-center fields updated.");
}

export async function createRelationshipAction(formData: FormData) {
  const context = await getTenantContext();
  const admin = createSupabaseAdminClient();
  const input = parseRelationshipActionCreateForm(formData);
  const contactId = input.contactId;

  if (!context) redirect("/login");
  if (!input.contactIdValid) redirect("/contacts?message=Choose%20a%20contact.");
  if (!admin) redirectToContact(contactId, "Supabase admin environment is not configured.");
  if (!input.titleValid) redirectToContact(contactId, "Add a relationship action before saving.");

  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .select("id, full_name")
    .eq("tenant_id", context.tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();

  if (contactError || !contact) {
    redirect("/contacts?message=That%20contact%20is%20not%20available%20in%20this%20book.");
  }

  const { data: existingActions } = await admin
    .from("relationship_actions")
    .select("id, title, action_type, status")
    .eq("tenant_id", context.tenantId)
    .eq("contact_id", contactId)
    .eq("action_type", input.actionType)
    .in("status", ["open", "deferred"])
    .limit(25);
  const duplicateAction = findDuplicateOpenRelationshipAction(
    (existingActions ?? []) as Array<{
      action_type: string;
      id: string;
      status: string;
      title: string;
    }>,
    { actionType: input.actionType, title: input.title },
  );

  if (duplicateAction) {
    revalidateContactRelationshipSurfaces(contactId);
    redirectToContact(contactId, "That relationship action is already tracked.");
  }

  const sourceMetadata = {
    contact_name: contact.full_name,
    created_from: input.source,
    evidence_summary: input.evidenceSummary,
    source_ref: input.sourceRef,
  };

  const { data: action, error } = await admin
    .from("relationship_actions")
    .insert({
      tenant_id: context.tenantId,
      contact_id: contactId,
      title: input.title,
      action_type: input.actionType,
      priority: input.priority,
      due_on: input.dueOn,
      notes: input.notes,
      source: input.source,
      created_by: context.userId,
      metadata: sourceMetadata,
    })
    .select("id")
    .single();

  if (error || !action) {
    redirectToContact(contactId, "Relationship action could not be created.");
  }

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: context.tenantId,
      actor_user_id: context.userId,
      actor_type: "client",
      action: "relationship_action.created",
      table_name: "relationship_actions",
      record_id: action.id,
      after: {
        contact_id: contactId,
        title: input.title,
        action_type: input.actionType,
        priority: input.priority,
        due_on: input.dueOn,
      },
      metadata: {
        evidence_summary: input.evidenceSummary,
        source: input.source,
        source_ref: input.sourceRef,
      },
    }),
    admin.from("usage_events").insert({
      tenant_id: context.tenantId,
      actor_user_id: context.userId,
      actor_type: "client",
      event_type: "relationship_action_created",
      quantity: 1,
      unit: "action",
      metadata: {
        contact_id: contactId,
        action_id: action.id,
        action_type: input.actionType,
        evidence_summary: input.evidenceSummary,
        source: input.source,
        source_ref: input.sourceRef,
      },
    }),
  ]);

  revalidateContactRelationshipSurfaces(contactId);
  redirectToContact(contactId, "Relationship action created.");
}

export async function updateRelationshipActionStatus(formData: FormData) {
  const context = await getTenantContext();
  const admin = createSupabaseAdminClient();
  const input = parseRelationshipActionStatusForm(formData);
  const actionId = input.actionId;
  const contactId = input.contactId;

  if (!context) redirect("/login");
  if (!input.contactIdValid) redirect("/contacts?message=Choose%20a%20contact.");
  if (!input.actionIdValid) redirectToContact(contactId, "Choose a relationship action.");
  if (!admin) redirectToContact(contactId, "Supabase admin environment is not configured.");

  const { data: before, error: readError } = await admin
    .from("relationship_actions")
    .select("id, tenant_id, contact_id, title, status, completed_at, notes")
    .eq("tenant_id", context.tenantId)
    .eq("id", actionId)
    .single();

  if (readError || !before || before.contact_id !== contactId) {
    redirectToContact(contactId, "That relationship action is no longer available.");
  }

  const now = new Date().toISOString();

  if (
    before.status !== input.status &&
    relationshipActionStatusNeedsNote(input.status) &&
    !input.statusNote
  ) {
    redirectToContact(contactId, "Add a short reason before deferring or skipping this move.");
  }

  const after = {
    status: input.status,
    notes: relationshipActionNotesWithStatusNote({
      existingNotes: before.notes,
      nextStatus: input.status,
      now,
      statusNote: input.statusNote,
    }),
    completed_at: relationshipActionCompletedAt({
      previousStatus: before.status,
      nextStatus: input.status,
      previousCompletedAt: before.completed_at,
      now,
    }),
  };

  const { error } = await admin
    .from("relationship_actions")
    .update(after)
    .eq("tenant_id", context.tenantId)
    .eq("id", actionId);

  if (error) {
    redirectToContact(contactId, "Relationship action could not be updated.");
  }

  await admin.from("audit_log").insert({
    tenant_id: context.tenantId,
    actor_user_id: context.userId,
    actor_type: "client",
    action: "relationship_action.status_updated",
    table_name: "relationship_actions",
    record_id: actionId,
    before,
    after,
    metadata: {
      contact_id: contactId,
      status_note: input.statusNote,
    },
  });

  revalidateContactRelationshipSurfaces(contactId);
  redirectToReturn(
    formData,
    `/contacts/${contactId}`,
    `Relationship action marked ${input.status}.`,
  );
}
