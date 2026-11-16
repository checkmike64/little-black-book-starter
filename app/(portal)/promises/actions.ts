"use server";

import { revalidatePath } from "next/cache";
import { buildClientAuditRow } from "@/lib/activity-rows";
import { requireTenantActionContext } from "@/lib/server-action-context";
import { revalidateRelationshipWorkspace } from "@/lib/server-action-revalidation";
import { redirectToFormReturn } from "@/lib/server-action-redirect";

const terminalStatuses = new Set(["completed", "skipped", "stopped"]);

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function returnTo(formData: FormData, message: string): never {
  redirectToFormReturn(formData, "/dashboard", message);
}

function cleanText(formData: FormData, key: string, maxLength = 1000) {
  const value = String(formData.get(key) ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  return value || null;
}

function cleanDate(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function rpcObject(value: unknown) {
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved && typeof resolved === "object" && !Array.isArray(resolved)
    ? resolved as Record<string, unknown>
    : null;
}

export async function createManualPromise(formData: FormData) {
  const contactId = String(formData.get("contact_id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  const promiseText = cleanText(formData, "promise_text", 1200);
  const dueOn = cleanDate(formData, "due_on");
  const { admin, context } = await requireTenantActionContext(() =>
    returnTo(formData, "The private data connection is unavailable."),
  );

  if (
    !isValidUuid(contactId)
    || !["owner_owes_contact", "contact_owes_owner"].includes(direction)
    || !promiseText
    || dueOn === undefined
  ) {
    returnTo(formData, "Add a person, direction, and clear commitment.");
  }

  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .select("id, full_name")
    .eq("tenant_id", context.tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();
  if (contactError || !contact) {
    returnTo(formData, "That person is not available in this Book.");
  }

  const now = new Date().toISOString();
  const { data: promise, error } = await admin
    .from("promises")
    .insert({
      tenant_id: context.tenantId,
      owner_user_id: context.userId,
      contact_id: contactId,
      direction,
      promise_text: promiseText,
      due_on: dueOn,
      status: "open",
      review_status: "accepted",
      source: "manual",
      evidence: {
        entered_by_owner: true,
        entered_at: now,
      },
      updated_at: now,
    })
    .select("id")
    .single();
  if (error || !promise) {
    returnTo(formData, "The promise could not be created.");
  }

  await admin.from("audit_log").insert(
    buildClientAuditRow({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "promise.created_manually",
      tableName: "promises",
      recordId: promise.id,
      after: {
        contact_id: contactId,
        direction,
        due_on: dueOn,
        source: "manual",
      },
    }),
  );

  revalidateRelationshipWorkspace([contactId]);
  revalidatePath("/promises");
  returnTo(formData, `Promise created for ${contact.full_name}.`);
}

export async function reviewOperatorRoutedPromise(formData: FormData) {
  const promiseId = String(formData.get("promise_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const expectedUpdatedAt = String(formData.get("expected_updated_at") ?? "").trim();
  const { admin, context } = await requireTenantActionContext(() =>
    returnTo(formData, "The private data connection is unavailable."),
  );
  if (
    !isValidUuid(promiseId)
    || !["accept", "already_done", "decline"].includes(decision)
    || !expectedUpdatedAt
    || Number.isNaN(Date.parse(expectedUpdatedAt))
  ) {
    returnTo(formData, "That promise review is not valid.");
  }
  const { data, error } = await admin.rpc("lbb_review_operator_routed_promise", {
    p_tenant_id: context.tenantId,
    p_promise_id: promiseId,
    p_actor_user_id: context.userId,
    p_decision: decision,
    p_expected_updated_at: expectedUpdatedAt,
  });
  const result = rpcObject(data);
  if (error || result?.promise_id !== promiseId) {
    returnTo(
      formData,
      error?.code === "40001"
        ? "That proposed promise changed. Refresh and review it again."
        : "That proposed promise could not be reviewed. Nothing was changed.",
    );
  }
  revalidatePath("/promises");
  revalidateRelationshipWorkspace([]);
  const messages = {
    accept: "Promise accepted.",
    already_done: "Promise accepted and marked done.",
    decline: "Promise declined.",
  } as const;
  returnTo(formData, messages[decision as keyof typeof messages]);
}

export async function updatePromiseStatus(formData: FormData) {
  const promiseId = String(formData.get("promise_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const statusNote = cleanText(formData, "status_note", 1000);
  const { admin, context } = await requireTenantActionContext(() =>
    returnTo(formData, "Supabase admin environment is not configured."),
  );

  if (!isValidUuid(promiseId) || !terminalStatuses.has(status)) {
    returnTo(formData, "That promise action is not valid.");
  }
  if ((status === "skipped" || status === "stopped") && !statusNote) {
    returnTo(formData, "Add a short reason before skipping or stopping this promise.");
  }

  const { data: before, error: readError } = await admin
    .from("promises")
    .select("id, tenant_id, status, contact_id, promise_text, evidence")
    .eq("tenant_id", context.tenantId)
    .eq("id", promiseId)
    .eq("review_status", "accepted")
    .eq("status", "open")
    .single();

  if (readError || !before) {
    returnTo(formData, "That promise is no longer available.");
  }

  const now = new Date().toISOString();
  const completedAt = status === "completed" ? now : null;
  const evidence =
    before.evidence && typeof before.evidence === "object" && !Array.isArray(before.evidence)
      ? before.evidence
      : {};
  const statusReview = statusNote
    ? {
        note: statusNote,
        reviewed_at: now,
        reviewed_by: context.userId,
        status,
      }
    : null;
  const update = {
    status,
    completed_at: completedAt,
    ...(statusReview
      ? {
          evidence: {
            ...evidence,
            owner_status_review: statusReview,
          },
        }
      : {}),
    updated_at: now,
  };

  const { error } = await admin
    .from("promises")
    .update(update)
    .eq("tenant_id", context.tenantId)
    .eq("id", promiseId);

  if (error) {
    returnTo(formData, "The promise could not be updated.");
  }

  await admin.from("audit_log").insert(
    buildClientAuditRow({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "promise.status_updated",
      tableName: "promises",
      recordId: promiseId,
      before,
      after: {
        status,
        completed_at: completedAt,
        status_note: statusNote,
      },
    }),
  );

  revalidateRelationshipWorkspace([before.contact_id]);
  revalidatePath("/promises");

  returnTo(formData, "Promise updated.");
}

export async function updatePromiseDetails(formData: FormData) {
  const promiseId = String(formData.get("promise_id") ?? "");
  const promiseText = cleanText(formData, "promise_text", 1200);
  const ownerNote = cleanText(formData, "owner_note", 1500);
  const dueOn = cleanDate(formData, "due_on");
  const { admin, context } = await requireTenantActionContext(() =>
    returnTo(formData, "Supabase admin environment is not configured."),
  );

  if (!isValidUuid(promiseId)) {
    returnTo(formData, "That promise action is not valid.");
  }
  if (dueOn === undefined) {
    returnTo(formData, "Use a valid due date or leave the date blank.");
  }
  if (!promiseText && !ownerNote && dueOn === null) {
    returnTo(formData, "Add a clarification, note, or due date before saving.");
  }

  const { data: before, error: readError } = await admin
    .from("promises")
    .select("id, tenant_id, status, contact_id, promise_text, due_on, evidence")
    .eq("tenant_id", context.tenantId)
    .eq("id", promiseId)
    .eq("review_status", "accepted")
    .eq("status", "open")
    .single();

  if (readError || !before) {
    returnTo(formData, "That promise is no longer available.");
  }

  const evidence =
    before.evidence && typeof before.evidence === "object" && !Array.isArray(before.evidence)
      ? before.evidence
      : {};
  const reviewNote = ownerNote
    ? {
        note: ownerNote,
        reviewed_at: new Date().toISOString(),
        reviewed_by: context.userId,
      }
    : null;
  const update = {
    promise_text: promiseText ?? before.promise_text,
    due_on: dueOn,
    evidence: reviewNote
      ? {
          ...evidence,
          owner_review: reviewNote,
        }
      : evidence,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from("promises")
    .update(update)
    .eq("tenant_id", context.tenantId)
    .eq("id", promiseId);

  if (error) {
    returnTo(formData, "The promise could not be clarified.");
  }

  await admin.from("audit_log").insert(
    buildClientAuditRow({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: "promise.details_updated",
      tableName: "promises",
      recordId: promiseId,
      before,
      after: update,
    }),
  );

  revalidateRelationshipWorkspace([before.contact_id]);
  revalidatePath("/promises");

  returnTo(formData, "Promise clarified.");
}
