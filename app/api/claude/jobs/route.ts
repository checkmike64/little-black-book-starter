import {
  authenticateClaudeRequest,
  cleanText,
  isValidUuid,
  jsonError,
  privateJson,
  readClaudeJson,
  tenantIdFrom,
} from "@/app/api/claude/_shared";
import { contactEnrichmentInstructions } from "@/lib/claude-enrichment";

type JobRow = {
  id: string;
  tenant_id: string;
  job_type: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  attempts: number;
  run_after: string;
  created_at: string;
  updated_at: string;
};

type ClaimJobRequest = {
  tenant_id?: string;
  job_type?: string;
  test_mode?: boolean;
};

const allowedJobTypes = new Set(["contact_enrichment"]);

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids));
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeStringList(value: unknown, maxItems = 12) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => cleanText(item, 300))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];
}

const claudeRevisionFields = new Set([
  "company_name",
  "company_description",
  "role_title",
  "one_line_summary",
  "how_we_met",
  "how_i_know_them",
  "location",
  "time_zone",
  "linkedin",
  "instagram",
  "facebook",
  "x_twitter",
  "youtube",
  "podcast_url",
  "website",
  "current_asks",
  "wants_help_with",
  "what_they_want_more_of",
  "services_offered",
  "could_refer_me_for",
  "primary_category",
  "top_3_tags",
  "keywords",
  "recent_activity",
]);

function safeRevisionFields(payload: Record<string, unknown>) {
  const fields = objectValue(payload.fields ?? payload.contact);
  const safe: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!claudeRevisionFields.has(key)) continue;
    if (typeof value === "string") safe[key] = cleanText(value, 1600);
    else if (Array.isArray(value)) safe[key] = safeStringList(value, 20);
  }
  return safe;
}

export function claudeJobPayload(payload: Record<string, unknown>) {
  const command = objectValue(payload.command_focus);
  const quality = objectValue(payload.quality_focus);
  const ownerContext = objectValue(payload.owner_context);
  const original = objectValue(payload.original_pending_change);
  const originalPayload = objectValue(original.payload);
  const requiredSteps = safeStringList(payload.required_steps, 30);
  const revisionSteps = Object.keys(original).length
    ? [
        "review_owner_context_answer",
        "compare_against_original_proposal",
        "submit_revised_pending_change_or_no_change",
        "do_not_approve_original_proposal",
      ]
    : [];
  return {
    contact_id: cleanText(payload.contact_id, 80) || null,
    trigger: cleanText(payload.trigger, 80) || null,
    source: cleanText(payload.source, 160) || null,
    required_fields: safeStringList(payload.required_fields, 30),
    required_steps: Array.from(new Set([...requiredSteps, ...revisionSteps])).slice(0, 30),
    research_policy: cleanText(payload.research_policy, 1600) || null,
    known_profile_scan_sources:
      typeof payload.known_profile_scan_sources === "number" &&
      Number.isFinite(payload.known_profile_scan_sources)
        ? Math.max(0, Math.min(1000, Math.floor(payload.known_profile_scan_sources)))
        : 0,
    source_pending_change_id:
      cleanText(payload.source_pending_change_id, 80) || null,
    test_mode: payload.test_mode === true,
    command_focus: Object.keys(command).length
      ? {
          intent: cleanText(command.intent, 120) || null,
          label: cleanText(command.label, 200) || null,
          objective: cleanText(command.objective, 1200) || null,
          primary_move: cleanText(command.primary_move, 500) || null,
          expected_outputs: safeStringList(command.expected_outputs),
          owner_verification_required:
            command.owner_verification_required === true,
          command_prompt: cleanText(command.command_prompt, 1600) || null,
        }
      : null,
    quality_focus: Object.keys(quality).length
      ? {
          readiness: cleanText(quality.readiness, 120) || null,
          missing: safeStringList(quality.missing),
          next_step: cleanText(quality.next_step, 600) || null,
          owner_verification_required:
            quality.owner_verification_required === true,
        }
      : null,
    owner_context: Object.keys(ownerContext).length
      ? {
          status: cleanText(ownerContext.status, 80) || null,
          question: cleanText(ownerContext.question, 800) || null,
          answer: cleanText(ownerContext.answer, 1600) || null,
          blocked_fields: safeStringList(ownerContext.blocked_fields, 30),
          answered_at: cleanText(ownerContext.answered_at, 80) || null,
        }
      : null,
    original_pending_change: Object.keys(original).length
      ? {
          id: cleanText(original.id, 80) || null,
          change_type: cleanText(original.change_type, 80) || null,
          summary: cleanText(original.summary, 800) || null,
          source: cleanText(original.source, 120) || null,
          fields: safeRevisionFields(originalPayload),
        }
      : null,
    revision_contract: Object.keys(original).length
      ? {
          goal: "Create a source-backed replacement proposal only when the owner answer resolves the blocker.",
          original_proposal_remains_pending: true,
          evidence_requirement:
            "Reference the owner answer and source_pending_change_id; do not recreate redacted fields.",
        }
      : null,
  };
}

