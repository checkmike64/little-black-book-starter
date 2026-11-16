import Link from "next/link";
import { contactEnrichmentInstructions } from "@/lib/claude-enrichment";
import {
  getHandoffData,
  type HandoffContext,
  type HandoffJobDetail as JobDetail,
} from "@/lib/ops/handoff-data";
import { requireOperatorAccess } from "@/lib/operator-access";
import { cleanupFieldOptions } from "@/lib/quality-cleanup-proposal";
import {
  claimHandoffJob,
  completeHandoffJob,
  createQualityCleanupProposalFromHandoff,
  failHandoffJob,
} from "../../../actions";
import {
  CompletionPasteParser,
  FailurePasteParser,
  PacketCopyPanel,
} from "./handoff-client";

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="json-box">{JSON.stringify(value ?? {}, null, 2)}</pre>;
}

function briefValue(value: unknown, fallback = "Not stored") {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || fallback;
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function qualityFocus(payload: Record<string, unknown>) {
  const focus = payload.quality_focus;
  if (!focus || typeof focus !== "object" || Array.isArray(focus)) {
    return null;
  }

  return focus as Record<string, unknown>;
}

function commandFocus(payload: Record<string, unknown>) {
  const focus = payload.command_focus;
  if (!focus || typeof focus !== "object" || Array.isArray(focus)) {
    return null;
  }

  return focus as Record<string, unknown>;
}

function focusList(focus: Record<string, unknown> | null, key: string) {
  const value = focus?.[key];
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function focusReadiness(focus: Record<string, unknown> | null) {
  return typeof focus?.readiness === "number" ? `${focus.readiness}%` : "Unknown";
}

function focusNextStep(focus: Record<string, unknown> | null) {
  return typeof focus?.next_step === "string"
    ? focus.next_step
    : "Decide which gaps can be source-backed, owner-verified, or left blank.";
}

function contextReadiness(context: HandoffContext) {
  const missing = [
    context.contact ? null : "contact profile",
    context.recent_interactions.length > 0 ? null : "recent interactions",
    context.field_provenance.length > 0 ? null : "field provenance",
  ].filter((item): item is string => Boolean(item));

  return {
    label: missing.length === 0 ? "Strong" : missing.length === 1 ? "Usable" : "Thin",
    missing,
  };
}

function handoffStatus(job: JobDetail, context: HandoffContext) {
  if (job.status === "succeeded") {
    return {
      label: "Returned",
      tone: "ok" as const,
      headline: "Claude return has been recorded",
      detail:
        "Inspect the job result and review any created proposals or interactions before adding more volume.",
      href: `/ops/jobs/${job.id}`,
      action: "Inspect result",
    };
  }

  if (job.status === "failed") {
    return {
      label: "Blocked",
      tone: "warn" as const,
      headline: "This handoff is blocked",
      detail:
        "Resolve the blocker, owner verification, duplicate review, or endpoint issue before retrying the job.",
      href: `/ops/jobs/${job.id}`,
      action: "Inspect blocker",
    };
  }

  if (job.status === "queued") {
    return {
      label: "Claim",
      tone: "neutral" as const,
      headline: "Job is queued for Claude",
      detail:
        "Have Claude claim the job first. Handoff completion is available after the job is running.",
      href: "/claude-setup",
      action: "Open Claude setup",
    };
  }

  const thinContext = contextReadiness(context).label === "Thin";
  return {
    label: thinContext ? "Verify" : "Work",
    tone: thinContext ? ("warn" as const) : ("neutral" as const),
    headline: thinContext
      ? "Source context is thin"
      : "Claude can work this packet",
    detail: thinContext
      ? "Claude may still proceed if its client project has owner-authorized source context, but should return blocked if the evidence is not enough."
      : "Copy the packet into the client Claude project, then paste the success or blocked JSON back here.",
    href: "#packet-for-claude",
    action: "Copy packet",
  };
}

function statusPillClass(tone: "ok" | "warn" | "neutral") {
  if (tone === "ok") return "pill cool";
  if (tone === "warn") return "pill warn";
  return "pill gold";
}

function workflowPillClass(active: boolean, done: boolean) {
  if (done) return "pill cool";
  if (active) return "pill hot";
  return "pill gold";
}

function workflowSteps(job: JobDetail) {
  return [
    {
      label: "Claim",
      detail: "Claude claims the queued job through the private endpoint.",
      done: ["running", "succeeded", "failed"].includes(job.status) || job.attempts > 0,
      active: job.status === "queued",
    },
    {
      label: "Work",
      detail: "Claude reviews the packet plus authorized source context.",
      done: ["succeeded", "failed"].includes(job.status),
      active: job.status === "running",
    },
    {
      label: "Return",
      detail: "Paste success JSON or blocked JSON into the operator form.",
      done: ["succeeded", "failed"].includes(job.status),
      active: job.status === "running",
    },
    {
      label: "Verify",
      detail: "Review created proposals, interactions, audit, and follow-up pressure.",
      done: job.status === "succeeded",
      active: ["succeeded", "failed"].includes(job.status),
    },
  ];
}

function buildPacket(job: JobDetail, context: HandoffContext) {
  const focus = qualityFocus(job.payload);
  const command = commandFocus(job.payload);
  const missingFields = focusList(focus, "missing");
  const expectedOutputs = focusList(command, "expected_outputs");

  return {
    lbb_handoff_version: "2026-07-18",
    operator_note:
      "Paste this packet into the client Claude project. Claude should use its authorized source context, then write only through the configured Little Black Book endpoints.",
    never_include_in_claude_prompt:
      "Do not paste Supabase service-role keys, secret API keys, or Vercel secrets.",
    required_claude_environment:
      "Claude should already have private LBB_APP_URL, LBB_READ_TOKEN, LBB_JOB_TOKEN, and LBB_WRITE_TOKEN values configured in the client project.",
    job: {
      id: job.id,
      tenant_id: job.tenant_id,
      job_type: job.job_type,
      status: job.status,
      attempts: job.attempts,
      payload: job.payload,
      result: job.result,
      claimed_at:
        typeof job.result.claimed_at === "string" ? job.result.claimed_at : null,
      locked_at: job.locked_at,
      run_after: job.run_after,
    },
    context,
    instructions: contactEnrichmentInstructions(job.id, job.payload),
    command_return_contract: command
      ? {
          intent: command.intent ?? null,
          label: command.label ?? null,
          objective: command.objective ?? null,
          primary_move: command.primary_move ?? null,
          expected_outputs: expectedOutputs,
          owner_verification_required:
            command.owner_verification_required === true,
          response_shape: {
            command_output:
              "The requested relationship command result: outreach draft, referral verification, call prep, or intro map.",
            recommended_next_action:
              "One concrete owner/operator action after reviewing the output.",
            pending_changes:
              "Any profile/referral/trust/private-note updates must be submitted through pending changes and listed on completion.",
            interaction_writes:
              "Only mechanically observed interactions or promises should be written directly.",
          },
        }
      : null,
    quality_cleanup_return_contract: focus
      ? {
          readiness: focus.readiness ?? null,
          missing_fields: missingFields,
          next_step: focus.next_step ?? null,
          owner_verification_required:
            focus.owner_verification_required === true,
          decision_required_for_each_missing_field:
            "source_backed_update | owner_verified_proposal | intentionally_blank | blocked",
          pending_change_shape: {
            change_type: "contact_enrichment",
            risk_level:
              focus.owner_verification_required === true ? "high" : "low_or_high",
            payload: {
              fields: {
                FIELD_NAME: "Only include supported fields with source-backed or owner-verified values.",
              },
              evidence: {
                source_ref: "meeting/transcript/correspondence/profile reference",
                verified_with_owner:
                  "true when the owner confirmed judgment-sensitive information",
                verification_summary:
                  "Required for trust, relationship strength, referral, private-note, or relationship-thesis fields.",
              },
              quality_cleanup: {
                job_id: job.id,
                missing_fields_reviewed: missingFields,
                left_blank: ["Fields intentionally left blank and why."],
                blocked_fields: ["Fields that need more source context or owner input."],
              },
            },
          },
        }
      : null,
    return_to_operator: {
      on_success:
        "Paste created pending-change IDs and interaction IDs into the completion form.",
      on_blocked:
        "Paste the blocked reason, blocked-on category, and next step into the retry/fail form.",
      expected_success_fields: {
        summary: "Short sentence describing what Claude reviewed and submitted.",
        created_pending_change_ids: ["uuid"],
        created_interaction_ids: ["uuid"],
        outcome: "submitted_changes | no_change_needed",
        verification_summary: "What the owner/source confirmed, if applicable.",
        follow_up_needed: "Optional owner/operator next step.",
      },
      expected_blocked_fields: {
        error: "Why the job cannot proceed safely.",
        blocked_on:
          "missing_source_context | owner_verification | duplicate_review | endpoint_error",
        retry_after_seconds: 3600,
        terminal: false,
        suggested_next_step: "What must happen before retrying.",
      },
    },
  };
}

export default async function ClaudeHandoffPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ message?: string }>;
}) {
  const operatorContext = await requireOperatorAccess();
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const { setupMode, job, context } = await getHandoffData({
    id,
    context: operatorContext,
  });
  const packet = job ? buildPacket(job, context) : null;
  const packetText = packet
    ? `Little Black Book Claude Handoff\n\nUse this packet inside Claude. Follow the instructions exactly, use only owner-authorized Claude-side source context, and never call Supabase directly.\n\n${JSON.stringify(
        packet,
        null,
        2,
      )}`
    : "";

  if (setupMode) {
    return (
      <>
        <div className="crumb">Ops / Handoff</div>
        <h1 className="portal-title">Claude handoff</h1>
        <div className="notice">Setup mode is waiting for the private database.</div>
      </>
    );
  }

  if (!job) {
    return (
      <>
        <div className="crumb">Ops / Handoff</div>
        <h1 className="portal-title">Claude handoff</h1>
        <div className="empty-state">That job is no longer available.</div>
        <div className="actions">
          <Link className="button ghost" href="/ops">
            Back to Ops
          </Link>
        </div>
      </>
    );
  }

  const isRunning = job.status === "running";
  const readiness = contextReadiness(context);
  const status = handoffStatus(job, context);
  const steps = workflowSteps(job);
  const focus = qualityFocus(job.payload);
  const command = commandFocus(job.payload);
  const missingFields = focusList(focus, "missing");
  const strengths = focusList(focus, "strengths");
  const expectedOutputs = focusList(command, "expected_outputs");

  return (
    <>
      <div className="crumb">Ops / Handoff</div>
      <h1 className="portal-title">Claude handoff</h1>
      <p className="lede">
        A copyable packet for Claude plus paste-back controls for closing the job
        without exposing API tokens or database keys.
      </p>

      {query.message ? <div className="notice">{query.message}</div> : null}

      {!isRunning ? (
        <div className="notice">
          This job is {job.status}. Handoff completion controls are available
          only while a job is running.
          {job.status === "queued" ? (
            <form action={claimHandoffJob} className="review-actions">
              <input name="job_id" type="hidden" value={job.id} />
              <button className="button hot small" type="submit">
                Claim for handoff
              </button>
              <span className="source-note inline">
                Use this when you are manually carrying the packet into Claude.
              </span>
            </form>
          ) : null}
        </div>
      ) : null}

      <section className="statband" aria-label="Handoff job status">
        <div className="stat">
          <div className="number">{job.status}</div>
          <div className="label">Status</div>
        </div>
        <div className="stat">
          <div className="number">{job.attempts}</div>
          <div className="label">Attempts</div>
        </div>
        <div className="stat">
          <div className="number">{context.pending_changes.length}</div>
          <div className="label">Open proposals</div>
        </div>
        <div className="stat">
          <div className="number">{context.open_promises.length}</div>
          <div className="label">Open promises</div>
        </div>
      </section>

      <div className="section-label">Handoff command</div>
      <section className="priority-board" aria-label="Claude handoff command">
        <div className="priority-lead">
          <span className={statusPillClass(status.tone)}>{status.label}</span>
          <h2>{status.headline}</h2>
          <p className="muted">{status.detail}</p>
          <div className="actions">
            <Link className="button hot" href={status.href}>
              {status.action}
            </Link>
            <Link className="button ghost" href={`/ops/jobs/${job.id}`}>
              Job inspector
            </Link>
          </div>
        </div>
        <div className="priority-list">
          {steps.map((step) => (
            <div className="priority-item" key={step.label}>
              <span className={workflowPillClass(step.active, step.done)}>
                {step.done ? "done" : step.active ? "now" : "next"}
              </span>
              <b>{step.label}</b>
              <span>{step.detail}</span>
            </div>
          ))}
        </div>
        <div className="priority-metrics">
          <div>
            <span>Interactions</span>
            <b>{context.recent_interactions.length}</b>
            <small>Recent source context in packet.</small>
          </div>
          <div>
            <span>Promises</span>
            <b>{context.open_promises.length}</b>
            <small>Open or stopped obligations.</small>
          </div>
          <div>
            <span>Pending</span>
            <b>{context.pending_changes.length}</b>
            <small>Existing review pressure.</small>
          </div>
          <div>
            <span>Provenance</span>
            <b>{context.field_provenance.length}</b>
            <small>Field-level source history.</small>
          </div>
        </div>
      </section>

      {command ? (
        <>
          <div className="section-label">Relationship command return plan</div>
          <section className="priority-board" aria-label="Relationship command return plan">
            <div className="priority-lead">
              <span className="pill hot">Command</span>
              <h2>{briefValue(command.label, "Relationship command")}</h2>
              <p className="muted">{briefValue(command.objective)}</p>
              <div className="actions">
                <Link className="button hot" href="#packet-for-claude">
                  Copy packet
                </Link>
                {typeof job.payload.contact_id === "string" ? (
                  <Link className="button ghost" href={`/contacts/${job.payload.contact_id}`}>
                    Contact profile
                  </Link>
                ) : null}
              </div>
            </div>
            <div className="priority-list">
              <div className="priority-item">
                <span className="pill gold">move</span>
                <b>Primary move</b>
                <span>{briefValue(command.primary_move, "Use the profile context to choose the move.")}</span>
              </div>
              {expectedOutputs.length > 0 ? (
                expectedOutputs.map((output) => (
                  <div className="priority-item" key={output}>
                    <span className="pill cool">return</span>
                    <b>{output}</b>
                    <span>Claude should include this in the command output or explain why it is blocked.</span>
                  </div>
                ))
              ) : (
                <div className="priority-item">
                  <span className="pill gold">return</span>
                  <b>Practical relationship output</b>
                  <span>Return the requested draft, prep, verification, or intro map.</span>
                </div>
              )}
            </div>
            <div className="priority-metrics">
              <div>
                <span>Intent</span>
                <b>{briefValue(command.intent, "custom")}</b>
                <small>Specific command queued from the contact page.</small>
              </div>
              <div>
                <span>Owner check</span>
                <b>{command.owner_verification_required === true ? "Yes" : "No"}</b>
                <small>Required for judgment-heavy relationship changes.</small>
              </div>
              <div>
                <span>Pending</span>
                <b>{context.pending_changes.length}</b>
                <small>Existing proposals before this return.</small>
              </div>
              <div>
                <span>Completion</span>
                <b>JSON</b>
                <small>Paste created IDs and command summary back below.</small>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {focus ? (
        <>
          <div className="section-label">Quality cleanup return plan</div>
          <section className="priority-board" aria-label="Quality cleanup return plan">
            <div className="priority-lead">
              <span
                className={
                  focus.owner_verification_required === true ? "pill warn" : "pill cool"
                }
              >
                {focus.owner_verification_required === true
                  ? "Owner check"
                  : "Source backed"}
              </span>
              <h2>{focusReadiness(focus)} ready</h2>
              <p className="muted">{focusNextStep(focus)}</p>
              <div className="actions">
                <Link className="button hot" href="#packet-for-claude">
                  Copy packet
                </Link>
                <Link className="button ghost" href="/changes">
                  Review proposals
                </Link>
              </div>
            </div>
            <div className="priority-list">
              {missingFields.length > 0 ? (
                missingFields.slice(0, 8).map((field) => (
                  <div className="priority-item" key={field}>
                    <span className="pill gold">decide</span>
                    <b>{field}</b>
                    <span>
                      Return a source-backed proposal, owner-verified proposal,
                      intentionally blank reason, or blocked reason.
                    </span>
                  </div>
                ))
              ) : (
                <div className="priority-item">
                  <span className="pill cool">clear</span>
                  <b>No missing fields</b>
                  <span>Claude can close this as no change needed if the context agrees.</span>
                </div>
              )}
            </div>
            <div className="priority-metrics">
              <div>
                <span>Missing</span>
                <b>{missingFields.length}</b>
                <small>Fields that need a decision.</small>
              </div>
              <div>
                <span>Strengths</span>
                <b>{strengths.length}</b>
                <small>Useful context already present.</small>
              </div>
              <div>
                <span>Owner check</span>
                <b>{focus.owner_verification_required === true ? "Yes" : "No"}</b>
                <small>Required before judgment cleanup completion.</small>
              </div>
              <div>
                <span>Open review</span>
                <b>{context.pending_changes.length}</b>
                <small>Existing proposals before this job closes.</small>
              </div>
            </div>
          </section>
        </>
      ) : null}

      <div className="grid three">
        <section className="card">
          <h2>Context Readiness</h2>
          <div className="kv">
            <span className="k">Packet</span>
            <span>{readiness.label}</span>
          </div>
          <div className="kv">
            <span className="k">Missing</span>
            <span>{readiness.missing.length ? readiness.missing.join(", ") : "Nothing obvious"}</span>
          </div>
          <p className="source-note">
            Thin packets can still proceed if Claude has owner-authorized source
            context in the client project.
          </p>
        </section>

        <section className="card">
          <h2>Person Context</h2>
          <div className="kv">
            <span className="k">Name</span>
            <span>{briefValue(context.contact?.full_name)}</span>
          </div>
          <div className="kv">
            <span className="k">Company</span>
            <span>{briefValue(context.contact?.company_name)}</span>
          </div>
          <div className="kv">
            <span className="k">Strength</span>
            <span>{briefValue(context.contact?.relationship_strength)}</span>
          </div>
        </section>

        <section className="card">
          <h2>Claude Guardrails</h2>
          <ul className="security-list">
            <li>
              <span>Use only owner-authorized Claude-side source context.</span>
              <span className="status-ok">Required</span>
            </li>
            <li>
              <span>Write through Little Black Book endpoints only.</span>
              <span className="status-ok">Required</span>
            </li>
            <li>
              <span>Route judgment fields through pending changes.</span>
              <span className="status-warn">Review</span>
            </li>
          </ul>
        </section>
      </div>

      <div className="grid two">
        <section className="card">
          <h2>Job</h2>
          <div className="kv">
            <span className="k">ID</span>
            <span>{job.id}</span>
          </div>
          <div className="kv">
            <span className="k">Type</span>
            <span>{job.job_type}</span>
          </div>
          <div className="kv">
            <span className="k">Created</span>
            <span>{formatDate(job.created_at)}</span>
          </div>
          <div className="kv">
            <span className="k">Locked</span>
            <span>{formatDate(job.locked_at)}</span>
          </div>
        </section>

        <section className="card">
          <h2>Return Shape</h2>
          <JsonBlock value={packet?.return_to_operator} />
        </section>
      </div>

      <section className="card" id="packet-for-claude">
        <h2>Packet for Claude</h2>
        <PacketCopyPanel packetText={packetText} />
        <p className="source-note">
          This packet includes Book context and route instructions, but no
          service-role key, app secret, or Claude write token.
        </p>
      </section>

      {focus ? (
        <>
          <div className="section-label">Guided cleanup return</div>
          <section className="card">
            <h2>Create Review Proposal From Cleanup</h2>
            <p className="muted">
              Use this when Claude has one clear source-backed or owner-verified
              field update. It creates the pending change, links it to this job,
              and completes the handoff.
            </p>
            <form
              action={createQualityCleanupProposalFromHandoff}
              className="settings-form"
            >
              <input name="job_id" type="hidden" value={job.id} />
              <div className="form-grid two-fields">
                <label className="field">
                  <span>Field</span>
                  <select disabled={!isRunning} name="field_name" required={isRunning}>
                    <option value="">Choose field</option>
                    {cleanupFieldOptions.map((field) => (
                      <option key={field.value} value={field.value}>
                        {field.label} - {field.hint}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Source reference</span>
                  <input
                    disabled={!isRunning}
                    name="source_ref"
                    placeholder="Transcript, email thread, profile URL, or owner note"
                  />
                </label>
              </div>
              <label className="field">
                <span>Proposed value</span>
                <textarea
                  disabled={!isRunning}
                  name="proposed_value"
                  placeholder="For list fields, use commas or one item per line. For dates, use YYYY-MM-DD."
                  required={isRunning}
                />
              </label>
              <label className="toggle-row compact">
                <input disabled={!isRunning} name="verified_with_owner" type="checkbox" />
                <span>
                  <b>Owner verified</b>
                  <small>
                    Required for trust, strength, referral safety, relationship
                    thesis, and private-note fields.
                  </small>
                </span>
              </label>
              <label className="field">
                <span>Verification summary</span>
                <textarea
                  disabled={!isRunning}
                  name="verification_summary"
                  placeholder="What source or owner confirmation supports this field?"
                />
              </label>
              <div className="form-grid two-fields">
                <label className="field">
                  <span>Left blank</span>
                  <textarea
                    disabled={!isRunning}
                    name="left_blank"
                    placeholder="Optional: fields intentionally left blank and why."
                  />
                </label>
                <label className="field">
                  <span>Still blocked</span>
                  <textarea
                    disabled={!isRunning}
                    name="blocked_fields"
                    placeholder="Optional: fields still needing owner/source context."
                  />
                </label>
              </div>
              <label className="field">
                <span>Follow-up needed</span>
                <input
                  disabled={!isRunning}
                  name="follow_up_needed"
                  placeholder="Optional next owner/operator step"
                />
              </label>
              <button className="button primary" disabled={!isRunning} type="submit">
                Create proposal and complete job
              </button>
            </form>
          </section>
        </>
      ) : null}

      <div className="grid two">
        <section className="card">
          <h2>Complete From Claude</h2>
          <form action={completeHandoffJob} className="settings-form">
            <input name="job_id" type="hidden" value={job.id} />
            <CompletionPasteParser />
            <label className="field">
              <span>Summary</span>
              <textarea
                disabled={!isRunning}
                name="summary"
                placeholder="Reviewed the source context and created one enrichment proposal."
                required={isRunning}
              />
            </label>
            <label className="field">
              <span>Pending change IDs</span>
              <textarea
                disabled={!isRunning}
                name="created_pending_change_ids"
                placeholder="One UUID per line or separated by commas"
              />
            </label>
            <label className="field">
              <span>Interaction IDs</span>
              <textarea
                disabled={!isRunning}
                name="created_interaction_ids"
                placeholder="One UUID per line or separated by commas"
              />
            </label>
            <label className="field">
              <span>Command output</span>
              <textarea
                disabled={!isRunning}
                name="command_output"
                placeholder="Paste the outreach draft, referral verification, call prep, intro map, or no-change rationale from Claude."
              />
            </label>
            <div className="form-grid two-fields">
              <label className="field">
                <span>Outcome</span>
                <select disabled={!isRunning} name="outcome">
                  <option value="submitted_changes">Submitted changes</option>
                  <option value="no_change_needed">No change needed</option>
                </select>
              </label>
              <label className="field">
                <span>Follow-up</span>
                <input
                  disabled={!isRunning}
                  name="follow_up_needed"
                  placeholder="Optional next step"
                />
              </label>
            </div>
            <label className="field">
              <span>Verification summary</span>
              <textarea
                disabled={!isRunning}
                name="verification_summary"
                placeholder="What the owner or source confirmed, if applicable."
              />
            </label>
            <button className="button primary" disabled={!isRunning} type="submit">
              Complete job
            </button>
          </form>
        </section>

        <section className="card">
          <h2>Retry Or Fail</h2>
          <form action={failHandoffJob} className="settings-form">
            <input name="job_id" type="hidden" value={job.id} />
            <FailurePasteParser />
            <label className="field">
              <span>Blocked reason</span>
              <textarea
                disabled={!isRunning}
                name="error"
                placeholder="Owner verification is needed before enrichment can continue."
                required={isRunning}
              />
            </label>
            <div className="form-grid two-fields">
              <label className="field">
                <span>Blocked on</span>
                <select disabled={!isRunning} name="blocked_on">
                  <option value="owner_verification">Owner verification</option>
                  <option value="missing_source_context">Missing source context</option>
                  <option value="duplicate_review">Duplicate review</option>
                  <option value="endpoint_error">Endpoint error</option>
                </select>
              </label>
              <label className="field">
                <span>Retry seconds</span>
                <input
                  defaultValue="3600"
                  disabled={!isRunning}
                  min="60"
                  name="retry_after_seconds"
                  type="number"
                />
              </label>
            </div>
            <label className="field">
              <span>Suggested next step</span>
              <textarea
                disabled={!isRunning}
                name="suggested_next_step"
                placeholder="Ask the owner to confirm the referral-readiness judgment."
              />
            </label>
            <label className="toggle-row compact">
              <input disabled={!isRunning} name="terminal" type="checkbox" />
              <span>
                <b>Terminal failure</b>
                <small>Check only when this job should not retry.</small>
              </span>
            </label>
            <button className="button quiet" disabled={!isRunning} type="submit">
              Save blocked status
            </button>
          </form>
        </section>
      </div>

      <div className="actions">
        <Link className="button ghost" href={`/ops/jobs/${job.id}`}>
          Back to job
        </Link>
        <Link className="button ghost" href="/ops">
          Back to Ops
        </Link>
      </div>
    </>
  );
}
