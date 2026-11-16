"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildClientAuditRow, buildClientUsageEvent } from "@/lib/activity-rows";
import { findDuplicateOpenRelationshipAction } from "@/lib/relationship-action-dedupe";
import {
  parseRelationshipActionCreateForm,
  parseRelationshipActionMovementUpdateForm,
  relationshipActionNotesWithStatusNote,
  relationshipActionCompletedAt,
  relationshipActionStatusNeedsNote,
} from "@/lib/relationship-action-validation";
import { parseRelationshipCommandJobForm } from "@/lib/relationship-command";
import { requireOperatorAccess } from "@/lib/operator-access";
import { requireTenantActionContext } from "@/lib/server-action-context";
import { revalidateRelationshipWorkspace } from "@/lib/server-action-revalidation";
import { redirectToFormReturn, safeFormReturnPath } from "@/lib/server-action-redirect";

const introActions = new Set(["advance_intro", "follow_up_intro", "close_intro"]);

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function cleanText(formData: FormData, key: string, maxLength = 1000) {
  const value = String(formData.get(key) ?? "").trim().slice(0, maxLength);
  return value || null;
}

function returnTo(formData: FormData, message: string, fallback = "/movement"): never {
  redirectToFormReturn(formData, fallback, message);
}

function dateInDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function revalidateMovementPaths(contactIds: Array<string | null | undefined> = []) {
  revalidatePath("/movement");
  revalidateRelationshipWorkspace(contactIds);
}

export async function logMovementTouch(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnTo(formData, "Supabase admin environment is not configured."),
  );
  const contactId = String(formData.get("contact_id") ?? "");
  const actionKind = cleanText(formData, "action_kind", 80) ?? "log_touch";
  const summary =
    cleanText(formData, "summary", 1000) ??
    "Light relationship touch logged from the movement queue.";
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  if (!isValidUuid(contactId)) {
    returnTo(formData, "Choose a valid contact before logging a touch.");
  }

  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .select("id, full_name, tenant_id")
    .eq("tenant_id", context.tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();

  if (contactError || !contact) {
    returnTo(formData, "That contact is no longer available in this book.");
  }

  const idempotencyKey = `movement-touch-${contactId}-${today}`;
  const { data, error } = await admin.rpc("lbb_log_interaction", {
    p_tenant_id: context.tenantId,
    p_idempotency_key: idempotencyKey,
    p_occurred_at: now,
    p_interaction_type: "manual_touch",
    p_title: `Movement touch: ${contact.full_name ?? "Contact"}`,
    p_summary: summary,
    p_source: "movement_queue",
    p_source_ref: `movement:${actionKind}:${contactId}`,
    p_metadata: {
      action_kind: actionKind,
      actor_user_id: context.userId,
      actor_type: "client",
      ui_surface: safeFormReturnPath(formData, "/dashboard"),
    },
    p_contact_ids: [contactId],
    p_update_last_spoke: true,
    p_promises: [],
    p_connection_edges: [],
  });

  if (error || !data) {
    returnTo(formData, "The relationship touch could not be logged.");
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
        action: result.duplicate ? "movement.touch_duplicate" : "movement.touch_logged",
        tableName: "interactions",
        recordId: result.id,
        after: {
          contact_id: contactId,
          summary,
          action_kind: actionKind,
          duplicate: Boolean(result.duplicate),
        },
      }),
    ),
    Array.isArray(result.last_spoke_updated) && result.last_spoke_updated.includes(contactId)
      ? admin.from("field_provenance").insert({
          tenant_id: context.tenantId,
          table_name: "contacts",
          record_id: contactId,
          field_name: "last_spoke",
          source_type: "manual",
          source_ref: "movement_queue",
          summary: "Updated from a relationship touch logged in the movement queue.",
          confidence: 1,
          metadata: {
            interaction_id: result.id,
            actor_user_id: context.userId,
          },
        })
      : Promise.resolve(),
  ]);

  revalidateMovementPaths([contactId]);
  returnTo(
    formData,
    result.duplicate ? "That touch was already logged today." : "Relationship touch logged.",
  );
}