async function claimNextJob({
  admin,
  tenantId,
  jobType,
  testMode,
}: {
  admin: NonNullable<ReturnType<typeof authenticateClaudeRequest>["admin"]>;
  tenantId: string;
  jobType: string;
  testMode?: boolean;
}) {
  const now = new Date().toISOString();

  let query = admin
    .from("jobs")
    .select("id, tenant_id, job_type, status, payload, result, attempts, run_after, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("job_type", jobType)
    .eq("status", "queued");

  if (testMode !== true) {
    query = query.lte("run_after", now);
  }

  const { data: candidates, error } = await query
    .order(testMode === true ? "created_at" : "run_after", {
      ascending: testMode !== true,
    })
    .limit(testMode === true ? 100 : 5);

  if (error) {
    return { job: null, error };
  }

  const claimableCandidates = ((candidates ?? []) as JobRow[]).filter((candidate) =>
    testMode === true ? candidate.payload.test_mode === true : true,
  );

  for (const candidate of claimableCandidates) {
    const { data: claimed, error: claimError } = await admin
      .from("jobs")
      .update({
        status: "running",
        attempts: candidate.attempts + 1,
        locked_at: now,
        result: {
          ...(candidate.result ?? {}),
          claimed_at: now,
        },
      })
      .eq("tenant_id", tenantId)
      .eq("id", candidate.id)
      .eq("status", "queued")
      .select("id, tenant_id, job_type, status, payload, result, attempts, run_after, created_at, updated_at")
      .maybeSingle();

    if (claimError) {
      return { job: null, error: claimError };
    }

    if (claimed) {
      return { job: claimed as JobRow, error: null };
    }
  }

  return { job: null, error: null };
}

async function getContactContext({
  admin,
  tenantId,
  contactId,
}: {
  admin: NonNullable<ReturnType<typeof authenticateClaudeRequest>["admin"]>;
  tenantId: string;
  contactId: string;
}) {
  const [contactResult, interactionLinksResult, promisesResult, pendingResult, provenanceResult] =
    await Promise.all([
      admin
        .from("contacts")
        .select(
          [
            "id",
            "full_name",
            "company_name",
            "company_description",
            "role_title",
            "one_line_summary",
            "trust_level",
            "touch_cadence",
            "relationship_strength",
            "relationship_strength_computed",
            "relationship_strength_override",
            "relationship_strength_reason",
            "relationship_type",
            "last_spoke",
            "met_date",
            "how_we_met",
            "how_i_know_them",
            "why_stay_in_touch",
            "location",
            "time_zone",
            "linkedin",
            "instagram",
            "facebook",
            "x_twitter",
            "youtube",
            "podcast_url",
            "website",
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
            "source",
            "created_at",
            "updated_at",
          ].join(", "),
        )
        .eq("tenant_id", tenantId)
        .eq("id", contactId)
        .is("archived_at", null)
        .maybeSingle(),
      admin
        .from("interaction_contacts")
        .select("interaction_id")
        .eq("tenant_id", tenantId)
        .eq("contact_id", contactId)
        .limit(12),
      admin
        .from("promises")
        .select("id, direction, promise_text, status, due_on, source, created_at")
        .eq("tenant_id", tenantId)
        .eq("contact_id", contactId)
        .in("status", ["open", "stopped"])
        .order("created_at", { ascending: false })
        .limit(12),
      admin
        .from("pending_changes")
        .select("id, change_type, summary, risk_level, source, created_at")
        .eq("tenant_id", tenantId)
        .eq("contact_id", contactId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(12),
      admin
        .from("field_provenance")
        .select("field_name, source_type, source_ref, summary, confidence, created_at")
        .eq("tenant_id", tenantId)
        .eq("table_name", "contacts")
        .eq("record_id", contactId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  const interactionIds = uniqueIds(
    ((interactionLinksResult.data ?? []) as { interaction_id: string }[])
      .map((row) => row.interaction_id)
      .filter(isValidUuid),
  );

  const interactionsResult =
    interactionIds.length > 0
      ? await admin
          .from("interactions")
          .select("id, occurred_at, interaction_type, title, summary, source, source_ref, created_at")
          .eq("tenant_id", tenantId)
          .in("id", interactionIds)
          .order("occurred_at", { ascending: false })
          .limit(12)
      : { data: [], error: null };

  return {
    contact: contactResult.data ?? null,
    recent_interactions: interactionsResult.data ?? [],
    open_promises: promisesResult.data ?? [],
    pending_changes: pendingResult.data ?? [],
    field_provenance: provenanceResult.data ?? [],
    errors: [
      contactResult.error?.message,
      interactionLinksResult.error?.message,
      promisesResult.error?.message,
      pendingResult.error?.message,
      provenanceResult.error?.message,
      interactionsResult.error?.message,
    ].filter(Boolean),
  };
}

export async function GET() {
  return privateJson(
    { error: "Use POST /api/claude/jobs to claim the next due job." },
    {
      status: 405,
      headers: {
        Allow: "POST",
      },
    },
  );
}

export async function POST(request: Request) {
  const { admin, error } = authenticateClaudeRequest(request, "jobs");
  if (error) return error;

  const parsed = await readClaudeJson<ClaimJobRequest>(request, { allowEmpty: true });
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  const tenantId = tenantIdFrom(body.tenant_id);
  const jobType = cleanText(body.job_type, 80) || "contact_enrichment";

  if (!tenantId) {
    return jsonError("Valid tenant_id is required.");
  }

  if (!allowedJobTypes.has(jobType)) {
    return jsonError("Only contact_enrichment jobs can be claimed by Claude.");
  }

  const { job, error: claimError } = await claimNextJob({
    admin,
    tenantId,
    jobType,
    testMode: body.test_mode,
  });

  if (claimError) {
    return jsonError(claimError.message, 500);
  }

  if (!job) {
    return privateJson({ job: null, context: null });
  }

  const contactId =
    typeof job.payload.contact_id === "string" && isValidUuid(job.payload.contact_id)
      ? job.payload.contact_id
      : null;

  const context = contactId
    ? await getContactContext({ admin, tenantId, contactId })
    : {
        contact: null,
        recent_interactions: [],
        open_promises: [],
        pending_changes: [],
        field_provenance: [],
        errors: ["Job payload does not include a valid contact_id."],
      };

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: tenantId,
      actor_type: "claude",
      action: "job.claimed",
      table_name: "jobs",
      record_id: job.id,
      after: {
        status: "running",
        attempts: job.attempts,
      },
      metadata: {
        job_type: job.job_type,
        contact_id: contactId,
      },
    }),
    admin.from("usage_events").insert({
      tenant_id: tenantId,
      actor_type: "claude",
      event_type: "job_claimed",
      quantity: 1,
      unit: "job",
      metadata: {
        job_id: job.id,
        job_type: job.job_type,
        contact_id: contactId,
      },
    }),
  ]);

  const safePayload = claudeJobPayload(job.payload);
  return privateJson({
    job: {
      id: job.id,
      job_type: job.job_type,
      status: job.status,
      attempts: job.attempts,
      payload: safePayload,
      claimed_at:
        typeof job.result.claimed_at === "string" ? job.result.claimed_at : null,
    },
    context,
    instructions: contactEnrichmentInstructions(job.id, safePayload),
  });
}
