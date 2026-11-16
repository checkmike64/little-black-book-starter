"use server";

import { revalidatePath } from "next/cache";
import {
  redirectToFormReturn,
  redirectWithMessage,
} from "@/lib/server-action-redirect";
import { requireTenantActionContext } from "@/lib/server-action-context";
import { confirmMeetingContacts } from "@/lib/recordings/meeting-contacts";
import { normalizeCalendarEmail } from "@/lib/calendar-identity";
import {
  enqueueInitialContactEnrichment,
  reconcileProfileEnrichmentGaps,
} from "@/lib/contact-enrichment-jobs";
import { createContactOnce } from "@/lib/contact-creation";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { ownerWantToKnowPurpose } from "@/lib/want-to-know-purposes";

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function dashboard(message: string): never {
  redirectWithMessage("/dashboard", message);
}

function dueDate(days: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function requestClaudeRefresh() {
  const { admin, context } = await requireTenantActionContext(() =>
    dashboard("The private data connection is unavailable."),
  );

  let result: Awaited<ReturnType<typeof reconcileProfileEnrichmentGaps>>;
  try {
    result = await reconcileProfileEnrichmentGaps({
      admin,
      tenantId: context.tenantId,
      limit: 25,
    });
  } catch {
    dashboard("Claude refresh could not be queued. Try again later.");
  }

  await admin.from("audit_log").insert({
    tenant_id: context.tenantId,
    actor_user_id: context.userId,
    actor_type: "client",
    action: "claude.refresh_requested",
    table_name: "jobs",
    metadata: result,
  });

  revalidatePath("/dashboard");
  revalidatePath("/contacts");
  revalidatePath("/quality");
  revalidatePath("/ops");

  if (result.failed > 0) {
    dashboard(
      result.created > 0
        ? `Claude refresh queued ${result.created} profile${result.created === 1 ? "" : "s"}, but ${result.failed} could not be queued. Use Refresh again. If it repeats, open Support.`
        : `Claude refresh could not queue ${result.failed} profile${result.failed === 1 ? "" : "s"}. Use Refresh again. If it repeats, open Support.`,
    );
  }
  if (result.created > 0) {
    dashboard(
      `Claude refresh requested. ${result.created} incomplete profile${result.created === 1 ? "" : "s"} queued.`,
    );
  }
  if (result.existing > 0) {
    dashboard("Claude refresh is already queued for the profiles reviewed.");
  }
  if (result.incomplete > 0) {
    dashboard("Claude refresh checked the Book. No duplicate work was added.");
  }
  dashboard("Claude refresh checked the Book. No incomplete public profiles were found.");
}

export async function scheduleTodayContact(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    dashboard("The private data connection is unavailable."),
  );
  const contactId = String(formData.get("contact_id") ?? "");
  const requestedDays = Number(String(formData.get("days") ?? "21"));
  const days = [7, 21, 42].includes(requestedDays) ? requestedDays : 21;

  if (!isValidUuid(contactId)) dashboard("That contact could not be scheduled.");

  const { data: contact } = await admin
    .from("contacts")
    .select("id, full_name")
    .eq("tenant_id", context.tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .maybeSingle();
  if (!contact) dashboard("That contact is not available in this Book.");

  const dueOn = dueDate(days);
  const { data: existing } = await admin
    .from("relationship_actions")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("contact_id", contactId)
    .eq("source", "today_schedule")
    .in("status", ["open", "deferred"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const payload = {
    title: `Follow up with ${contact.full_name}`,
    action_type: "follow_up",
    status: "deferred",
    priority: "normal",
    due_on: dueOn,
    source: "today_schedule",
    metadata: {
      scheduled_from: "today",
      scheduled_by: context.userId,
    },
  };
  const result = existing
    ? await admin
        .from("relationship_actions")
        .update(payload)
        .eq("tenant_id", context.tenantId)
        .eq("id", existing.id)
    : await admin.from("relationship_actions").insert({
        ...payload,
        tenant_id: context.tenantId,
        contact_id: contactId,
        created_by: context.userId,
      });

  if (result.error) dashboard("That follow-up could not be scheduled.");

  await admin.from("audit_log").insert({
    tenant_id: context.tenantId,
    actor_user_id: context.userId,
    actor_type: "client",
    action: "today.contact_scheduled",
    table_name: "relationship_actions",
    record_id: existing?.id ?? null,
    metadata: { contact_id: contactId, due_on: dueOn },
  });

  revalidatePath("/dashboard");
  revalidatePath("/movement");
  dashboard(`Scheduled for ${days === 7 ? "one week" : `${days / 7} weeks`} from now.`);
}

export async function completeTodayFollowUp(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    dashboard("The private data connection is unavailable."),
  );
  const actionId = String(formData.get("action_id") ?? "");

  if (!isValidUuid(actionId)) dashboard("That follow-up could not be completed.");

  const completedAt = new Date().toISOString();
  const { data: followUp, error } = await admin
    .from("relationship_actions")
    .update({
      status: "done",
      completed_at: completedAt,
    })
    .eq("tenant_id", context.tenantId)
    .eq("id", actionId)
    .eq("source", "today_schedule")
    .in("status", ["open", "deferred"])
    .select("id, contact_id, title")
    .maybeSingle();

  if (error || !followUp) dashboard("That follow-up is no longer available.");

  await admin.from("audit_log").insert({
    tenant_id: context.tenantId,
    actor_user_id: context.userId,
    actor_type: "client",
    action: "today.follow_up_completed",
    table_name: "relationship_actions",
    record_id: followUp.id,
    metadata: {
      contact_id: followUp.contact_id,
      title: followUp.title,
      completed_at: completedAt,
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/movement");
  dashboard("Follow-up completed.");
}

async function attendeeContext(
  attendeeId: string,
  tenantId: string,
  userId: string,
  admin: Awaited<ReturnType<typeof requireTenantActionContext>>["admin"],
) {
  const { data } = await admin
    .from("calendar_attendees")
    .select("id, event_id, normalized_email, display_name")
    .eq("id", attendeeId)
    .eq("tenant_id", tenantId)
    .eq("owner_user_id", userId)
    .is("matched_contact_id", null)
    .is("matched_want_to_know_id", null)
    .maybeSingle();
  return data;
}

async function queueCalendarEnrichment({
  admin,
  tenantId,
  userId,
  contactId,
}: {
  admin: Awaited<ReturnType<typeof requireTenantActionContext>>["admin"];
  tenantId: string;
  userId: string;
  contactId: string;
}) {
  return enqueueInitialContactEnrichment({
    admin,
    tenantId,
    userId,
    contactId,
    trigger: "calendar_review",
    source: "calendar_briefing",
  });
}

export async function decideCalendarAttendee(formData: FormData) {
  const respond = (message: string): never =>
    redirectToFormReturn(formData, "/dashboard", message);
  const { admin, context } = await requireTenantActionContext(() =>
    respond("The private data connection is unavailable."),
  );
  const attendeeId = String(formData.get("attendee_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!isValidUuid(attendeeId) || !["book", "want_to_know", "ignore"].includes(decision)) {
    respond("That meeting choice is not valid.");
  }

  const attendee = await attendeeContext(
    attendeeId,
    context.tenantId,
    context.userId,
    admin,
  );
  if (!attendee) return respond("That attendee has already been handled.");

  const email = normalizeCalendarEmail(attendee.normalized_email);
  if (!email) return respond("That attendee does not have a usable email address.");
  const fullName =
    attendee.display_name?.trim().slice(0, 300) ||
    email
      .split("@")[0]
      .split(/[._-]/)
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" ");
  const purpose = decision === "want_to_know"
    ? ownerWantToKnowPurpose(
        formData.get("purpose"),
        normalizeTenantSettings(context.settings).prospecting.buckets,
      )
    : null;
  if (decision === "want_to_know" && !purpose) {
    return respond("Choose why you want to know this person.");
  }

  let contactId: string | null = null;
  let wantToKnowId: string | null = null;
  let enrichmentJobId: string | null = null;
  let enrichmentQueueFailed = false;
  let createdNewContact = false;

  if (decision === "book") {
    const { data: contactMatches, error: contactMatchError } = await admin
      .from("contacts")
      .select("id, email, full_name")
      .eq("tenant_id", context.tenantId)
      .is("archived_at", null);
    if (contactMatchError) respond("The Book could not be checked for duplicates.");
    const emailMatches = (contactMatches ?? []).filter(
      (contact) => normalizeCalendarEmail(contact.email) === email,
    );
    if (emailMatches.length > 1) {
      respond("More than one Book contact uses this email. Resolve that first.");
    }
    const existing = emailMatches[0] ?? null;

    if (existing) {
      contactId = existing.id;
    } else {
      const exactNameMatches = (contactMatches ?? []).filter(
        (contact) =>
          contact.full_name?.trim().toLocaleLowerCase() ===
          fullName.toLocaleLowerCase(),
      );
      const nameMatch =
        exactNameMatches?.length === 1 && !exactNameMatches[0].email
          ? exactNameMatches[0]
          : null;

      if (nameMatch) {
        const { error } = await admin
          .from("contacts")
          .update({ email })
          .eq("tenant_id", context.tenantId)
          .eq("id", nameMatch.id);
        if (error) {
          respond("That meeting email could not be linked to the contact.");
        }
        contactId = nameMatch.id;
        await admin.from("field_provenance").insert({
          tenant_id: context.tenantId,
          table_name: "contacts",
          record_id: nameMatch.id,
          field_name: "email",
          source_type: "manual",
          source_ref: "calendar_review",
          summary: "Linked an exact-name meeting attendee after the owner chose Add to Book.",
          confidence: 1,
          metadata: {
            actor_user_id: context.userId,
            attendee_id: attendeeId,
          },
        });
      }

      if (!contactId) {
        const { result: creation, error } = await createContactOnce({
          admin,
          tenantId: context.tenantId,
          actorUserId: context.userId,
          requestKey: `calendar-attendee:${attendeeId}:book`,
          fields: { full_name: fullName, email },
          source: "calendar_briefing",
          extra: { calendar_review: { attendee_id: attendeeId } },
        });
        if (error || !creation) {
          return respond("That person could not be added to the Book.");
        }
        contactId = creation.contactId;
        createdNewContact = creation.created;
        const enrichment = await queueCalendarEnrichment({
          admin,
          tenantId: context.tenantId,
          userId: context.userId,
          contactId: creation.contactId,
        });
        enrichmentJobId = enrichment?.id ?? null;
        enrichmentQueueFailed = !enrichment;
      }
    }
  }

  if (decision === "want_to_know") {
    const { data: prospectMatches, error: prospectMatchError } = await admin
      .from("want_to_know")
      .select("id, email")
      .eq("tenant_id", context.tenantId)
      .neq("stage", "graduated");
    if (prospectMatchError) {
      respond("Want to Know could not be checked for duplicates.");
    }
    const emailMatches = (prospectMatches ?? []).filter(
      (prospect) => normalizeCalendarEmail(prospect.email) === email,
    );
    if (emailMatches.length > 1) {
      respond("More than one prospect uses this email. Resolve that first.");
    }
    const existing = emailMatches[0] ?? null;

    if (existing) {
      wantToKnowId = existing.id;
    } else {
      const { data: prospect, error } = await admin
        .from("want_to_know")
        .insert({
          tenant_id: context.tenantId,
          full_name: fullName,
          email,
          bucket: purpose?.label ?? null,
          lane: purpose?.lane ?? null,
          stage: "watching",
          source: "calendar_briefing",
          why: `Owner added after a meeting for ${purpose?.label ?? "deliberate follow-up"}.`,
          owner_selected_at: new Date().toISOString(),
          owner_selected_by: context.userId,
          relationship_priority: "standard",
          engagement_target_per_month: 4,
        })
        .select("id")
        .single();
      if (error || !prospect) return respond("That person could not be added to Want to Know.");
      wantToKnowId = prospect.id;
    }
  }

  const preference = await admin
    .from("calendar_attendee_preferences")
    .upsert(
      {
        tenant_id: context.tenantId,
        user_id: context.userId,
        normalized_email: email,
        decision,
        contact_id: contactId,
        want_to_know_id: wantToKnowId,
        decided_at: new Date().toISOString(),
        metadata: { attendee_id: attendeeId },
      },
      { onConflict: "tenant_id,user_id,normalized_email" },
    );
  if (preference.error) respond("That meeting preference could not be saved.");

  let lateMeetingRepairFailed = false;
  if (contactId || wantToKnowId) {
    const attendeeUpdate = await admin
      .from("calendar_attendees")
      .update({
        matched_contact_id: contactId,
        matched_want_to_know_id: wantToKnowId,
      })
      .eq("tenant_id", context.tenantId)
      .eq("owner_user_id", context.userId)
      .eq("normalized_email", email)
      .select("event_id");
    if (attendeeUpdate.error) respond("That meeting attendee link could not be saved.");

    if (contactId) {
      const eventIds = Array.from(new Set(
        (attendeeUpdate.data ?? []).map((row) => String(row.event_id ?? "")).filter(Boolean),
      ));
      const readyMeetings = eventIds.length > 0
        ? await admin
            .from("transcripts")
            .select("id,updated_at,metadata")
            .eq("tenant_id", context.tenantId)
            .eq("owner_user_id", context.userId)
            .eq("processing_status", "ready")
            .in("metadata->>calendar_match_event_id", eventIds)
        : { data: [], error: null };
      if (readyMeetings.error) {
        lateMeetingRepairFailed = true;
      } else {
        for (const meeting of readyMeetings.data ?? []) {
          const metadata = meeting.metadata && typeof meeting.metadata === "object"
            && !Array.isArray(meeting.metadata)
            ? meeting.metadata as Record<string, unknown>
            : {};
          const confirmed = Array.isArray(metadata.confirmed_contact_ids)
            ? metadata.confirmed_contact_ids.map(String)
            : [];
          try {
            const candidateIds = Array.from(new Set([...confirmed, contactId]));
            const activeContacts = await admin
              .from("contacts")
              .select("id")
              .eq("tenant_id", context.tenantId)
              .is("archived_at", null)
              .in("id", candidateIds);
            if (activeContacts.error) throw activeContacts.error;
            const contactIds = (activeContacts.data ?? []).map((row) => row.id);
            if (metadata.evidence_grade === "operator_reviewed") {
              const { data: repaired, error: repairError } = await admin.rpc(
                "lbb_owner_repair_operator_meeting_contacts",
                {
                  p_tenant_id: context.tenantId,
                  p_transcript_id: meeting.id,
                  p_actor_user_id: context.userId,
                  p_contact_ids: contactIds,
                  p_expected_transcript_updated_at: meeting.updated_at,
                },
              );
              if (repairError || !repaired) throw repairError ?? new Error("Meeting repair failed.");
            } else {
              await confirmMeetingContacts({
                admin,
                tenantId: context.tenantId,
                transcriptId: meeting.id,
                actorUserId: context.userId,
                contactIds,
                expectedTranscriptUpdatedAt: meeting.updated_at,
              });
            }
          } catch {
            lateMeetingRepairFailed = true;
          }
        }
      }
    }
  }

  await admin.from("audit_log").insert({
    tenant_id: context.tenantId,
    actor_user_id: context.userId,
    actor_type: "client",
    action: `calendar.attendee_${decision}`,
    table_name: "calendar_attendee_preferences",
    metadata: {
      attendee_id: attendeeId,
      normalized_email: email,
      contact_id: contactId,
      want_to_know_id: wantToKnowId,
      late_meeting_repair_failed: lateMeetingRepairFailed,
      enrichment_job_id: enrichmentJobId,
      enrichment_queue_failed: enrichmentQueueFailed,
      created_new_contact: createdNewContact,
      want_to_know_purpose: purpose?.label ?? null,
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/recordings");
  revalidatePath("/contacts");
  revalidatePath("/want-to-know");
  respond(
    decision === "ignore"
      ? "Got it. This person will not be suggested again."
      : decision === "book"
        ? !createdNewContact
          ? "Linked to the existing person in the Book."
          : enrichmentQueueFailed
          ? "Added to the Book, but enrichment could not be queued. The daily repair will retry it."
          : lateMeetingRepairFailed
          ? "Added to the Book. A processed meeting link needs operator attention."
          : "Added to the Book. Enrichment is queued."
        : "Added to Want to Know.",
  );
}
