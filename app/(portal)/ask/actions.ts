"use server";

import { revalidatePath } from "next/cache";
import {
  askRunDecisionLabel,
  buildAskRunDecision,
  isAskRunDecisionStatus,
} from "@/lib/ask-run-decision";
import { ownerConfirmedAskActionType } from "@/lib/ask-decision-queue";
import {
  cleanChoice,
  cleanDateValue,
  RELATIONSHIP_ACTION_PRIORITIES,
  RELATIONSHIP_ACTION_TYPES,
} from "@/lib/relationship-action-validation";
import { requireTenantActionContext } from "@/lib/server-action-context";
import { redirectToFormReturn } from "@/lib/server-action-redirect";

const askModes = new Set(["search", "referrals", "podcasts", "investors", "ma", "stale", "asks"]);

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function cleanText(formData: FormData, key: string, maxLength = 2000) {
  const value = String(formData.get(key) ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  return value;
}

function returnTo(formData: FormData, message: string): never {
  redirectToFormReturn(formData, "/ask", message);
}

function parseJsonField(formData: FormData, key: string, fallback: unknown) {
  const raw = String(formData.get(key) ?? "");
  if (!raw || raw.length > 60000) return fallback;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fallback;
  }
}

export async function saveAskRun(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnTo(formData, "Supabase admin environment is not configured."),
  );
  const mode = cleanText(formData, "mode", 40);
  const query = cleanText(formData, "query", 240);
  const modeLabel = cleanText(formData, "mode_label", 80) || "Ask";
  const headline = cleanText(formData, "headline", 240);

  if (!askModes.has(mode)) returnTo(formData, "That Ask mode is not available.");

  const title = headline || (query ? `${modeLabel}: ${query}` : `${modeLabel} shortlist`);
  const answer = parseJsonField(formData, "answer", {});
  const decisionStatus = cleanText(formData, "decision_status", 80);
  const answerWithDecision =
    decisionStatus && isAskRunDecisionStatus(decisionStatus)
      ? {
          ...(answer && typeof answer === "object" && !Array.isArray(answer) ? answer : {}),
          decision: {
            ...buildAskRunDecision({
              status: decisionStatus,
              note: cleanText(formData, "decision_note", 800),
              decidedBy: context.userId,
            }),
          },
        }
      : answer;
  const shortlist = parseJsonField(formData, "shortlist", []);
  const contextHits = parseJsonField(formData, "context_hits", []);
  const snapshot = parseJsonField(formData, "snapshot", {});

  const { data, error } = await admin
    .from("ask_runs")
    .insert({
      tenant_id: context.tenantId,
      mode,
      query,
      title: title.slice(0, 240),
      answer: answerWithDecision,
      shortlist,
      context_hits: contextHits,
      snapshot,
      saved_by: context.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    returnTo(formData, "This Ask run could not be saved.");
  }

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: context.tenantId,
      actor_user_id: context.userId,
      actor_type: "client",
      action: "ask_run.saved",
      table_name: "ask_runs",
      record_id: data.id,
      after: {
        mode,
        query,
        title,
        decision_status: decisionStatus || null,
      },
    }),
    admin.from("usage_events").insert({
      tenant_id: context.tenantId,
      actor_user_id: context.userId,
      actor_type: "client",
      event_type: "ask_run.saved",
      quantity: 1,
      unit: "run",
      metadata: {
        mode,
        query,
        decision_status: decisionStatus || null,
      },
    }),
  ]);

  revalidatePath("/ask");
  revalidatePath("/dashboard");
  returnTo(
    formData,
    decisionStatus && isAskRunDecisionStatus(decisionStatus)
      ? `Ask run saved as ${askRunDecisionLabel(decisionStatus)}.`
      : "Ask run saved.",
  );
}

