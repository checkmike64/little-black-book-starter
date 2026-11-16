import Link from "next/link";
import {
  createRelationshipActionFromCommandJob,
  dismissCommandOutputJob,
} from "@/app/(portal)/ops/actions";
import { commandOutputActionRecommendation } from "@/lib/command-output-action";
import { commandOutputDismissal } from "@/lib/command-output-dismissal";
import { buildJobOutcome } from "@/lib/job-outcome";
import {
  isQualityCleanupChange,
  qualityCleanupDetails,
  reviewLane,
} from "@/lib/pending-change-review";
import { suggestedRelationshipActionDueDate } from "@/lib/relationship-action-due-date";
import {
  getJobDetail,
  type ContactSummary,
  type InteractionRow,
  type JobDetail,
  type PendingChangeRow,
} from "@/lib/ops/job-detail-data";
import { requireOperatorAccess } from "@/lib/operator-access";

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

function shortId(value: string) {
  return value.slice(0, 8);
}

function proposalReviewLane(change: PendingChangeRow) {
  const detailedReview =
    change.change_type === "new_contact" ||
    change.change_type === "want_to_know_candidate" ||
    change.risk_level === "high";

  return reviewLane(change, { detailedReview });
}

function ProposalQualitySummary({ change }: { change: PendingChangeRow }) {
  const cleanup = qualityCleanupDetails(change.payload);
  if (!isQualityCleanupChange(change)) return null;

  const proposed = cleanup.proposedFieldLabel ?? cleanup.proposedField;

  return (
    <>
      <span>
        Cleanup lane: {proposed ? `proposed ${proposed}` : "proposal ready"}
        {cleanup.jobId ? ` · job ${shortId(cleanup.jobId)}` : ""}
        {cleanup.fieldNeedsOwnerVerification ? " · owner verified" : ""}
      </span>
      {cleanup.missingFieldsReviewed.length > 0 ? (
        <span>Reviewed gaps: {cleanup.missingFieldsReviewed.join(", ")}</span>
      ) : null}
      {cleanup.leftBlank.length > 0 ? (
        <span>Left blank: {cleanup.leftBlank.join("; ")}</span>
      ) : null}
      {cleanup.blockedFields.length > 0 ? (
        <span>Still blocked: {cleanup.blockedFields.join(", ")}</span>
      ) : null}
    </>
  );
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

function textValue(value: unknown, fallback = "Not stored") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function listValue(value: unknown) {
  return Array.isArray(value) && value.length > 0
    ? value.map(String).join(", ")
    : "Nothing stored";
}

function readinessValue(value: unknown) {
  return typeof value === "number" ? `${value}% ready` : "Unknown";
}

function commandOutput(result: Record<string, unknown>) {
  if (typeof result.command_output === "string" && result.command_output.trim()) {
    return result.command_output.trim();
  }

  if (typeof result.summary === "string" && result.summary.trim()) {
    return result.summary.trim();
  }

  if (typeof result.last_error === "string" && result.last_error.trim()) {
    return result.last_error.trim();
  }

  return "No command output has been recorded yet.";
}

function hasCommandOutput(result: Record<string, unknown>) {
  return (
    (typeof result.command_output === "string" && result.command_output.trim().length > 0) ||
    (typeof result.summary === "string" && result.summary.trim().length > 0)
  );
}

function defaultActionTitle(command: Record<string, unknown>, contact: ContactSummary | null) {
  const label =
    typeof command.label === "string" && command.label.trim()
      ? command.label.trim()
      : "Relationship command";
  return contact?.full_name ? `${label} for ${contact.full_name}` : label;
}

function commandActionRecommendation(
  command: Record<string, unknown> | null,
  job: JobDetail,
  contact: ContactSummary | null,
) {
  return commandOutputActionRecommendation({
    commandIntent: typeof command?.intent === "string" ? command.intent : null,
    commandLabel: typeof command?.label === "string" ? command.label : null,
    contactName: contact?.full_name ?? null,
    commandOutput: commandOutput(job.result),
    verificationSummary:
      typeof job.result.verification_summary === "string"
        ? job.result.verification_summary
        : null,
    followUpNeeded:
      typeof job.result.follow_up_needed === "string" ? job.result.follow_up_needed : null,
  });
}

function acceptanceState({
  interactions,
  job,
  pendingChanges,
}: {
  interactions: InteractionRow[];
  job: JobDetail;
  pendingChanges: PendingChangeRow[];
}) {
  if (job.status === "queued") {
    return {
      label: "Not started",
      tone: "pill gold",
      detail: "Claude has not claimed this cleanup job yet.",
      href: `/ops/jobs/${job.id}/handoff`,
      action: "Open handoff",
    };
  }

  if (job.status === "running") {
    return {
      label: "Awaiting return",
      tone: "pill hot",
      detail: "Paste Claude's success or blocked JSON into the handoff console.",
      href: `/ops/jobs/${job.id}/handoff`,
      action: "Return job",
    };
  }

  if (job.status === "failed") {
    return {
      label: "Blocked",
      tone: "pill warn",
      detail:
        "Resolve the blocker or owner-verification question before retrying this job.",
      href: `/ops/jobs/${job.id}/handoff`,
      action: "Inspect blocker",
    };
  }

  const pending = pendingChanges.filter((change) => change.status === "pending");
  if (pending.length > 0) {
    return {
      label: "Review needed",
      tone: "pill warn",
      detail: `${pending.length} proposal${pending.length === 1 ? "" : "s"} must be reviewed before the Book changes.`,
      href: "/changes",
      action: "Review changes",
    };
  }

  if (pendingChanges.length > 0 || interactions.length > 0) {
    return {
      label: "Accepted",
      tone: "pill cool",
      detail:
        "The job has recorded outputs and no linked pending proposals remain open.",
      href: "/quality",
      action: "Back to quality",
    };
  }

  return {
    label: "No changes",
    tone: "pill cool",
    detail: "Claude closed this job without creating proposals or interactions.",
    href: "/quality",
    action: "Back to quality",
  };
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="json-box">{JSON.stringify(value ?? {}, null, 2)}</pre>;
}

export default async function OpsJobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ message?: string }>;
}) {
  const operatorContext = await requireOperatorAccess();
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const {
    setupMode,
    job,
    contact,
    audit,
    usage,
    pendingChanges,
    interactions,
    commandActions,
  } =
    await getJobDetail({ id, context: operatorContext });

  if (setupMode) {
    return (
      <>
        <div className="crumb">Ops</div>
        <h1 className="portal-title">Job inspector</h1>
        <div className="notice">Setup mode is waiting for the private database.</div>
      </>
    );
  }

  if (!job) {
    return (
      <>
        <div className="crumb">Ops</div>
        <h1 className="portal-title">Job inspector</h1>
        <div className="empty-state">That job is no longer available.</div>
        <div className="actions">
          <Link className="button ghost" href="/ops">
            Back to Ops
          </Link>
        </div>
      </>
    );
  }

  const quality = qualityFocus(job.payload);
  const command = commandFocus(job.payload);
  const acceptance = acceptanceState({ interactions, job, pendingChanges });
  const recommendedAction = commandActionRecommendation(command, job, contact);
  const recommendedActionDueOn = suggestedRelationshipActionDueDate({
    priority: recommendedAction.priority,
    type: recommendedAction.actionType,
  });
  const recommendedActionEvidence = [
    typeof command?.label === "string" ? command.label : "Claude command output",
    typeof job.result.verification_summary === "string"
      ? job.result.verification_summary
      : null,
    typeof job.result.follow_up_needed === "string" ? job.result.follow_up_needed : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const dismissal = commandOutputDismissal(job.result);
  const openPendingChanges = pendingChanges.filter((change) => change.status === "pending");
  const jobOutcome = buildJobOutcome({
    jobId: job.id,
    jobStatus: job.status,
    hasCommand: Boolean(command),
    hasCommandOutput: hasCommandOutput(job.result),
    commandOutputDismissed: Boolean(dismissal),
    commandOutputDismissedReason: dismissal?.reason ?? null,
    pendingChangeCount: pendingChanges.length,
    openPendingChangeCount: openPendingChanges.length,
    interactionCount: interactions.length,
    commandActionCount: commandActions.length,
    contactId: contact?.id ?? null,
    recommendedActionTitle: recommendedAction.title,
  });

  return (
    <>
      <div className="crumb">Ops</div>
      <h1 className="portal-title">Job inspector</h1>
      <p className="lede">
        Review what Claude returned, verify the recorded side effects, and accept
        or dismiss any relationship action that still needs an operator decision.
      </p>

      {query.message ? <div className="notice">{query.message}</div> : null}

      <section className="priority-board" aria-label="Handoff outcome">
        <div className="priority-lead">
          <span className={`pill ${jobOutcome.tone}`}>{jobOutcome.eyebrow}</span>
          <h2>{jobOutcome.title}</h2>
          <p className="muted">{jobOutcome.detail}</p>
          <div className="actions">
            <Link className="button hot" href={jobOutcome.primaryHref}>
              {jobOutcome.primaryLabel}
            </Link>
            {jobOutcome.secondaryHref && jobOutcome.secondaryLabel ? (
              <Link className="button ghost" href={jobOutcome.secondaryHref}>
                {jobOutcome.secondaryLabel}
              </Link>
            ) : null}
          </div>
        </div>
        <div className="priority-list">
          <div className="priority-item">
            <span className={acceptance.tone}>{acceptance.label}</span>
            <b>Acceptance</b>
            <span>{acceptance.detail}</span>
          </div>
          <div className="priority-item">
            <span className={command ? "pill hot" : "pill cool"}>
              {command ? "Command" : "Standard"}
            </span>
            <b>{command ? textValue(command.label, "Relationship command") : job.job_type}</b>
            <span>
              {command
                ? textValue(command.intent, "custom").replaceAll("_", " ")
                : "No relationship command focus stored."}
            </span>
          </div>
        </div>
        <div className="priority-metrics" aria-label="Handoff outcome counts">
          <div>
            <span>Open review</span>
            <b>{openPendingChanges.length}</b>
            <small>Pending proposals</small>
          </div>
          <div>
            <span>Actions</span>
            <b>{commandActions.length}</b>
            <small>Movement captured</small>
          </div>
          <div>
            <span>Interactions</span>
            <b>{interactions.length}</b>
            <small>Logged records</small>
          </div>
          <div>
            <span>Output</span>
            <b>{hasCommandOutput(job.result) ? "Yes" : "No"}</b>
            <small>Claude result</small>
          </div>
        </div>
      </section>

      <section className="statband" aria-label="Job status">
        <div className="stat">
          <div className="number">{job.status}</div>
          <div className="label">Status</div>
        </div>
        <div className="stat">
          <div className="number">{job.attempts}</div>
          <div className="label">Attempts</div>
        </div>
        <div className="stat">
          <div className="number">{pendingChanges.length}</div>
          <div className="label">Proposals</div>
        </div>
        <div className="stat">
          <div className="number">{interactions.length}</div>
          <div className="label">Interactions</div>
        </div>
      </section>

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
            <span className="k">Run after</span>
            <span>{formatDate(job.run_after)}</span>
          </div>
          <div className="kv">
            <span className="k">Locked</span>
            <span>{formatDate(job.locked_at)}</span>
          </div>
        </section>

        <section className="card">
          <h2>Contact</h2>
          {contact ? (
            <>
              <div className="kv">
                <span className="k">Name</span>
                <span>{contact.full_name}</span>
              </div>
              <div className="kv">
                <span className="k">Company</span>
                <span>{contact.company_name ?? "Not set"}</span>
              </div>
              <div className="kv">
                <span className="k">Email</span>
                <span>{contact.email ?? "Not set"}</span>
              </div>
              <div className="actions">
                <Link className="button ghost small" href={`/contacts/${contact.id}`}>
                  Open contact
                </Link>
              </div>
            </>
          ) : (
            <p className="muted">No linked contact was found for this job.</p>
          )}
        </section>
      </div>

      {quality ? (
        <div className="grid two">
          <section className="card">
            <h2>Quality cleanup focus</h2>
            <div className="kv">
              <span className="k">Readiness</span>
              <span>{readinessValue(quality.readiness)}</span>
            </div>
            <div className="kv">
              <span className="k">Missing</span>
              <span>{listValue(quality.missing)}</span>
            </div>
            <div className="kv">
              <span className="k">Next step</span>
              <span>{String(quality.next_step ?? "No next step stored.")}</span>
            </div>
            <div className="kv">
              <span className="k">Owner verification</span>
              <span>
                {quality.owner_verification_required === true ? "Required" : "Not required"}
              </span>
            </div>
            <p className="source-note">
              Claude receives this focus when claiming the job. Any trust,
              relationship-strength, referral, private-note, or uncertain updates
              should become pending changes rather than direct writes.
            </p>
          </section>

          <section className="card">
            <h2>Acceptance readiness</h2>
            <div className="kv">
              <span className="k">State</span>
              <span className={acceptance.tone}>{acceptance.label}</span>
            </div>
            <div className="kv">
              <span className="k">Decision</span>
              <span>{acceptance.detail}</span>
            </div>
            <div className="actions">
              <Link className="button hot small" href={acceptance.href}>
                {acceptance.action}
              </Link>
              {pendingChanges.length > 0 ? (
                <Link className="button ghost small" href="/changes">
                  Proposal queue
                </Link>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {command ? (
        <div className="grid two">
          <section className="card">
            <h2>Relationship command</h2>
            <div className="kv">
              <span className="k">Label</span>
              <span>{textValue(command.label, "Relationship command")}</span>
            </div>
            <div className="kv">
              <span className="k">Intent</span>
              <span>{textValue(command.intent, "custom").replaceAll("_", " ")}</span>
            </div>
            <div className="kv">
              <span className="k">Objective</span>
              <span>{textValue(command.objective)}</span>
            </div>
            <div className="kv">
              <span className="k">Primary move</span>
              <span>{textValue(command.primary_move)}</span>
            </div>
            <div className="kv">
              <span className="k">Expected outputs</span>
              <span>{listValue(command.expected_outputs)}</span>
            </div>
            <div className="kv">
              <span className="k">Owner verification</span>
              <span>
                {command.owner_verification_required === true ? "Required" : "Not required"}
              </span>
            </div>
          </section>

          <section className="card">
            <h2>Command result</h2>
            <div className="kv">
              <span className="k">Outcome</span>
              <span>{textValue(job.result.outcome, job.status)}</span>
            </div>
            <div className="kv">
              <span className="k">Output</span>
              <span>{commandOutput(job.result)}</span>
            </div>
            <div className="kv">
              <span className="k">Verification</span>
              <span>{textValue(job.result.verification_summary)}</span>
            </div>
            <div className="kv">
              <span className="k">Follow-up</span>
              <span>{textValue(job.result.follow_up_needed, "No follow-up stored")}</span>
            </div>
            <div className="actions">
              {contact ? (
                <Link className="button ghost small" href={`/contacts/${contact.id}`}>
                  Contact command center
                </Link>
              ) : null}
              {pendingChanges.length > 0 ? (
                <Link className="button hot small" href="/changes">
                  Review proposals
                </Link>
              ) : null}
            </div>
          </section>

          <section className="card" id="track-action">
            <h2>Track as action</h2>
            {commandActions.length > 0 ? (
              <div className="mini-list">
                {commandActions.map((action) => (
                  <div className="mini-item dense" key={action.id}>
                    <div className="mini-item-head">
                      <b>{action.title}</b>
                      <span className={action.status === "open" ? "pill hot" : "pill cool"}>
                        {action.status}
                      </span>
                    </div>
                    <span>
                      {action.action_type.replaceAll("_", " ")} · {action.priority} · Due{" "}
                      {formatDate(action.due_on)}
                    </span>
                    {action.notes ? <span>{action.notes}</span> : null}
                    {contact ? (
                      <Link className="button ghost small" href={`/contacts/${contact.id}`}>
                        Open contact actions
                      </Link>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : dismissal ? (
              <div className="empty-state">
                Dismissed as no action needed
                {dismissal.reason ? (
                  <>
                    <br />
                    {dismissal.reason}
                  </>
                ) : null}
              </div>
            ) : job.status === "succeeded" && hasCommandOutput(job.result) ? (
              <div className="mini-list">
                {contact ? (
                  <form action={createRelationshipActionFromCommandJob} className="stacked-form">
                    <input name="job_id" type="hidden" value={job.id} />
                    <input name="source_ref" type="hidden" value={`job:${job.id}`} />
                    <input
                      name="evidence_summary"
                      type="hidden"
                      value={recommendedActionEvidence}
                    />
                    <div className="empty-state">
                      Recommended movement item: <b>{recommendedAction.title}</b>
                      <br />
                      {recommendedAction.actionType.replaceAll("_", " ")} ·{" "}
                      {recommendedAction.priority}
                      {recommendedActionEvidence ? (
                        <>
                          <br />
                          {recommendedActionEvidence}
                        </>
                      ) : null}
                    </div>
                    <label className="field">
                      <span>Action title</span>
                      <input
                        defaultValue={
                          recommendedAction.title || defaultActionTitle(command, contact)
                        }
                        name="title"
                        type="text"
                      />
                    </label>
                    <div className="form-grid">
                      <label className="field">
                        <span>Type</span>
                        <select defaultValue={recommendedAction.actionType} name="action_type">
                          <option value="claude_draft">Claude draft</option>
                          <option value="follow_up">Follow up</option>
                          <option value="owner_verification">Owner verification</option>
                          <option value="referral">Referral</option>
                          <option value="podcast">Podcast</option>
                          <option value="introduction">Introduction</option>
                          <option value="other">Other</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Priority</span>
                        <select defaultValue={recommendedAction.priority} name="priority">
                          <option value="normal">Normal</option>
                          <option value="high">High</option>
                          <option value="low">Low</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Due</span>
                        <input defaultValue={recommendedActionDueOn} name="due_on" type="date" />
                      </label>
                    </div>
                    <label className="field">
                      <span>Notes</span>
                      <textarea
                        defaultValue={recommendedAction.notes || commandOutput(job.result)}
                        name="notes"
                        rows={5}
                      />
                    </label>
                    <button className="button hot" type="submit">
                      Create tracked action
                    </button>
                  </form>
                ) : (
                  <p className="muted">
                    This command output has no linked contact, so it cannot become a
                    relationship action.
                  </p>
                )}
                <form action={dismissCommandOutputJob} className="stacked-form">
                  <input name="job_id" type="hidden" value={job.id} />
                  <label className="field">
                    <span>No-action reason</span>
                    <textarea
                      name="dismiss_reason"
                      placeholder="Why should this output create no relationship action?"
                      required
                      rows={3}
                    />
                  </label>
                  <button className="button ghost" type="submit">
                    Mark no action needed
                  </button>
                </form>
              </div>
            ) : (
              <p className="muted">
                Complete this command with a saved output before creating a tracked
                relationship action.
              </p>
            )}
          </section>
        </div>
      ) : null}

      <details className="card operator-evidence">
        <summary>Show raw job payload and result</summary>
        <p className="source-note">
          Raw job inputs and outputs are kept here for troubleshooting and audit.
        </p>
        <div className="grid two">
          <section>
            <h2>Payload</h2>
            <JsonBlock value={job.payload} />
          </section>
          <section>
            <h2>Result</h2>
            <JsonBlock value={job.result} />
          </section>
        </div>
      </details>

      <div className="grid two">
        <section className="card">
          <h2>Created proposals</h2>
          {pendingChanges.length > 0 ? (
            <div className="mini-list">
              {pendingChanges.map((change) => (
                <div className="mini-item" key={change.id}>
                  <b>{change.summary}</b>
                  <span>
                    {change.change_type} · {change.status} ·{" "}
                    {change.risk_level ?? "low"} · {formatDate(change.created_at)}
                  </span>
                  <span>Lane: {proposalReviewLane(change)}</span>
                  <ProposalQualitySummary change={change} />
                  <div className="review-actions">
                    <Link className="button ghost small" href={`/changes/${change.id}`}>
                      Review
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No pending changes were created by this job.</p>
          )}
        </section>

        <section className="card">
          <h2>Created interactions</h2>
          {interactions.length > 0 ? (
            <div className="mini-list">
              {interactions.map((interaction) => (
                <div className="mini-item" key={interaction.id}>
                  <b>{interaction.title ?? interaction.interaction_type}</b>
                  <span>
                    {interaction.interaction_type} · {formatDate(interaction.occurred_at)}
                  </span>
                  <span>{interaction.summary}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No interactions were created by this job.</p>
          )}
        </section>
      </div>

      <div className="grid two">
        <section className="card">
          <h2>Audit trail</h2>
          {audit.length > 0 ? (
            <div className="mini-list">
              {audit.map((row) => (
                <div className="mini-item" key={row.id}>
                  <b>{row.action}</b>
                  <span>
                    {row.actor_type} · {formatDate(row.created_at)} ·{" "}
                    {shortId(row.id)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No audit records are linked to this job.</p>
          )}
        </section>

        <section className="card">
          <h2>Usage events</h2>
          {usage.length > 0 ? (
            <div className="mini-list">
              {usage.map((event) => (
                <div className="mini-item" key={event.id}>
                  <b>{event.event_type}</b>
                  <span>
                    {event.actor_type} · {event.quantity} {event.unit} ·{" "}
                    {formatDate(event.created_at)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No usage events are linked to this job.</p>
          )}
        </section>
      </div>

      <div className="actions">
        <Link className="button primary" href={`/ops/jobs/${job.id}/handoff`}>
          Open Claude handoff
        </Link>
        <Link className="button ghost" href="/ops">
          Back to Ops
        </Link>
      </div>
    </>
  );
}
