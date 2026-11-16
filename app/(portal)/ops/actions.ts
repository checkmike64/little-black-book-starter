"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { POST as claimClaudeJob } from "@/app/api/claude/jobs/route";
import { POST as completeClaudeJob } from "@/app/api/claude/jobs/[id]/complete/route";
import { POST as failClaudeJob } from "@/app/api/claude/jobs/[id]/fail/route";
import { POST as createClaudePendingChange } from "@/app/api/claude/pending-changes/route";
import { commandOutputActionRecommendation } from "@/lib/command-output-action";
import {
  contactFieldLabel,
  contactFieldTypes,
} from "@/lib/contact-fields";
import { requireOperatorAccess } from "@/lib/operator-access";
import {
  cleanCleanupField,
  cleanupFieldNeedsOwnerVerification,
  normalizeCleanupFieldValue,
} from "@/lib/quality-cleanup-proposal";
import {
  cleanChoice,
  cleanDateValue,
  cleanTextValue,
  RELATIONSHIP_ACTION_PRIORITIES,
  RELATIONSHIP_ACTION_TYPES,
} from "@/lib/relationship-action-validation";
import { redirectWithMessage } from "@/lib/server-action-redirect";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type ContactLookup = {
  id: string;
  tenant_id: string | null;
  full_name: string;
};

type JobLookup = {
  id: string;
  tenant_id: string | null;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
};

type CommandActionJob = JobLookup & {
  result: Record<string, unknown>;
};

type DryRunContact = {
  id: string;
  tenant_id: string | null;
  full_name: string;
  one_line_summary: string | null;
  company_name: string | null;
};

function opsRedirect(message: string): never {
  redirectWithMessage("/ops", message);
}

function jobRedirect(jobId: string, message: string): never {
  redirectWithMessage(`/ops/jobs/${jobId}`, message);
}

function handoffRedirect(jobId: string, message: string): never {
  redirectWithMessage(`/ops/jobs/${jobId}/handoff`, message);
}

function launchRedirect(message: string): never {
  redirectWithMessage("/launch", message);
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function cleanId(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "");
  return isValidUuid(value) ? value : null;
}

function cleanText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function cleanUuidList(formData: FormData, key: string) {
  return Array.from(
    new Set(cleanText(formData, key).split(/[\s,]+/).filter(isValidUuid)),
  );
}