export async function markAskRunDecision(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnTo(formData, "Supabase admin environment is not configured."),
  );
  const askRunId = cleanText(formData, "ask_run_id", 80);
  const decisionStatus = cleanText(formData, "decision_status", 80);
  const decisionNote = cleanText(formData, "decision_note", 800);
  const shouldCreateAction =
    decisionStatus === "follow_up_needed" &&
    cleanText(formData, "create_relationship_action", 10) === "true";
  const ownerConfirmedIntent =
    cleanText(formData, "owner_confirmed_intent", 10) === "true";
  const needsEvidenceVerification =
    cleanText(formData, "needs_evidence_verification", 10) === "true" &&
    !ownerConfirmedIntent;

  if (!isValidUuid(askRunId)) returnTo(formData, "Choose a valid saved Ask run.");
  if (!isAskRunDecisionStatus(decisionStatus)) {
    returnTo(formData, "Choose a valid Ask decision.");
  }

  const { data: before, error: readError } = await admin
    .from("ask_runs")
    .select("id, tenant_id, mode, query, title, answer, created_at")
    .eq("tenant_id", context.tenantId)
    .eq("id", askRunId)
    .single();

  if (readError || !before) {
    returnTo(formData, "That saved Ask run is no longer available.");
  }

  const beforeAnswer =
    before.answer && typeof before.answer === "object" && !Array.isArray(before.answer)
      ? (before.answer as Record<string, unknown>)
      : {};
  const afterAnswer = {
    ...beforeAnswer,
    decision: {
      ...buildAskRunDecision({
        status: decisionStatus,
        note: decisionNote,
        decidedBy: context.userId,
      }),
    },
  };

  const { error } = await admin
    .from("ask_runs")
    .update({
      answer: afterAnswer,
    })
    .eq("tenant_id", context.tenantId)
    .eq("id", askRunId);

  if (error) {
    returnTo(formData, "The Ask run decision could not be saved.");
  }

  let relationshipActionId: string | null = null;
  let relationshipActionError: string | null = null;
  if (shouldCreateAction) {
    const contactId = cleanText(formData, "contact_id", 80);
    const validContactId = isValidUuid(contactId) ? contactId : null;
    let verifiedContactId: string | null = null;

    if (validContactId) {
      const { data: contact } = await admin
        .from("contacts")
        .select("id")
        .eq("tenant_id", context.tenantId)
        .eq("id", validContactId)
        .is("archived_at", null)
        .maybeSingle();

      if (contact?.id) {
        verifiedContactId = contact.id;
      } else {
        relationshipActionError =
          "The Ask decision was saved, but the selected contact is no longer available in this Book.";
      }
    }
    const requestedTitle = cleanText(formData, "relationship_action_title", 500);
    const actionTitle = ownerConfirmedIntent
      ? `Move forward: ${before.title}`.slice(0, 500)
      : needsEvidenceVerification
      ? `Verify Ask result: ${before.title}`.slice(0, 500)
      : requestedTitle || `Follow up from Ask: ${before.title}`.slice(0, 500);
    const requestedNotes =
      cleanText(formData, "relationship_action_notes", 1200) ||
      decisionNote ||
      `Saved Ask run "${before.title}" was marked follow-up needed.`;
    const actionNotes = ownerConfirmedIntent
      ? `Owner confirmed this remains a desired next step. ${requestedNotes}`.slice(0, 1200)
      : needsEvidenceVerification
      ? `Verification required: no supporting evidence records were retrieved. ${requestedNotes}`.slice(
          0,
          1200,
        )
      : requestedNotes;
    const actionType = ownerConfirmedIntent
      ? ownerConfirmedAskActionType(before.mode)
      : needsEvidenceVerification
      ? "owner_verification"
      : cleanChoice(
          formData.get("relationship_action_type"),
          RELATIONSHIP_ACTION_TYPES,
          "follow_up",
        );
    const priority = ownerConfirmedIntent
      ? "normal"
      : needsEvidenceVerification
      ? "high"
      : cleanChoice(
          formData.get("relationship_action_priority"),
          RELATIONSHIP_ACTION_PRIORITIES,
          "normal",
        );
    const dueOn = cleanDateValue(formData.get("relationship_action_due_on"));

    if (!relationshipActionError) {
      const { data: existingAction } = await admin
        .from("relationship_actions")
        .select("id")
        .eq("tenant_id", context.tenantId)
        .eq("source", "ask_run_decision")
        .eq("metadata->>ask_run_id", askRunId)
        .maybeSingle();

      if (existingAction?.id) {
        relationshipActionId = existingAction.id;
      } else {
        const { data: action, error: actionError } = await admin
          .from("relationship_actions")
          .insert({
            tenant_id: context.tenantId,
            contact_id: verifiedContactId,
            title: actionTitle,
            action_type: actionType,
            status: "open",
            priority,
            due_on: dueOn,
            notes: actionNotes,
            source: "ask_run_decision",
            created_by: context.userId,
            metadata: {
              ask_run_id: askRunId,
              mode: before.mode,
              query: before.query,
              decision_status: decisionStatus,
              created_from: "ask_decision_queue",
              needs_evidence_verification: needsEvidenceVerification,
              owner_confirmed_intent: ownerConfirmedIntent,
              evidence_context_count: needsEvidenceVerification ? 0 : null,
              inferred_action_type: actionType,
              inferred_priority: priority,
              inferred_due_on: dueOn,
            },
          })
          .select("id")
          .single();

        if (actionError || !action) {
          relationshipActionError =
            "The Ask run was marked follow-up needed, but the movement action could not be created.";
        } else {
          relationshipActionId = action.id;
        }
      }
    }
  }

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: context.tenantId,
      actor_user_id: context.userId,
      actor_type: "client",
      action: "ask_run.decision_marked",
      table_name: "ask_runs",
      record_id: askRunId,
      before: {
        decision: beforeAnswer.decision ?? null,
      },
      after: {
        decision: afterAnswer.decision,
        relationship_action_id: relationshipActionId,
        relationship_action_error: relationshipActionError,
      },
    }),
    admin.from("usage_events").insert({
      tenant_id: context.tenantId,
      actor_user_id: context.userId,
      actor_type: "client",
      event_type: "ask_run.decision_marked",
      quantity: 1,
      unit: "decision",
      metadata: {
        ask_run_id: askRunId,
        mode: before.mode,
        decision_status: decisionStatus,
        relationship_action_id: relationshipActionId,
        relationship_action_error: relationshipActionError,
      },
    }),
  ]);

  revalidatePath("/ask");
  revalidatePath("/dashboard");
  revalidatePath("/movement");
  returnTo(
    formData,
    relationshipActionError ??
      (relationshipActionId
        ? `Ask run marked ${askRunDecisionLabel(decisionStatus)} and saved as a move.`
        : `Ask run marked ${askRunDecisionLabel(decisionStatus)}.`),
  );
}

export async function deleteAskRun(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnTo(formData, "Supabase admin environment is not configured."),
  );
  const askRunId = cleanText(formData, "ask_run_id", 80);

  if (!isValidUuid(askRunId)) returnTo(formData, "Choose a valid saved Ask run.");

  const { data: before, error: readError } = await admin
    .from("ask_runs")
    .select("id, tenant_id, mode, query, title, created_at")
    .eq("tenant_id", context.tenantId)
    .eq("id", askRunId)
    .single();

  if (readError || !before) {
    returnTo(formData, "That saved Ask run is no longer available.");
  }

  const { error } = await admin
    .from("ask_runs")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("id", askRunId);

  if (error) {
    returnTo(formData, "The saved Ask run could not be removed.");
  }

  await admin.from("audit_log").insert({
    tenant_id: context.tenantId,
    actor_user_id: context.userId,
    actor_type: "client",
    action: "ask_run.deleted",
    table_name: "ask_runs",
    record_id: askRunId,
    before,
  });

  revalidatePath("/ask");
  revalidatePath("/dashboard");
  revalidatePath("/movement");
  returnTo(formData, "Saved Ask run removed.");
}