export async function quickAdvanceIntroduction(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnTo(formData, "Supabase admin environment is not configured.", "/networking"),
  );
  const introId = String(formData.get("introduction_id") ?? "");
  const actionKind = cleanText(formData, "movement_action", 80) ?? "";
  const note = cleanText(formData, "outcome", 1000);

  if (!isValidUuid(introId) || !introActions.has(actionKind)) {
    returnTo(formData, "That introduction action is not valid.", "/networking");
  }

  const { data: before, error: readError } = await admin
    .from("introductions")
    .select("id, tenant_id, person_a, person_b, status, outcome, follow_up_on, date_made")
    .eq("tenant_id", context.tenantId)
    .eq("id", introId)
    .single();

  if (readError || !before) {
    returnTo(formData, "That introduction is no longer available.", "/networking");
  }

  const today = new Date().toISOString().slice(0, 10);
  const update =
    actionKind === "advance_intro"
      ? {
          status: "made",
          date_made: before.date_made ?? today,
          follow_up_on: dateInDays(7),
          outcome: note ?? before.outcome,
          updated_at: new Date().toISOString(),
        }
      : actionKind === "follow_up_intro"
        ? {
            status: "follow_up",
            date_made: before.date_made,
            follow_up_on: dateInDays(14),
            outcome: note ?? before.outcome,
            updated_at: new Date().toISOString(),
          }
        : {
            status: "closed",
            date_made: before.date_made,
            follow_up_on: null,
            outcome: note ?? before.outcome ?? "Closed from the movement queue.",
            updated_at: new Date().toISOString(),
          };

  const { error } = await admin
    .from("introductions")
    .update(update)
    .eq("tenant_id", context.tenantId)
    .eq("id", introId);

  if (error) {
    returnTo(formData, "The introduction could not be updated.", "/networking");
  }

  await admin.from("audit_log").insert(
    buildClientAuditRow({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "movement.introduction_advanced",
      tableName: "introductions",
      recordId: introId,
      before,
      after: {
        ...update,
        movement_action: actionKind,
      },
    }),
  );

  revalidateMovementPaths([before.person_a, before.person_b]);
  returnTo(formData, "Introduction updated.", "/networking");
}

export async function updateMovementRelationshipAction(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnTo(formData, "Supabase admin environment is not configured."),
  );
  const input = parseRelationshipActionMovementUpdateForm(formData);

  if (!input.actionIdValid) returnTo(formData, "Choose a valid relationship action.");

  const { data: before, error: readError } = await admin
    .from("relationship_actions")
    .select("id, tenant_id, contact_id, title, status, priority, due_on, completed_at, notes")
    .eq("tenant_id", context.tenantId)
    .eq("id", input.actionId)
    .single();

  if (readError || !before) {
    returnTo(formData, "That relationship action is no longer available.");
  }

  const now = new Date().toISOString();

  if (
    before.status !== input.status &&
    relationshipActionStatusNeedsNote(input.status) &&
    !input.statusNote
  ) {
    returnTo(formData, "Add a short reason before deferring or skipping this move.");
  }

  const after = {
    status: input.status,
    priority: input.priority,
    due_on: input.dueOn,
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
    .eq("id", input.actionId);

  if (error) returnTo(formData, "Relationship action could not be updated.");

  await admin.from("audit_log").insert(
    buildClientAuditRow({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "relationship_action.movement_updated",
      tableName: "relationship_actions",
      recordId: input.actionId,
      before,
      after,
      metadata: {
        ui_surface: "movement_queue",
        status_note: input.statusNote,
      },
    }),
  );

  revalidateMovementPaths([before.contact_id]);
  returnTo(formData, "Relationship action updated.");
}