function positiveNumber(formData: FormData, key: string, fallback: number) {
  const value = Number(cleanText(formData, key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function cleanOutcome(value: string) {
  return value === "no_change_needed" ? "no_change_needed" : "submitted_changes";
}

const testCommandIntents = {
  build_intro_map: "Build intro map",
  draft_outreach: "Draft outreach",
  prep_for_call: "Prep for call",
  verify_referral_lane: "Verify referral lane",
} as const;

type TestCommandIntent = keyof typeof testCommandIntents;

function cleanTestCommandIntent(value: string): TestCommandIntent {
  return value in testCommandIntents ? (value as TestCommandIntent) : "draft_outreach";
}

function cleanBlockedOn(value: string) {
  return [
    "missing_source_context",
    "owner_verification",
    "duplicate_review",
    "endpoint_error",
  ].includes(value)
    ? value
    : "owner_verification";
}

function qualityFocus(payload: Record<string, unknown>) {
  const focus = payload.quality_focus;
  if (!focus || typeof focus !== "object" || Array.isArray(focus)) return null;
  return focus as Record<string, unknown>;
}

function focusList(focus: Record<string, unknown> | null, key: string) {
  const value = focus?.[key];
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function commandFocus(payload: Record<string, unknown>) {
  const focus = payload.command_focus;
  if (!focus || typeof focus !== "object" || Array.isArray(focus)) return null;
  return focus as Record<string, unknown>;
}

function commandOutput(result: Record<string, unknown>) {
  if (typeof result.command_output === "string" && result.command_output.trim()) {
    return result.command_output.trim();
  }

  if (typeof result.summary === "string" && result.summary.trim()) {
    return result.summary.trim();
  }

  return "";
}

function commandLabel(payload: Record<string, unknown>) {
  const command = commandFocus(payload);
  return typeof command?.label === "string" ? command.label : "Relationship command";
}

function commandIntent(payload: Record<string, unknown>) {
  const command = commandFocus(payload);
  return typeof command?.intent === "string" ? command.intent : "relationship_command";
}

async function getActionContext() {
  const context = await requireOperatorAccess();
  const admin = createSupabaseAdminClient();

  if (!context || !admin) {
    opsRedirect("Supabase is not configured for Ops actions.");
  }

  return {
    supabase: admin,
    admin,
    userId: context.userId,
    tenantId: context.tenantId,
  };
}

function makeClaudeRequest({
  path,
  body,
}: {
  path: string;
  body: Record<string, unknown>;
}) {
  const token = process.env.CLAUDE_JOB_TOKEN;
  if (!token) {
    throw new Error("CLAUDE_JOB_TOKEN is not configured.");
  }

  return new Request(`http://little-black-book.local${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function parseRouteResponse(response: Response) {
  let responseBody: Record<string, unknown>;
  try {
    responseBody = (await response.json()) as Record<string, unknown>;
  } catch {
    responseBody = {};
  }

  return {
    ok: response.ok,
    status: response.status,
    body: responseBody,
  };
}

async function callClaimRoute(body: Record<string, unknown>) {
  try {
    const response = await claimClaudeJob(
      makeClaudeRequest({
        path: "/api/claude/jobs",
        body,
      }),
    );
    return parseRouteResponse(response);
  } catch (error) {
    return {
      ok: false,
      status: 500,
      body: { error: error instanceof Error ? error.message : "Claim route failed." },
    };
  }
}

async function callCompleteRoute(jobId: string, body: Record<string, unknown>) {
  try {
    const response = await completeClaudeJob(
      makeClaudeRequest({
        path: `/api/claude/jobs/${jobId}/complete`,
        body,
      }),
      { params: Promise.resolve({ id: jobId }) },
    );
    return parseRouteResponse(response);
  } catch (error) {
    return {
      ok: false,
      status: 500,
      body: { error: error instanceof Error ? error.message : "Complete route failed." },
    };
  }
}

async function callFailRoute(jobId: string, body: Record<string, unknown>) {
  try {
    const response = await failClaudeJob(
      makeClaudeRequest({
        path: `/api/claude/jobs/${jobId}/fail`,
        body,
      }),
      { params: Promise.resolve({ id: jobId }) },
    );
    return parseRouteResponse(response);
  } catch (error) {
    return {
      ok: false,
      status: 500,
      body: { error: error instanceof Error ? error.message : "Fail route failed." },
    };
  }
}

async function callPendingChangeRoute(body: Record<string, unknown>) {
  try {
    const response = await createClaudePendingChange(
      makeClaudeRequest({
        path: "/api/claude/pending-changes",
        body,
      }),
    );
    return parseRouteResponse(response);
  } catch (error) {
    return {
      ok: false,
      status: 500,
      body: {
        error: error instanceof Error ? error.message : "Pending-change route failed.",
      },
    };
  }
}

async function getTestJob(jobId: string) {
  const { supabase, tenantId } = await getActionContext();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, tenant_id, status, attempts, payload")
    .eq("tenant_id", tenantId)
    .eq("id", jobId)
    .single();

  if (error || !job) {
    opsRedirect("That test job is no longer available.");
  }

  const typedJob = job as JobLookup;
  if (typedJob.payload.test_mode !== true || typedJob.tenant_id !== tenantId) {
    opsRedirect("Only Ops-created test jobs can be controlled from this panel.");
  }

  return typedJob;
}

async function getHandoffJob(jobId: string) {
  const { supabase, tenantId } = await getActionContext();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, tenant_id, status, attempts, payload")
    .eq("tenant_id", tenantId)
    .eq("id", jobId)
    .single();

  if (error || !job) {
    opsRedirect("That job is no longer available.");
  }

  const typedJob = job as JobLookup;
  if (typedJob.tenant_id !== tenantId) {
    jobRedirect(typedJob.id, "That job is missing tenant ownership.");
  }

  return typedJob;
}

async function getCommandActionJob(jobId: string) {
  const { supabase, tenantId } = await getActionContext();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, tenant_id, status, attempts, payload, result")
    .eq("tenant_id", tenantId)
    .eq("id", jobId)
    .single();

  if (error || !job) {
    opsRedirect("That command job is no longer available.");
  }

  const typedJob = job as CommandActionJob;
  if (typedJob.tenant_id !== tenantId) {
    jobRedirect(typedJob.id, "That job is missing tenant ownership.");
  }

  return typedJob;
}

export async function createTestEnrichmentJob(formData: FormData) {
  const contactId = cleanId(formData, "contact_id");
  if (!contactId) {
    opsRedirect("Choose a contact before creating a test enrichment job.");
  }

  const { supabase, admin, userId, tenantId } = await getActionContext();

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, tenant_id, full_name")
    .eq("tenant_id", tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();

  if (contactError || !contact) {
    opsRedirect("That contact is not available for this install.");
  }

  const typedContact = contact as ContactLookup;
  if (!typedContact.tenant_id) {
    opsRedirect("That contact is missing tenant ownership.");
  }

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({
      tenant_id: typedContact.tenant_id,
      job_type: "contact_enrichment",
      status: "queued",
      payload: {
        contact_id: typedContact.id,
        trigger: "ops_test_panel",
        source: "ops_test_panel",
        requested_by: userId,
        test_mode: true,
        required_steps: [
          "claim_via_claude_jobs_endpoint",
          "inspect_returned_context",
          "complete_or_fail_via_claude_jobs_endpoint",
        ],
        verification: {
          required: false,
          reason: "Ops integration test only",
        },
      },
      result: {
        created_from: "ops_test_panel",
      },
    })
    .select("id")
    .single();

  if (jobError || !job) {
    opsRedirect("The test enrichment job could not be created.");
  }

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: typedContact.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      action: "ops.test_job_created",
      table_name: "jobs",
      record_id: job.id,
      after: {
        status: "queued",
        contact_id: typedContact.id,
      },
      metadata: {
        contact_name: typedContact.full_name,
        test_mode: true,
      },
    }),
    admin.from("usage_events").insert({
      tenant_id: typedContact.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      event_type: "test_job_created",
      quantity: 1,
      unit: "job",
      metadata: {
        job_id: job.id,
        contact_id: typedContact.id,
      },
    }),
  ]);

  revalidatePath("/ops");
  opsRedirect(`Test enrichment job queued for ${typedContact.full_name}.`);
}

export async function createTestCommandJob(formData: FormData) {
  const contactId = cleanId(formData, "contact_id");
  const intent = cleanTestCommandIntent(cleanText(formData, "intent"));
  const label = testCommandIntents[intent];

  if (!contactId) {
    opsRedirect("Choose a contact before creating a test command job.");
  }

  const { supabase, admin, userId, tenantId } = await getActionContext();

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, tenant_id, full_name, company_name, one_line_summary")
    .eq("tenant_id", tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();

  if (contactError || !contact) {
    opsRedirect("That contact is not available for this install.");
  }

  const typedContact = contact as DryRunContact;
  if (!typedContact.tenant_id) {
    opsRedirect("That contact is missing tenant ownership.");
  }

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({
      tenant_id: typedContact.tenant_id,
      job_type: "contact_enrichment",
      status: "queued",
      payload: {
        contact_id: typedContact.id,
        trigger: "ops_test_command_panel",
        source: "ops_test_command_panel",
        requested_by: userId,
        test_mode: true,
        command_focus: {
          intent,
          label,
          objective:
            "Dry-run command job to verify contact command history and Claude handoff plumbing without creating relationship data.",
          primary_move:
            typedContact.one_line_summary ??
            [typedContact.full_name, typedContact.company_name]
              .filter(Boolean)
              .join(" / ") ??
            typedContact.full_name,
          expected_outputs: [
            "dry-run command output",
            "verification that no real outreach or profile changes were made",
          ],
          owner_verification_required: false,
          command_prompt:
            "Ops dry-run only. Return a short command output and do not create pending changes or interaction writes.",
        },
        required_steps: [
          "claim_via_claude_jobs_endpoint",
          "inspect_returned_context",
          "complete_with_command_output",
        ],
        verification: {
          required: false,
          reason: "Ops command-history integration test only",
        },
      },
      result: {
        created_from: "ops_test_command_panel",
      },
    })
    .select("id")
    .single();

  if (jobError || !job) {
    opsRedirect("The test command job could not be created.");
  }

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: typedContact.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      action: "ops.test_command_job_created",
      table_name: "jobs",
      record_id: job.id,
      after: {
        status: "queued",
        contact_id: typedContact.id,
        intent,
      },
      metadata: {
        contact_name: typedContact.full_name,
        test_mode: true,
      },
    }),
    admin.from("usage_events").insert({
      tenant_id: typedContact.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      event_type: "test_command_job_created",
      quantity: 1,
      unit: "job",
      metadata: {
        job_id: job.id,
        contact_id: typedContact.id,
        intent,
      },
    }),
  ]);

  revalidatePath("/ops");
  revalidatePath(`/contacts/${typedContact.id}`);
  opsRedirect(`Test ${label.toLowerCase()} command queued for ${typedContact.full_name}.`);
}

export async function runCommandLifecycleRehearsal(formData: FormData) {
  const contactId = cleanId(formData, "contact_id");
  if (!contactId) {
    launchRedirect("Choose a contact before running the launch rehearsal.");
  }

  const { supabase, admin, userId, tenantId } = await getActionContext();

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, tenant_id, full_name, company_name, one_line_summary")
    .eq("tenant_id", tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();

  if (contactError || !contact) {
    launchRedirect("That contact is not available for this install.");
  }

  const typedContact = contact as DryRunContact;
  if (!typedContact.tenant_id) {
    launchRedirect("That contact is missing tenant ownership.");
  }

  const label = "Launch rehearsal command";
  const primaryMove =
    typedContact.one_line_summary ??
    [typedContact.full_name, typedContact.company_name].filter(Boolean).join(" / ") ??
    typedContact.full_name;

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .insert({
      tenant_id: typedContact.tenant_id,
      job_type: "contact_enrichment",
      status: "queued",
      payload: {
        contact_id: typedContact.id,
        trigger: "ops_launch_rehearsal",
        source: "ops_launch_rehearsal",
        requested_by: userId,
        test_mode: true,
        rehearsal: true,
        command_focus: {
          intent: "launch_rehearsal",
          label,
          objective:
            "Verify Claude job claim, completion, command output capture, action creation, and action closure without creating relationship claims.",
          primary_move: primaryMove,
          expected_outputs: [
            "rehearsal command output",
            "tracked relationship action",
            "closed action status",
          ],
          owner_verification_required: false,
          command_prompt:
            "Ops launch rehearsal only. Return a short command output, do not send outreach, and do not create contact enrichment claims.",
        },
        required_steps: [
          "claim_via_claude_jobs_endpoint",
          "complete_with_command_output",
          "create_tracked_action_from_output",
          "close_tracked_action",
        ],
        verification: {
          required: false,
          reason: "Operator launch rehearsal only",
        },
      },
      result: {
        created_from: "ops_launch_rehearsal",
        rehearsal: true,
      },
    })
    .select("id")
    .single();

  if (jobError || !job) {
    launchRedirect("The launch rehearsal job could not be created.");
  }

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: typedContact.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      action: "ops.launch_rehearsal_job_created",
      table_name: "jobs",
      record_id: job.id,
      after: {
        status: "queued",
        contact_id: typedContact.id,
      },
      metadata: {
        contact_name: typedContact.full_name,
        test_mode: true,
      },
    }),
    admin.from("usage_events").insert({
      tenant_id: typedContact.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      event_type: "launch_rehearsal_job_created",
      quantity: 1,
      unit: "job",
      metadata: {
        job_id: job.id,
        contact_id: typedContact.id,
      },
    }),
  ]);

  const claimResponse = await callClaimRoute({
    tenant_id: typedContact.tenant_id,
    job_type: "contact_enrichment",
    test_mode: true,
  });

  if (!claimResponse.ok) {
    launchRedirect(
      `The launch rehearsal claim failed: ${String(
        claimResponse.body.error ?? claimResponse.status,
      )}`,
    );
  }

  const claimedJob = claimResponse.body.job;
  const claimedJobId =
    claimedJob && typeof claimedJob === "object" && "id" in claimedJob
      ? String(claimedJob.id)
      : null;

  if (claimedJobId !== job.id) {
    launchRedirect(
      claimedJobId
        ? `A different test job was claimed first (${claimedJobId.slice(
            0,
            8,
          )}). Open Ops and clear the older queued job, then rerun launch rehearsal.`
        : "No due test jobs were ready to claim for the launch rehearsal.",
    );
  }

  const output = [
    `Launch rehearsal command output for ${typedContact.full_name}.`,
    "The Claude gateway claimed the job, completed it, saved command output, created a tracked relationship action, and closed that action without sending outreach or changing profile fields.",
  ].join(" ");

  const completeResponse = await callCompleteRoute(job.id, {
    tenant_id: typedContact.tenant_id,
    summary: "Ops launch rehearsal completed without creating live enrichment proposals.",
    created_pending_change_ids: [],
    created_interaction_ids: [],
    result: {
      test_mode: true,
      ops_launch_rehearsal: true,
      outcome: "no_change_needed",
      command_output: output,
      verification_summary:
        "Rehearsal evidence only. No owner relationship judgment or outreach was created.",
      follow_up_needed: null,
    },
  });

  if (!completeResponse.ok) {
    launchRedirect(
      `The launch rehearsal completion failed: ${String(
        completeResponse.body.error ?? completeResponse.status,
      )}`,
    );
  }

  const { data: action, error: actionError } = await admin
    .from("relationship_actions")
    .insert({
      tenant_id: typedContact.tenant_id,
      contact_id: typedContact.id,
      title: `Launch rehearsal action for ${typedContact.full_name}`,
      action_type: "claude_draft",
      status: "open",
      priority: "low",
      notes: output,
      source: "ops_launch_rehearsal",
      created_by: userId,
      metadata: {
        contact_name: typedContact.full_name,
        job_id: job.id,
        command_intent: "launch_rehearsal",
        command_label: label,
        command_output: output,
        created_from: "ops_launch_rehearsal",
        rehearsal: true,
      },
    })
    .select("id")
    .single();

  if (actionError || !action) {
    launchRedirect("The rehearsal job completed, but the tracked action could not be created.");
  }

  const completedAt = new Date().toISOString();
  const { error: actionUpdateError } = await admin
    .from("relationship_actions")
    .update({
      status: "done",
      completed_at: completedAt,
      metadata: {
        contact_name: typedContact.full_name,
        job_id: job.id,
        command_intent: "launch_rehearsal",
        command_label: label,
        command_output: output,
        created_from: "ops_launch_rehearsal",
        rehearsal: true,
        closed_from: "ops_launch_rehearsal",
        closed_at: completedAt,
      },
    })
    .eq("tenant_id", typedContact.tenant_id)
    .eq("id", action.id);

  if (actionUpdateError) {
    launchRedirect(
      `The rehearsal action was created, but could not be closed: ${actionUpdateError.message}`,
    );
  }

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: typedContact.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      action: "ops.launch_rehearsal_completed",
      table_name: "relationship_actions",
      record_id: action.id,
      after: {
        contact_id: typedContact.id,
        job_id: job.id,
        status: "done",
      },
      metadata: {
        source: "ops_launch_rehearsal",
        command_intent: "launch_rehearsal",
      },
    }),
    admin.from("usage_events").insert({
      tenant_id: typedContact.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      event_type: "launch_rehearsal_completed",
      quantity: 1,
      unit: "cycle",
      metadata: {
        contact_id: typedContact.id,
        action_id: action.id,
        job_id: job.id,
      },
    }),
  ]);

  revalidatePath("/launch");
  revalidatePath("/deployment");
  revalidatePath("/ops");
  revalidatePath(`/ops/jobs/${job.id}`);
  revalidatePath("/dashboard");
  revalidatePath("/engagement");
  revalidatePath("/networking");
  revalidatePath("/ask");
  revalidatePath(`/contacts/${typedContact.id}`);
  launchRedirect(
    `Launch rehearsal completed for ${typedContact.full_name}: job ${job.id.slice(
      0,
      8,
    )}, action ${String(action.id).slice(0, 8)}.`,
  );
}

export async function claimTestEnrichmentJob(formData: FormData) {
  const tenantId = cleanId(formData, "tenant_id");
  if (!tenantId) {
    opsRedirect("A tenant-scoped test job is required before claiming.");
  }

  const response = await callClaimRoute({
    tenant_id: tenantId,
    job_type: "contact_enrichment",
    test_mode: true,
  });

  if (!response.ok) {
    opsRedirect(
      `The test claim failed: ${String(response.body.error ?? response.status)}`,
    );
  }

  const job = response.body.job;
  if (!job || typeof job !== "object" || !("id" in job)) {
    opsRedirect("No due test enrichment jobs are ready to claim.");
  }

  revalidatePath("/ops");
  opsRedirect(`Claimed test job ${String(job.id).slice(0, 8)} through the Claude endpoint.`);
}

export async function completeTestEnrichmentJob(formData: FormData) {
  const jobId = cleanId(formData, "job_id");
  if (!jobId) {
    opsRedirect("Choose a running test job to complete.");
  }

  const job = await getTestJob(jobId);
  if (job.status !== "running") {
    opsRedirect("Only running test jobs can be completed.");
  }

  const command = commandFocus(job.payload);
  const response = await callCompleteRoute(job.id, {
    tenant_id: job.tenant_id,
    summary: command
      ? "Ops test command completed without creating live relationship changes."
      : "Ops test completed without creating live enrichment proposals.",
    result: {
      test_mode: true,
      ops_panel_completed: true,
      command_output: command
        ? `Dry-run ${String(command.label ?? "relationship command")} output for Ops verification. No outreach was sent and no relationship data was changed.`
        : null,
      outcome: "no_change_needed",
    },
    created_pending_change_ids: [],
    created_interaction_ids: [],
  });

  if (!response.ok) {
    opsRedirect(
      `The test completion failed: ${String(response.body.error ?? response.status)}`,
    );
  }

  revalidatePath("/ops");
  opsRedirect(`Completed test job ${job.id.slice(0, 8)} through the Claude endpoint.`);
}

export async function submitDryRunEnrichmentProposal(formData: FormData) {
  const jobId = cleanId(formData, "job_id");
  if (!jobId) {
    opsRedirect("Choose a running test job before creating a dry-run proposal.");
  }

  const { supabase, tenantId } = await getActionContext();
  const job = await getTestJob(jobId);
  if (job.status !== "running") {
    opsRedirect("Only running test jobs can create a dry-run proposal.");
  }

  const contactId =
    typeof job.payload.contact_id === "string" && isValidUuid(job.payload.contact_id)
      ? job.payload.contact_id
      : null;

  if (!contactId || !job.tenant_id) {
    opsRedirect("That test job is missing a valid contact.");
  }

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, tenant_id, full_name, one_line_summary, company_name")
    .eq("tenant_id", tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();

  if (contactError || !contact) {
    opsRedirect("The dry-run contact is no longer available.");
  }

  const typedContact = contact as DryRunContact;
  if (typedContact.tenant_id !== job.tenant_id) {
    opsRedirect("The dry-run contact does not match the job tenant.");
  }

  const existingSummary =
    typedContact.one_line_summary?.trim() ||
    [typedContact.full_name, typedContact.company_name]
      .filter(Boolean)
      .join(" at ") ||
    typedContact.full_name;

  const pendingResponse = await callPendingChangeRoute({
    tenant_id: job.tenant_id,
    idempotency_key: `ops-dry-run-enrichment-${job.id}`,
    change_type: "contact_enrichment",
    contact_id: typedContact.id,
    summary: `Dry-run enrichment proposal for ${typedContact.full_name}.`,
    risk_level: "high",
    payload: {
      fields: {
        one_line_summary: existingSummary,
      },
      evidence: {
        source_ref: `ops-job-${job.id}`,
        verified_with_owner: false,
        verification_summary:
          "Ops dry-run only. This proposal intentionally repeats an existing safe field to test the review loop without adding fake relationship intelligence.",
      },
      dry_run: true,
      conflicts_or_duplicates: [],
    },
    source: "ops_enrichment_dry_run",
  });

  if (!pendingResponse.ok) {
    opsRedirect(
      `The dry-run proposal failed: ${String(
        pendingResponse.body.error ?? pendingResponse.status,
      )}`,
    );
  }

  const pendingChangeId =
    typeof pendingResponse.body.id === "string" &&
    isValidUuid(pendingResponse.body.id)
      ? pendingResponse.body.id
      : null;

  if (!pendingChangeId) {
    opsRedirect("The dry-run proposal did not return a pending change id.");
  }

  const completeResponse = await callCompleteRoute(job.id, {
    tenant_id: job.tenant_id,
    summary:
      "Ops dry-run created a reviewable contact_enrichment proposal through the Claude pending-change endpoint.",
    result: {
      test_mode: true,
      ops_panel_completed: true,
      ops_dry_run_pending_change_id: pendingChangeId,
      outcome: "submitted_changes",
    },
    created_pending_change_ids: [pendingChangeId],
    created_interaction_ids: [],
  });

  if (!completeResponse.ok) {
    opsRedirect(
      `The dry-run proposal was created, but job completion failed: ${String(
        completeResponse.body.error ?? completeResponse.status,
      )}`,
    );
  }

  revalidatePath("/changes");
  revalidatePath(`/changes/${pendingChangeId}`);
  revalidatePath("/ops");
  revalidatePath(`/ops/jobs/${job.id}`);
  opsRedirect(
    `Dry-run proposal created for ${typedContact.full_name} and linked to job ${job.id.slice(
      0,
      8,
    )}.`,
  );
}

export async function submitLowRiskAcceptanceProposal(formData: FormData) {
  const contactId = cleanId(formData, "contact_id");
  if (!contactId) {
    opsRedirect("Choose a contact before creating a low-risk acceptance proposal.");
  }

  const { supabase, tenantId } = await getActionContext();
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, tenant_id, full_name")
    .eq("tenant_id", tenantId)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();

  if (contactError || !contact) {
    opsRedirect("That contact is not available for this install.");
  }

  const typedContact = contact as ContactLookup;
  if (!typedContact.tenant_id) {
    opsRedirect("That contact is missing tenant ownership.");
  }

  const pendingResponse = await callPendingChangeRoute({
    tenant_id: typedContact.tenant_id,
    idempotency_key: `ops-low-risk-acceptance-${typedContact.id}-${Date.now()}`,
    change_type: "contact_enrichment",
    contact_id: typedContact.id,
    summary: `Low-risk acceptance proposal for ${typedContact.full_name}.`,
    risk_level: "low",
    payload: {
      fields: {
        full_name: typedContact.full_name,
      },
      evidence: {
        source_ref: "ops-low-risk-acceptance",
        verified_with_owner: true,
        verification_summary:
          "Operator acceptance test. Repeats the existing contact name to verify quick approval, audit, and field provenance without adding relationship claims.",
      },
      acceptance_test: true,
      conflicts_or_duplicates: [],
    },
    source: "ops_acceptance_low_risk",
  });

  if (!pendingResponse.ok) {
    opsRedirect(
      `The low-risk acceptance proposal failed: ${String(
        pendingResponse.body.error ?? pendingResponse.status,
      )}`,
    );
  }

  const pendingChangeId =
    typeof pendingResponse.body.id === "string" &&
    isValidUuid(pendingResponse.body.id)
      ? pendingResponse.body.id
      : null;

  if (!pendingChangeId) {
    opsRedirect("The low-risk acceptance proposal did not return a pending change id.");
  }

  revalidatePath("/changes");
  revalidatePath(`/changes/${pendingChangeId}`);
  revalidatePath("/ops");
  opsRedirect(
    `Low-risk acceptance proposal created for ${typedContact.full_name}. Approve it from Changes to verify audit and provenance.`,
  );
}

export async function failTestEnrichmentJob(formData: FormData) {
  const jobId = cleanId(formData, "job_id");
  if (!jobId) {
    opsRedirect("Choose a running test job to fail.");
  }

  const job = await getTestJob(jobId);
  if (job.status !== "running") {
    opsRedirect("Only running test jobs can be failed.");
  }

  const response = await callFailRoute(job.id, {
    tenant_id: job.tenant_id,
    error: "Ops test failure path verified.",
    terminal: true,
    result: {
      test_mode: true,
      ops_panel_failed: true,
    },
  });

  if (!response.ok) {
    opsRedirect(
      `The test failure failed: ${String(response.body.error ?? response.status)}`,
    );
  }

  revalidatePath("/ops");
  opsRedirect(`Failed test job ${job.id.slice(0, 8)} through the Claude endpoint.`);
}

export async function claimHandoffJob(formData: FormData) {
  const jobId = cleanId(formData, "job_id");
  if (!jobId) {
    opsRedirect("Choose a valid queued job before claiming a handoff.");
  }

  const { admin, userId } = await getActionContext();
  const job = await getHandoffJob(jobId);

  if (job.status !== "queued") {
    handoffRedirect(job.id, "Only queued jobs can be claimed for handoff.");
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("jobs")
    .update({
      status: "running",
      attempts: job.attempts + 1,
      locked_at: now,
      result: {
        ...(job.payload.test_mode === true ? { test_mode: true } : {}),
        claimed_at: now,
        claimed_from: "ops_handoff",
      },
    })
    .eq("tenant_id", job.tenant_id)
    .eq("id", job.id)
    .eq("status", "queued")
    .select("id, status")
    .single();

  if (error || !updated) {
    handoffRedirect(job.id, "The handoff job could not be claimed.");
  }

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: job.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      action: "job.claimed_for_handoff",
      table_name: "jobs",
      record_id: job.id,
      before: {
        status: "queued",
      },
      after: {
        status: "running",
        claimed_at: now,
        claimed_from: "ops_handoff",
      },
      metadata: {
        job_type: "contact_enrichment",
        contact_id:
          typeof job.payload.contact_id === "string" ? job.payload.contact_id : null,
      },
    }),
    admin.from("usage_events").insert({
      tenant_id: job.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      event_type: "job_claimed_for_handoff",
      quantity: 1,
      unit: "job",
      metadata: {
        job_id: job.id,
        contact_id:
          typeof job.payload.contact_id === "string" ? job.payload.contact_id : null,
      },
    }),
  ]);

  revalidatePath("/ops");
  revalidatePath(`/ops/jobs/${job.id}`);
  revalidatePath(`/ops/jobs/${job.id}/handoff`);
  handoffRedirect(job.id, `Claimed handoff job ${job.id.slice(0, 8)}.`);
}

export async function completeHandoffJob(formData: FormData) {
  const jobId = cleanId(formData, "job_id");
  if (!jobId) {
    opsRedirect("Choose a valid job before completing a handoff.");
  }

  const job = await getHandoffJob(jobId);
  if (job.status !== "running") {
    handoffRedirect(job.id, "Only running jobs can be completed from handoff.");
  }

  const summary = cleanText(formData, "summary");
  if (!summary) {
    handoffRedirect(job.id, "Add a short completion summary first.");
  }

  const createdPendingChangeIds = cleanUuidList(
    formData,
    "created_pending_change_ids",
  );
  const createdInteractionIds = cleanUuidList(formData, "created_interaction_ids");
  const outcome = cleanOutcome(cleanText(formData, "outcome"));
  const verificationSummary = cleanText(formData, "verification_summary");
  const followUpNeeded = cleanText(formData, "follow_up_needed");
  const commandOutput = cleanText(formData, "command_output");
  const focus = qualityFocus(job.payload);
  const command = commandFocus(job.payload);

  if (
    outcome === "submitted_changes" &&
    createdPendingChangeIds.length === 0 &&
    createdInteractionIds.length === 0
  ) {
    handoffRedirect(
      job.id,
      "Paste at least one created proposal/interaction id, or choose no change needed.",
    );
  }

  if (
    outcome === "submitted_changes" &&
    focus?.owner_verification_required === true &&
    !verificationSummary
  ) {
    handoffRedirect(
      job.id,
      "Add a verification summary before completing owner-judgment cleanup.",
    );
  }

  if (command && !commandOutput && createdPendingChangeIds.length === 0) {
    handoffRedirect(
      job.id,
      "Paste the Claude command output, or list the proposal/interaction IDs it created.",
    );
  }

  const response = await callCompleteRoute(job.id, {
    tenant_id: job.tenant_id,
    summary,
    created_pending_change_ids: createdPendingChangeIds,
    created_interaction_ids: createdInteractionIds,
    result: {
      completed_from: "ops_handoff",
      outcome,
      command_output: commandOutput || null,
      verification_summary: verificationSummary || null,
      follow_up_needed: followUpNeeded || null,
    },
  });

  if (!response.ok) {
    handoffRedirect(
      job.id,
      `The handoff completion failed: ${String(response.body.error ?? response.status)}`,
    );
  }

  revalidatePath("/ops");
  revalidatePath(`/ops/jobs/${job.id}`);
  revalidatePath(`/ops/jobs/${job.id}/handoff`);
  revalidatePath("/changes");
  jobRedirect(job.id, `Completed handoff job ${job.id.slice(0, 8)}.`);
}

export async function createQualityCleanupProposalFromHandoff(formData: FormData) {
  const jobId = cleanId(formData, "job_id");
  if (!jobId) {
    opsRedirect("Choose a quality cleanup job before creating a proposal.");
  }

  const job = await getHandoffJob(jobId);
  if (job.status !== "running") {
    handoffRedirect(job.id, "Only running cleanup jobs can create a handoff proposal.");
  }

  const focus = qualityFocus(job.payload);
  if (!focus) {
    handoffRedirect(job.id, "This shortcut is only available for quality cleanup jobs.");
  }

  const contactId =
    typeof job.payload.contact_id === "string" && isValidUuid(job.payload.contact_id)
      ? job.payload.contact_id
      : null;

  if (!contactId) {
    handoffRedirect(job.id, "This cleanup job is missing a linked contact.");
  }

  const field = cleanCleanupField(cleanText(formData, "field_name"));
  if (!field) {
    handoffRedirect(job.id, "Choose a supported contact field for the cleanup proposal.");
  }

  const proposedValue = normalizeCleanupFieldValue(
    field,
    cleanText(formData, "proposed_value"),
  );
  if (proposedValue === undefined) {
    handoffRedirect(
      job.id,
      contactFieldTypes[field] === "date"
        ? "Use YYYY-MM-DD for date cleanup proposals."
        : "Add a supported value before creating the cleanup proposal.",
    );
  }

  const sourceRef = cleanText(formData, "source_ref").slice(0, 500);
  const verificationSummary = cleanText(formData, "verification_summary").slice(
    0,
    1200,
  );
  const followUpNeeded = cleanText(formData, "follow_up_needed").slice(0, 1200);
  const leftBlank = cleanText(formData, "left_blank").slice(0, 1200);
  const blockedFields = cleanText(formData, "blocked_fields")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
  const verifiedWithOwner = formData.get("verified_with_owner") === "on";
  const fieldNeedsOwnerVerification = cleanupFieldNeedsOwnerVerification(field);

  if (!sourceRef && !verifiedWithOwner) {
    handoffRedirect(
      job.id,
      "Add a source reference or mark the value as owner-verified before creating the proposal.",
    );
  }

  if (fieldNeedsOwnerVerification && (!verifiedWithOwner || !verificationSummary)) {
    handoffRedirect(
      job.id,
      `${contactFieldLabel(field)} needs owner verification and a short verification summary before it can become a proposal.`,
    );
  }

  const { admin, userId } = await getActionContext();
  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .select("id, full_name")
    .eq("tenant_id", job.tenant_id)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();

  if (contactError || !contact) {
    handoffRedirect(job.id, "The linked contact is no longer available.");
  }

  const missingFields = focusList(focus, "missing");
  const summary = `Quality cleanup proposal for ${contact.full_name}: ${contactFieldLabel(
    field,
  )}.`;
  const pendingResponse = await callPendingChangeRoute({
    tenant_id: job.tenant_id,
    idempotency_key: `quality-cleanup-${job.id}-${field}`,
    change_type: "contact_enrichment",
    contact_id: contactId,
    summary,
    risk_level: fieldNeedsOwnerVerification ? "high" : "low",
    payload: {
      fields: {
        [field]: proposedValue,
      },
      evidence: {
        source_ref: sourceRef || "owner-verification",
        verified_with_owner: verifiedWithOwner,
        verification_summary: verificationSummary || null,
        operator_handoff_job_id: job.id,
      },
      quality_cleanup: {
        job_id: job.id,
        missing_fields_reviewed: missingFields,
        proposed_field: field,
        proposed_field_label: contactFieldLabel(field),
        field_needs_owner_verification: fieldNeedsOwnerVerification,
        left_blank: leftBlank
          ? leftBlank
              .split(/[\n]+/)
              .map((item) => item.trim())
              .filter(Boolean)
          : [],
        blocked_fields: blockedFields,
      },
    },
    source: "quality_cleanup_job",
  });

  if (!pendingResponse.ok) {
    handoffRedirect(
      job.id,
      `The cleanup proposal failed: ${String(
        pendingResponse.body.error ?? pendingResponse.status,
      )}`,
    );
  }

  const pendingChangeId =
    typeof pendingResponse.body.id === "string" &&
    isValidUuid(pendingResponse.body.id)
      ? pendingResponse.body.id
      : null;

  if (!pendingChangeId) {
    handoffRedirect(job.id, "The cleanup proposal did not return a pending change id.");
  }

  const completeResponse = await callCompleteRoute(job.id, {
    tenant_id: job.tenant_id,
    summary,
    created_pending_change_ids: [pendingChangeId],
    created_interaction_ids: [],
    result: {
      completed_from: "ops_quality_cleanup_shortcut",
      outcome: "submitted_changes",
      quality_cleanup_pending_change_id: pendingChangeId,
      proposed_field: field,
      verification_summary: verificationSummary || null,
      follow_up_needed: followUpNeeded || null,
    },
  });

  if (!completeResponse.ok) {
    handoffRedirect(
      job.id,
      `The proposal was created, but job completion failed: ${String(
        completeResponse.body.error ?? completeResponse.status,
      )}`,
    );
  }

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: job.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      action: "quality.cleanup_proposal_created_from_handoff",
      table_name: "pending_changes",
      record_id: pendingChangeId,
      after: {
        job_id: job.id,
        contact_id: contactId,
        field,
        risk_level: fieldNeedsOwnerVerification ? "high" : "low",
      },
      metadata: {
        source: "quality_cleanup_job",
        verified_with_owner: verifiedWithOwner,
        field_needs_owner_verification: fieldNeedsOwnerVerification,
      },
    }),
    admin.from("usage_events").insert({
      tenant_id: job.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      event_type: "quality_cleanup_proposal_created",
      quantity: 1,
      unit: "proposal",
      metadata: {
        job_id: job.id,
        contact_id: contactId,
        pending_change_id: pendingChangeId,
        field,
      },
    }),
  ]);

  revalidatePath("/changes");
  revalidatePath(`/changes/${pendingChangeId}`);
  revalidatePath("/quality");
  revalidatePath("/launch");
  revalidatePath("/ops");
  revalidatePath(`/ops/jobs/${job.id}`);
  revalidatePath(`/ops/jobs/${job.id}/handoff`);
  revalidatePath(`/contacts/${contactId}`);
  jobRedirect(
    job.id,
    `Created cleanup proposal ${pendingChangeId.slice(0, 8)} and completed the job.`,
  );
}

export async function createRelationshipActionFromCommandJob(formData: FormData) {
  const jobId = cleanId(formData, "job_id");
  if (!jobId) {
    opsRedirect("Choose a command job before creating a relationship action.");
  }

  const job = await getCommandActionJob(jobId);
  const { admin, userId } = await getActionContext();
  const command = commandFocus(job.payload);
  const contactId =
    typeof job.payload.contact_id === "string" && isValidUuid(job.payload.contact_id)
      ? job.payload.contact_id
      : null;
  const output = commandOutput(job.result);

  if (!command) {
    jobRedirect(job.id, "Only relationship command jobs can create tracked actions.");
  }

  if (!contactId) {
    jobRedirect(job.id, "This command job is missing a linked contact.");
  }

  if (job.status !== "succeeded") {
    jobRedirect(job.id, "Complete the command job before turning it into an action.");
  }

  if (!output) {
    jobRedirect(job.id, "This command job has no saved output to turn into an action.");
  }

  if (typeof job.result.command_output_dismissed_at === "string") {
    jobRedirect(job.id, "This command output was dismissed as no action needed.");
  }

  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .select("id, full_name")
    .eq("tenant_id", job.tenant_id)
    .eq("id", contactId)
    .is("archived_at", null)
    .single();

  if (contactError || !contact) {
    jobRedirect(job.id, "The linked contact is no longer available.");
  }

  const { data: existingAction } = await admin
    .from("relationship_actions")
    .select("id")
    .eq("tenant_id", job.tenant_id)
    .eq("contact_id", contactId)
    .eq("source", "claude_command_output")
    .eq("metadata->>job_id", job.id)
    .maybeSingle();

  if (existingAction?.id) {
    jobRedirect(
      job.id,
      `This command output is already tracked as action ${String(existingAction.id).slice(
        0,
        8,
      )}.`,
    );
  }

  const recommendation = commandOutputActionRecommendation({
    commandIntent: commandIntent(job.payload),
    commandLabel: commandLabel(job.payload),
    contactName: contact.full_name,
    commandOutput: output,
    verificationSummary:
      typeof job.result.verification_summary === "string"
        ? job.result.verification_summary
        : null,
    followUpNeeded:
      typeof job.result.follow_up_needed === "string" ? job.result.follow_up_needed : null,
  });
  const actionType = cleanChoice(
    formData.get("action_type"),
    RELATIONSHIP_ACTION_TYPES,
    recommendation.actionType,
  );
  const priority = cleanChoice(
    formData.get("priority"),
    RELATIONSHIP_ACTION_PRIORITIES,
    recommendation.priority,
  );
  const title =
    cleanTextValue(formData.get("title"), 500) ??
    recommendation.title ??
    `${commandLabel(job.payload)} for ${contact.full_name}`;
  const dueOn = cleanDateValue(formData.get("due_on"));
  const notes =
    cleanTextValue(formData.get("notes"), 1200) ??
    (recommendation.notes ||
      `Claude command output from job ${job.id.slice(0, 8)}.\n\n${output}`.slice(
        0,
        1200,
      ));
  const evidenceSummary = cleanTextValue(formData.get("evidence_summary"), 1000);
  const sourceRef = cleanTextValue(formData.get("source_ref"), 200) ?? `job:${job.id}`;

  const { data: action, error } = await admin
    .from("relationship_actions")
    .insert({
      tenant_id: job.tenant_id,
      contact_id: contactId,
      title,
      action_type: actionType,
      priority,
      due_on: dueOn,
      notes,
      source: "claude_command_output",
      created_by: userId,
      metadata: {
        contact_name: contact.full_name,
        job_id: job.id,
        command_intent: commandIntent(job.payload),
        command_label: commandLabel(job.payload),
        command_output: output,
        created_from: "ops_command_job",
        evidence_summary: evidenceSummary,
        source_ref: sourceRef,
      },
    })
    .select("id")
    .single();

  if (error || !action) {
    jobRedirect(job.id, "The command output could not be turned into an action.");
  }

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: job.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      action: "relationship_action.created_from_command_job",
      table_name: "relationship_actions",
      record_id: action.id,
      after: {
        contact_id: contactId,
        title,
        action_type: actionType,
        priority,
        due_on: dueOn,
        source_job_id: job.id,
      },
      metadata: {
        source: "claude_command_output",
        command_intent: commandIntent(job.payload),
        evidence_summary: evidenceSummary,
        source_ref: sourceRef,
      },
    }),
    admin.from("usage_events").insert({
      tenant_id: job.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      event_type: "command_output_action_created",
      quantity: 1,
      unit: "action",
      metadata: {
        contact_id: contactId,
        action_id: action.id,
        job_id: job.id,
        command_intent: commandIntent(job.payload),
        evidence_summary: evidenceSummary,
        source_ref: sourceRef,
      },
    }),
  ]);

  revalidatePath("/dashboard");
  revalidatePath("/engagement");
  revalidatePath("/networking");
  revalidatePath("/movement");
  revalidatePath("/ops");
  revalidatePath(`/ops/jobs/${job.id}`);
  revalidatePath("/ask");
  revalidatePath(`/contacts/${contactId}`);
  jobRedirect(job.id, `Created tracked action ${String(action.id).slice(0, 8)}.`);
}

export async function dismissCommandOutputJob(formData: FormData) {
  const jobId = cleanId(formData, "job_id");
  if (!jobId) {
    opsRedirect("Choose a command job before dismissing command output.");
  }

  const job = await getCommandActionJob(jobId);
  const { admin, userId } = await getActionContext();
  const command = commandFocus(job.payload);
  const contactId =
    typeof job.payload.contact_id === "string" && isValidUuid(job.payload.contact_id)
      ? job.payload.contact_id
      : null;
  const output = commandOutput(job.result);

  if (!command) {
    jobRedirect(job.id, "Only relationship command jobs can dismiss command output.");
  }

  if (job.status !== "succeeded") {
    jobRedirect(job.id, "Complete the command job before dismissing its output.");
  }

  if (!output) {
    jobRedirect(job.id, "This command job has no saved output to dismiss.");
  }

  if (typeof job.result.command_output_dismissed_at === "string") {
    jobRedirect(job.id, "This command output was already dismissed.");
  }

  const { data: existingAction } = await admin
    .from("relationship_actions")
    .select("id")
    .eq("tenant_id", job.tenant_id)
    .eq("source", "claude_command_output")
    .eq("metadata->>job_id", job.id)
    .maybeSingle();

  if (existingAction?.id) {
    jobRedirect(
      job.id,
      `This command output is already tracked as action ${String(existingAction.id).slice(
        0,
        8,
      )}.`,
    );
  }

  const reason =
    cleanTextValue(formData.get("dismiss_reason"), 500) ??
    "Reviewed; no relationship action needed.";
  const dismissedAt = new Date().toISOString();
  const nextResult = {
    ...job.result,
    command_output_dismissed_at: dismissedAt,
    command_output_dismissed_by: userId,
    command_output_dismissed_reason: reason,
  };

  const { error } = await admin
    .from("jobs")
    .update({ result: nextResult })
    .eq("tenant_id", job.tenant_id)
    .eq("id", job.id);

  if (error) {
    jobRedirect(job.id, "The command output could not be dismissed.");
  }

  await Promise.all([
    admin.from("audit_log").insert({
      tenant_id: job.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      action: "job.command_output_dismissed",
      table_name: "jobs",
      record_id: job.id,
      before: {
        command_output_dismissed_at: job.result.command_output_dismissed_at ?? null,
        command_output_dismissed_reason:
          job.result.command_output_dismissed_reason ?? null,
      },
      after: {
        command_output_dismissed_at: dismissedAt,
        command_output_dismissed_reason: reason,
      },
      metadata: {
        contact_id: contactId,
        command_intent: commandIntent(job.payload),
        command_label: commandLabel(job.payload),
      },
    }),
    admin.from("usage_events").insert({
      tenant_id: job.tenant_id,
      actor_user_id: userId,
      actor_type: "client",
      event_type: "command_output_dismissed",
      quantity: 1,
      unit: "job",
      metadata: {
        contact_id: contactId,
        job_id: job.id,
        command_intent: commandIntent(job.payload),
      },
    }),
  ]);

  revalidatePath("/dashboard");
  revalidatePath("/engagement");
  revalidatePath("/networking");
  revalidatePath("/ops");
  revalidatePath(`/ops/jobs/${job.id}`);
  revalidatePath("/ask");
  if (contactId) {
    revalidatePath(`/contacts/${contactId}`);
  }
  jobRedirect(job.id, "Dismissed command output as no action needed.");
}

export async function failHandoffJob(formData: FormData) {
  const jobId = cleanId(formData, "job_id");
  if (!jobId) {
    opsRedirect("Choose a valid job before failing a handoff.");
  }

  const job = await getHandoffJob(jobId);
  if (job.status !== "running") {
    handoffRedirect(job.id, "Only running jobs can be failed or retried from handoff.");
  }

  const errorText = cleanText(formData, "error");
  if (!errorText) {
    handoffRedirect(job.id, "Add the reason this job is blocked.");
  }

  const terminal = formData.get("terminal") === "on";
  const retryAfterSeconds = positiveNumber(
    formData,
    "retry_after_seconds",
    60 * 60,
  );
  const blockedOn = cleanBlockedOn(cleanText(formData, "blocked_on"));
  const suggestedNextStep = cleanText(formData, "suggested_next_step");

  const response = await callFailRoute(job.id, {
    tenant_id: job.tenant_id,
    error: errorText,
    retry_after_seconds: retryAfterSeconds,
    terminal,
    result: {
      failed_from: "ops_handoff",
      blocked_on: blockedOn,
      suggested_next_step: suggestedNextStep || null,
    },
  });

  if (!response.ok) {
    handoffRedirect(
      job.id,
      `The handoff failure failed: ${String(response.body.error ?? response.status)}`,
    );
  }

  revalidatePath("/ops");
  revalidatePath(`/ops/jobs/${job.id}`);
  revalidatePath(`/ops/jobs/${job.id}/handoff`);
  jobRedirect(
    job.id,
    terminal
      ? `Marked handoff job ${job.id.slice(0, 8)} as failed.`
      : `Queued handoff job ${job.id.slice(0, 8)} for retry.`,
  );
}
