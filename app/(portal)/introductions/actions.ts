"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { activityDayWindow } from "@/lib/activity-settings";
import { requireTenantActionContext, type AdminClient } from "@/lib/server-action-context";
import { redirectToFormReturn } from "@/lib/server-action-redirect";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import {
  processIntroductionDraft,
  queueIntroductionDraft,
} from "@/lib/introduction-draft-queue";
import {
  resolveIntroductionFitEvidence,
  type NetworkingContact,
} from "@/lib/networking/matching";

const statuses = new Set(["proposed", "made", "follow_up", "closed", "stopped"]);
const feedbackSources = new Set(["owner", "email", "call", "message", "other"]);

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function cleanText(formData: FormData, key: string, maxLength = 2000) {
  return String(formData.get(key) ?? "").trim().slice(0, maxLength);
}

function cleanDate(formData: FormData, key: string) {
  const value = cleanText(formData, key, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function returnTo(formData: FormData, message: string): never {
  redirectToFormReturn(formData, "/networking", message);
}

function introductionStatusNeedsOutcome(status: string) {
  return status === "closed" || status === "stopped";
}

async function contactBelongsToTenant(admin: AdminClient, tenantId: string, id: string) {
  const { data } = await admin
    .from("contacts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  return Boolean(data);
}

export async function createIntroduction(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnTo(formData, "Supabase admin environment is not configured."),
  );
  const personA = cleanText(formData, "person_a", 80);
  const personB = cleanText(formData, "person_b", 80);
  let whyContext = cleanText(formData, "why_context");
  const followUpOn = cleanDate(formData, "follow_up_on");
  const connectionId = cleanText(formData, "connection_id", 80);
  let verifiedReasonFacts: string[] = [];
  let linkedPromiseIds: string[] = [];
  let verifiedReasonSource:
    | "connection.matched_terms"
    | "connection.current_contact_match"
    | null = null;
  const settings = normalizeTenantSettings(context.settings);

  if (!isValidUuid(personA) || !isValidUuid(personB) || personA === personB) {
    returnTo(formData, "Choose two different contacts for the intro.");
  }
  if (!whyContext && !isValidUuid(connectionId)) {
    returnTo(formData, "Add the context for why this intro should happen.");
  }

  const [aOk, bOk] = await Promise.all([
    contactBelongsToTenant(admin, context.tenantId, personA),
    contactBelongsToTenant(admin, context.tenantId, personB),
  ]);

  if (!aOk || !bOk) {
    returnTo(formData, "Both people must belong to this private book.");
  }

  if (isValidUuid(connectionId)) {
    const { data: connection, error: connectionError } = await admin
      .from("connections")
      .select("contact_a, contact_b, evidence")
      .eq("tenant_id", context.tenantId)
      .eq("id", connectionId)
      .maybeSingle();
    const connectionPair = new Set([
      connection?.contact_a ?? "",
      connection?.contact_b ?? "",
    ]);
    const connectionMatchesPair =
      connectionPair.has(personA) && connectionPair.has(personB);
    const evidence =
      connection?.evidence &&
      typeof connection.evidence === "object" &&
      !Array.isArray(connection.evidence)
        ? (connection.evidence as Record<string, unknown>)
        : {};
    const claims = Array.isArray(evidence.claims) ? evidence.claims : [];
    linkedPromiseIds = claims.flatMap((claim) => {
      if (!claim || typeof claim !== "object" || Array.isArray(claim)) return [];
      const sourceRef = (claim as Record<string, unknown>).source_ref;
      if (typeof sourceRef !== "string" || !sourceRef.startsWith("promises:")) return [];
      const promiseId = sourceRef.slice("promises:".length);
      return isValidUuid(promiseId) ? [promiseId] : [];
    });
    let fitEvidence = resolveIntroductionFitEvidence({ evidence });
    if (!fitEvidence && connection && !connectionError && connectionMatchesPair) {
      const { data: currentContacts, error: currentContactsError } = await admin
        .from("contacts")
        .select(
          "id, full_name, company_name, company_description, role_title, one_line_summary, current_asks, wants_help_with, what_they_want_more_of, ideal_referral, podcast_fit, podcast_url, how_we_met, why_stay_in_touch, recent_activity, services_offered, could_refer_me_for, primary_category, top_3_tags, keywords, do_not_refer_for",
        )
        .eq("tenant_id", context.tenantId)
        .in("id", [personA, personB])
        .is("archived_at", null);
      const contactsById = new Map(
        ((currentContacts ?? []) as NetworkingContact[]).map((contact) => [
          contact.id,
          contact,
        ]),
      );
      const currentA = contactsById.get(personA);
      const currentB = contactsById.get(personB);
      if (!currentContactsError && currentA && currentB) {
        fitEvidence = resolveIntroductionFitEvidence({
          evidence,
          contactA: currentA,
          contactB: currentB,
          policy: {
            relationshipRules: settings.onboarding.relationship_rules,
          },
        });
      }
    }
    if (
      connectionError ||
      !connection ||
      !connectionMatchesPair ||
      !fitEvidence
    ) {
      returnTo(
        formData,
        "This recommendation needs source-backed fit context before an introduction can be drafted.",
      );
    }
    // Never trust the hidden form field, prior model prose, or unbound legacy
    // evidence. Rebuild from accepted stored excerpts or a current deterministic
    // match over the two tenant-scoped contact records.
    whyContext = `The source-backed fit is: ${fitEvidence.terms.join(", ")}.`;
    verifiedReasonFacts = fitEvidence.terms;
    verifiedReasonSource = fitEvidence.reasonSource;
  }

  const today = activityDayWindow(settings.activity.time_zone).date;
  let introductionId: string;

  if (isValidUuid(connectionId)) {
    const { data, error } = await admin.rpc(
      "lbb_create_introduction_from_connection",
      {
        p_tenant_id: context.tenantId,
        p_actor_user_id: context.userId,
        p_connection_id: connectionId,
        p_person_a: personA,
        p_person_b: personB,
        p_why_context: whyContext,
        p_follow_up_on: followUpOn,
        p_date_proposed: today,
      },
    );
    const result = data as { id?: string } | null;
    if (error || !result?.id) {
      returnTo(formData, "The introduction could not be created.");
    }
    introductionId = result.id;
  } else {
    const { data, error } = await admin
      .from("introductions")
      .insert({
        tenant_id: context.tenantId,
        person_a: personA,
        person_b: personB,
        date_proposed: today,
        why_context: whyContext,
        follow_up_on: followUpOn,
        status: "proposed",
        created_by: context.userId,
      })
      .select("id")
      .single();

    if (error || !data) {
      returnTo(formData, "The introduction could not be created.");
    }
    introductionId = data.id;

    await admin.from("audit_log").insert({
      tenant_id: context.tenantId,
      actor_user_id: context.userId,
      actor_type: "client",
      action: "introduction.created",
      table_name: "introductions",
      record_id: introductionId,
      after: {
        person_a: personA,
        person_b: personB,
        why_context: whyContext,
        follow_up_on: followUpOn,
        status: "proposed",
        connection_id: null,
      },
    });
  }

  if (verifiedReasonFacts.length > 0) {
    const { error: evidenceError } = await admin
      .from("introductions")
      .update({
        draft_evidence: {
          reason_source: verifiedReasonSource,
          connection_id: connectionId,
          reason_facts: verifiedReasonFacts,
        },
      })
      .eq("tenant_id", context.tenantId)
      .eq("id", introductionId);
    if (evidenceError) {
      returnTo(formData, "The introduction was saved, but its source evidence could not be attached.");
    }
  }

  if (linkedPromiseIds.length > 0) {
    await admin
      .from("promises")
      .update({ introduction_id: introductionId })
      .eq("tenant_id", context.tenantId)
      .eq("status", "open")
      .in("id", [...new Set(linkedPromiseIds)]);
  }

  revalidatePath("/networking");
  revalidatePath(`/contacts/${personA}`);
  revalidatePath(`/contacts/${personB}`);
  if (verifiedReasonFacts.length === 0) {
    returnTo(
      formData,
      "Introduction saved. Add a source-backed connection before generating outreach.",
    );
  }
  const queuedDraft = await queueIntroductionDraft({
    admin,
    tenantId: context.tenantId,
    introductionId,
  });
  if (!queuedDraft) {
    returnTo(formData, "Introduction saved. The draft could not be started.");
  }
  after(async () => {
    await processIntroductionDraft({
      tenantId: context.tenantId,
      introductionId,
      requestId: queuedDraft.requestId,
      settings,
      userId: context.userId,
    });
  });
  returnTo(formData, "Introduction saved. Draft preparation started.");
}

export async function regenerateIntroductionDraft(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnTo(formData, "Supabase admin environment is not configured."),
  );
  const introductionId = cleanText(formData, "introduction_id", 80);
  const revisionGuidance = cleanText(formData, "revision_guidance", 700);
  if (!isValidUuid(introductionId)) {
    returnTo(formData, "That introduction is not valid.");
  }

  const settings = normalizeTenantSettings(context.settings);
  const queuedDraft = await queueIntroductionDraft({
    admin,
    tenantId: context.tenantId,
    introductionId,
    revisionGuidance,
  });
  if (!queuedDraft) {
    returnTo(formData, "The draft update could not be started.");
  }
  after(async () => {
    await processIntroductionDraft({
      tenantId: context.tenantId,
      introductionId,
      requestId: queuedDraft.requestId,
      settings,
      userId: context.userId,
    });
  });

  revalidatePath("/networking");
  returnTo(formData, "Draft update started.");
}

export async function updateIntroduction(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnTo(formData, "Supabase admin environment is not configured."),
  );
  const introId = cleanText(formData, "introduction_id", 80);
  const status = cleanText(formData, "status", 40);
  const outcome = cleanText(formData, "outcome");
  const followUpOn = cleanDate(formData, "follow_up_on");

  if (!isValidUuid(introId) || !statuses.has(status)) {
    returnTo(formData, "That introduction action is not valid.");
  }

  const { data: before, error: readError } = await admin
    .from("introductions")
    .select("id, tenant_id, person_a, person_b, status, outcome, follow_up_on, date_made")
    .eq("tenant_id", context.tenantId)
    .eq("id", introId)
    .single();

  if (readError || !before) {
    returnTo(formData, "That introduction is no longer available.");
  }
  if (introductionStatusNeedsOutcome(status) && !outcome && !before.outcome) {
    returnTo(formData, "Add an outcome before closing or stopping this introduction.");
  }

  const today = new Date().toISOString().slice(0, 10);
  const update = {
    status,
    outcome: outcome || before.outcome,
    follow_up_on: followUpOn,
    date_made: status === "made" && !before.date_made ? today : before.date_made,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from("introductions")
    .update(update)
    .eq("tenant_id", context.tenantId)
    .eq("id", introId);

  if (error) {
    returnTo(formData, "The introduction could not be updated.");
  }

  await admin.from("audit_log").insert({
    tenant_id: context.tenantId,
    actor_user_id: context.userId,
    actor_type: "client",
    action: "introduction.updated",
    table_name: "introductions",
    record_id: introId,
    before,
    after: update,
  });

  revalidatePath("/networking");
  if (before.person_a) revalidatePath(`/contacts/${before.person_a}`);
  if (before.person_b) revalidatePath(`/contacts/${before.person_b}`);
  returnTo(
    formData,
    status === "made" ? "Introduction marked sent." : "Introduction updated.",
  );
}

export async function updateIntroductionFeedback(formData: FormData) {
  const { admin, context } = await requireTenantActionContext(() =>
    returnTo(formData, "Supabase admin environment is not configured."),
  );
  const feedbackId = cleanText(formData, "feedback_id", 80);
  const action = cleanText(formData, "feedback_action", 30);
  const responseText = cleanText(formData, "response_text", 3000);
  const responseReasoning = cleanText(formData, "response_reasoning", 2000);
  const responseSource = cleanText(formData, "response_source", 30) || "owner";
  const usefulnessRating = Number(cleanText(formData, "usefulness_rating", 2));
  const fitRating = Number(cleanText(formData, "fit_rating", 2));
  const wouldRecommendRaw = cleanText(formData, "would_recommend", 10);

  if (!isValidUuid(feedbackId) || !["sent", "responded", "skipped"].includes(action)) {
    returnTo(formData, "That feedback action is not valid.");
  }
  if (action === "responded") {
    if (
      !feedbackSources.has(responseSource) ||
      !Number.isInteger(usefulnessRating) || usefulnessRating < 1 || usefulnessRating > 5 ||
      !Number.isInteger(fitRating) || fitRating < 1 || fitRating > 5 ||
      !responseText
    ) {
      returnTo(formData, "Add both ratings and the response before saving feedback.");
    }
  }

  const { data: before, error: readError } = await admin
    .from("introduction_feedback_requests")
    .select("id, introduction_id, contact_id, status")
    .eq("tenant_id", context.tenantId)
    .eq("id", feedbackId)
    .single();
  if (readError || !before) returnTo(formData, "That feedback request is no longer available.");

  const now = new Date().toISOString();
  const update = action === "responded"
    ? {
        status: "responded",
        usefulness_rating: usefulnessRating,
        fit_rating: fitRating,
        would_recommend: wouldRecommendRaw === "yes" ? true : wouldRecommendRaw === "no" ? false : null,
        response_text: responseText,
        response_reasoning: responseReasoning || null,
        response_source: responseSource,
        response_received_at: now,
        updated_at: now,
      }
    : action === "sent"
      ? { status: "sent", sent_at: now, updated_at: now }
      : { status: "skipped", updated_at: now };

  const { error } = await admin
    .from("introduction_feedback_requests")
    .update(update)
    .eq("tenant_id", context.tenantId)
    .eq("id", feedbackId);
  if (error) returnTo(formData, "The introduction feedback could not be updated.");

  await Promise.all([
    admin.from("introduction_events").insert({
      tenant_id: context.tenantId,
      introduction_id: before.introduction_id,
      event_type: action === "responded" ? "feedback_received" : action === "sent" ? "feedback_sent" : "closed",
      occurred_at: now,
      source: "owner",
      source_ref: feedbackId,
      external_key: `feedback-${action}:${feedbackId}`,
      created_by: context.userId,
      evidence: action === "responded"
        ? { contact_id: before.contact_id, usefulness_rating: usefulnessRating, fit_rating: fitRating }
        : { contact_id: before.contact_id },
    }),
    admin.from("audit_log").insert({
      tenant_id: context.tenantId,
      actor_user_id: context.userId,
      actor_type: "client",
      action: `introduction.feedback_${action}`,
      table_name: "introduction_feedback_requests",
      record_id: feedbackId,
      before,
      after: update,
    }),
  ]);

  revalidatePath("/networking");
  revalidatePath(`/contacts/${before.contact_id}`);
  returnTo(
    formData,
    action === "responded"
      ? "Introduction feedback saved."
      : action === "sent"
        ? "Feedback email marked sent."
        : "Feedback request skipped.",
  );
}