export async function captureRelationshipAction(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnTo(formData, "Supabase admin environment is not configured."),
  );
  const input = parseRelationshipActionCreateForm(formData);
  const contactId = input.contactId;

  if (!input.contactIdValid) returnTo(formData, "Choose a contact before saving a move.");
  if (!input.titleValid) returnTo(formData, "Add a next move before saving.");

  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .select("id, full_name")
    .eq("tenant_id", context.tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();

  if (contactError || !contact) {
    returnTo(formData, "That contact is no longer available in this book.");
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
    revalidateMovementPaths([contactId]);
    returnTo(formData, "That next move is already tracked.");
  }

  const sourceMetadata = {
    contact_name: contact.full_name,
    created_from: input.source,
    evidence_summary: input.evidenceSummary,
    source_ref: input.sourceRef,
    ui_surface: safeFormReturnPath(formData, "/movement"),
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
    returnTo(formData, "Relationship action could not be saved.");
  }

  await Promise.all([
    admin.from("audit_log").insert(
      buildClientAuditRow({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "relationship_action.captured",
        tableName: "relationship_actions",
        recordId: action.id,
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
          ui_surface: safeFormReturnPath(formData, "/movement"),
        },
      }),
    ),
    admin.from("usage_events").insert(
      buildClientUsageEvent({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        eventType: "relationship_action_captured",
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
    ),
  ]);

  revalidateMovementPaths([contactId]);
  returnTo(formData, "Next move saved.");
}

export async function queueRelationshipCommandJob(formData: FormData) {
  await requireOperatorAccess();

  const { admin, context } = await requireTenantActionContext(() =>
    returnTo(formData, "Supabase admin environment is not configured."),
  );
  const input = parseRelationshipCommandJobForm(formData);
  const contactId = input.contactId;

  if (!input.contactIdValid) returnTo(formData, "Choose a contact before queueing Claude.");

  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .select(
      "id, full_name, company_name, trust_level, relationship_strength, current_asks, wants_help_with, ideal_referral, do_not_refer_for, podcast_fit",
    )
    .eq("tenant_id", context.tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();

  if (contactError || !contact) {
    returnTo(formData, "That contact is no longer available in this book.");
  }

  const { data: activeJobs } = await admin
    .from("jobs")
    .select("id, payload")
    .eq("tenant_id", context.tenantId)
    .eq("job_type", "contact_enrichment")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(100);
  const existingJob =
    (((activeJobs ?? []) as { id: string; payload: Record<string, unknown> }[]).find(
      (job) =>
        job.payload.contact_id === contactId &&
        typeof job.payload.command_focus === "object" &&
        !Array.isArray(job.payload.command_focus) &&
        (job.payload.command_focus as Record<string, unknown>).intent === input.intent,
    ) ?? null);

  if (existingJob) {
    redirect(
      `/ops/jobs/${existingJob.id}/handoff?message=${encodeURIComponent(
        `${input.command.label} is already queued for this contact.`,
      )}`,
    );
  }

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({
      tenant_id: context.tenantId,
      job_type: "contact_enrichment",
      status: "queued",
      payload: {
        contact_id: contactId,
        trigger: "relationship_command_shortcut",
        source: input.source,
        requested_by: context.userId,
        return_to: safeFormReturnPath(formData, "/movement"),
        contact_label: [contact.full_name, contact.company_name].filter(Boolean).join(" / "),
        command_focus: {
          intent: input.intent,
          label: input.command.label,
          objective: input.command.objective,
          primary_move: input.primaryMove,
          expected_outputs: input.command.expected_outputs,
          owner_verification_required: true,
          command_prompt: input.commandPrompt,
          contact_snapshot: {
            trust_level: contact.trust_level,
            relationship_strength: contact.relationship_strength,
            current_asks: contact.current_asks,
            wants_help_with: contact.wants_help_with,
            ideal_referral: contact.ideal_referral,
            do_not_refer_for: contact.do_not_refer_for,
            podcast_fit: contact.podcast_fit,
          },
        },
        required_steps: [
          "review_existing_profile",
          "inspect_authorized_claude_context",
          "complete_command_focus",
          "owner_verification",
          "pending_change_proposals",
          "operator_return",
        ],
        verification: {
          required: true,
          owner_conversation: "claude",
          rule: "Claude verifies judgment-heavy relationship findings with the owner before changes land in the Book.",
        },
      },
      result: {
        created_from: "relationship_command_shortcut",
        source: input.source,
      },
    })
    .select("id")
    .single();

  if (jobError || !job) {
    returnTo(formData, `${input.command.label} handoff could not be queued.`);
  }

  await Promise.all([
    admin.from("usage_events").insert(
      buildClientUsageEvent({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        eventType: "relationship_command_job_queued",
        unit: "job",
        metadata: {
          contact_id: contactId,
          job_id: job.id,
          intent: input.intent,
          source: input.source,
        },
      }),
    ),
    admin.from("audit_log").insert(
      buildClientAuditRow({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        action: "relationship_command.shortcut_queued",
        tableName: "jobs",
        recordId: job.id,
        after: {
          contact_id: contactId,
          intent: input.intent,
          objective: input.command.objective,
          source: input.source,
        },
      }),
    ),
  ]);

  revalidatePath("/ops");
  revalidatePath(`/ops/jobs/${job.id}`);
  revalidatePath(`/ops/jobs/${job.id}/handoff`);
  revalidateMovementPaths([contactId]);
  redirect(
    `/ops/jobs/${job.id}/handoff?message=${encodeURIComponent(
      `${input.command.label} handoff queued.`,
    )}`,
  );
}
