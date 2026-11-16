import "server-only";

import { randomUUID } from "node:crypto";
import { generateAndStoreIntroductionDraft } from "@/lib/introduction-drafts";
import type { AdminClient } from "@/lib/server-action-context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TenantSettings } from "@/lib/tenant-settings";

type DraftEvidence = Record<string, unknown>;

function evidenceObject(value: unknown): DraftEvidence {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DraftEvidence)
    : {};
}

function cleanRevisionGuidance(value?: string) {
  return value?.replace(/\s+/g, " ").trim().slice(0, 700) || null;
}

export async function queueIntroductionDraft(input: {
  admin: AdminClient;
  tenantId: string;
  introductionId: string;
  revisionGuidance?: string;
}) {
  const { data: introduction, error: readError } = await input.admin
    .from("introductions")
    .select("id, draft_evidence")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.introductionId)
    .single();
  if (readError || !introduction) return null;

  const priorEvidence = evidenceObject(introduction.draft_evidence);
  const reasonFacts = Array.isArray(priorEvidence.reason_facts)
    ? priorEvidence.reason_facts.filter(
        (value): value is string => typeof value === "string" && Boolean(value.trim()),
      )
    : [];
  if (reasonFacts.length === 0) return null;

  const requestId = randomUUID();
  const requestedAt = new Date().toISOString();
  const evidence: DraftEvidence = {
    ...priorEvidence,
    draft_status: "queued",
    draft_request_id: requestId,
    draft_requested_at: requestedAt,
    draft_started_at: null,
    draft_completed_at: null,
    draft_error_code: null,
    draft_revision_guidance: cleanRevisionGuidance(input.revisionGuidance),
  };
  const { data: queued, error: queueError } = await input.admin
    .from("introductions")
    .update({ draft_evidence: evidence, updated_at: requestedAt })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.introductionId)
    .select("id")
    .maybeSingle();
  if (queueError || !queued) return null;

  return { requestId, requestedAt };
}

async function markDraftFailed(input: {
  admin: AdminClient;
  tenantId: string;
  introductionId: string;
  requestId: string;
}) {
  const { data } = await input.admin
    .from("introductions")
    .select("draft_evidence")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.introductionId)
    .eq("draft_evidence->>draft_request_id", input.requestId)
    .eq("draft_evidence->>draft_status", "running")
    .maybeSingle();
  if (!data) return;

  const failedAt = new Date().toISOString();
  await input.admin
    .from("introductions")
    .update({
      draft_evidence: {
        ...evidenceObject(data.draft_evidence),
        draft_status: "failed",
        draft_completed_at: failedAt,
        draft_error_code: "draft_generation_failed",
        draft_revision_guidance: null,
      },
      updated_at: failedAt,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.introductionId)
    .eq("draft_evidence->>draft_request_id", input.requestId)
    .eq("draft_evidence->>draft_status", "running");
}

export async function processIntroductionDraft(input: {
  tenantId: string;
  introductionId: string;
  requestId: string;
  settings: TenantSettings;
  userId: string;
}) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;

  const { data: queued, error: queuedError } = await admin
    .from("introductions")
    .select("draft_evidence")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.introductionId)
    .eq("draft_evidence->>draft_request_id", input.requestId)
    .eq("draft_evidence->>draft_status", "queued")
    .maybeSingle();
  if (queuedError || !queued) return false;

  const queuedEvidence = evidenceObject(queued.draft_evidence);
  const startedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("introductions")
    .update({
      draft_evidence: {
        ...queuedEvidence,
        draft_status: "running",
        draft_started_at: startedAt,
      },
      updated_at: startedAt,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.introductionId)
    .eq("draft_evidence->>draft_request_id", input.requestId)
    .eq("draft_evidence->>draft_status", "queued")
    .select("id")
    .maybeSingle();
  if (claimError || !claimed) return false;

  const revisionGuidance =
    typeof queuedEvidence.draft_revision_guidance === "string"
      ? queuedEvidence.draft_revision_guidance
      : undefined;
  try {
    const draft = await generateAndStoreIntroductionDraft({
      admin,
      tenantId: input.tenantId,
      introductionId: input.introductionId,
      settings: input.settings,
      userId: input.userId,
      requestId: input.requestId,
      revisionGuidance,
    });
    if (draft) return true;
  } catch {
    console.error("introduction_draft_generation_failed", {
      error_code: "draft_generation_failed",
    });
  }

  await markDraftFailed({
    admin,
    tenantId: input.tenantId,
    introductionId: input.introductionId,
    requestId: input.requestId,
  });
  return false;
}
