import Link from "next/link";
import { buildOpsCommandCenter } from "@/lib/ops-command-center";
import { buildOpsHandoffInbox } from "@/lib/ops-handoff-inbox";
import {
  jobBlockedOn,
  jobOrigin,
  originLabel,
  pipelineStats,
} from "@/lib/ops-pipeline";
import { buildOpsRiskSummary } from "@/lib/ops-risk";
import { buildInstallAcceptanceSummary } from "@/lib/install-acceptance";
import { requireOperatorAccess } from "@/lib/operator-access";
import { getOpsData, type ContactOption, type JobRow } from "@/lib/ops/data";
import {
  claimTestEnrichmentJob,
  completeTestEnrichmentJob,
  createTestCommandJob,
  createTestEnrichmentJob,
  failTestEnrichmentJob,
  submitLowRiskAcceptanceProposal,
  submitDryRunEnrichmentProposal,
} from "./actions";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortId(value: string) {
  return value.slice(0, 8);
}

function jobContactId(job: { payload: Record<string, unknown> }) {
  return typeof job.payload.contact_id === "string"
    ? job.payload.contact_id
    : null;
}

function hoursSince(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 3_600_000));
}

function staleRunningJobs(jobs: JobRow[]) {
  return jobs.filter((job) => {
    if (job.status !== "running") return false;
    const lockedHours = hoursSince(job.locked_at ?? job.created_at);
    return lockedHours !== null && lockedHours >= 4;
  });
}

function isQualityCleanupJob(job: JobRow) {
  return job.payload.trigger === "quality_cleanup";
}

function contactLabel(contactId: string | null, contacts: ContactOption[]) {
  if (!contactId) return "No contact linked";
  const contact = contacts.find((item) => item.id === contactId);
  if (!contact) return contactId;
  return [contact.full_name, contact.company_name].filter(Boolean).join(" / ");
}

function qualityFocus(job: JobRow) {
  const focus = job.payload.quality_focus;
  if (!focus || typeof focus !== "object" || Array.isArray(focus)) {
    return null;
  }

  return focus as Record<string, unknown>;
}

function qualityReadiness(job: JobRow) {
  const readiness = qualityFocus(job)?.readiness;
  return typeof readiness === "number" ? `${readiness}% ready` : "Readiness unknown";
}

function qualityMissing(job: JobRow) {
  const missing = qualityFocus(job)?.missing;
  if (!Array.isArray(missing)) return "No quality focus stored";
  return missing.map(String).slice(0, 4).join(", ") || "Nothing obvious";
}

function commandFocus(job: JobRow) {
  const focus = job.payload.command_focus;
  if (!focus || typeof focus !== "object" || Array.isArray(focus)) {
    return null;
  }

  return focus as Record<string, unknown>;
}

function testJobLabel(job: JobRow) {
  const command = commandFocus(job);
  if (typeof command?.label === "string") return command.label;
  return "Enrichment test";
}

function commandLabel(job: JobRow) {
  const command = commandFocus(job);
  return typeof command?.label === "string" ? command.label : "Relationship command";
}

function commandIntent(job: JobRow) {
  const command = commandFocus(job);
  return typeof command?.intent === "string"
    ? command.intent.replaceAll("_", " ")
    : "command";
}

function commandOutput(job: JobRow) {
  const output = job.result.command_output;
  if (typeof output === "string" && output.trim()) return output.trim();
  return jobSummary(job);
}

function jobOutcome(job: JobRow) {
  const outcome = job.result.outcome;
  if (typeof outcome === "string") return outcome.replaceAll("_", " ");

  if (job.status === "failed") {
    const blockedOn = job.result.blocked_on;
    return typeof blockedOn === "string"
      ? `blocked: ${blockedOn.replaceAll("_", " ")}`
      : "failed";
  }

  if (job.status === "queued" && job.result.last_error) return "retry scheduled";
  if (job.status === "running") return "in handoff";
  return "no outcome yet";
}

function jobSummary(job: { result: Record<string, unknown> }) {
  const summary = job.result.summary;
  if (typeof summary === "string" && summary.trim()) return summary;

  const lastError = job.result.last_error;
  if (typeof lastError === "string" && lastError.trim()) return lastError;

  const createdFrom = job.result.created_from;
  if (typeof createdFrom === "string" && createdFrom.trim()) {
    return `Created from ${createdFrom.replaceAll("_", " ")}.`;
  }

  return "No result summary recorded yet.";
}

function statusPillClass(status: string) {
  if (status === "running") return "pill hot";
  if (status === "queued") return "pill gold";
  if (status === "succeeded") return "pill cool";
  if (status === "failed") return "pill warn";
  return "pill";
}

function acceptancePillClass(status: "pass" | "action" | "waiting") {
  if (status === "pass") return "pill cool";
  if (status === "action") return "pill hot";
  return "pill gold";
}

function commandPillClass(tone: "ok" | "warn" | "neutral") {
  if (tone === "ok") return "pill cool";
  if (tone === "warn") return "pill warn";
  return "pill gold";
}

function phasePillClass(status: "ready" | "action" | "waiting") {
  if (status === "ready") return "pill cool";
  if (status === "action") return "pill hot";
  return "pill gold";
}

function metricClass(tone: "ok" | "warn" | "neutral") {
  if (tone === "ok") return "status-ok";
  if (tone === "warn") return "status-warn";
  return "status-neutral";
}

export default async function OpsPage({
  searchParams,
}: {
  searchParams?: Promise<{ message?: string }>;
}) {
  const context = await requireOperatorAccess();
  const params = searchParams ? await searchParams : {};
  const {
    setupMode,
    audit,
    usage,
    pending,
    jobs,
    contacts,
    acceptanceChanges,
    provenance,
    pendingCount,
    claudeWriteCount,
    queuedJobCount,
    overdueQueue,
    reviewQueue,
    loadHealth,
  } = await getOpsData(context);
  const testJobs = jobs.filter((job) => job.payload.test_mode === true);
  const runningTestJobs = testJobs.filter((job) => job.status === "running");
  const activeTestJobs = testJobs.filter((job) =>
    ["queued", "running"].includes(job.status),
  );
  const latestTestJobs = testJobs.slice(0, 3);
  const qualityJobs = jobs.filter(isQualityCleanupJob);
  const activeQualityJobs = qualityJobs.filter((job) =>
    ["queued", "running"].includes(job.status),
  );
  const latestQualityJobs = qualityJobs.slice(0, 8);
  const qualityQueued = qualityJobs.filter((job) => job.status === "queued").length;
  const qualityRunning = qualityJobs.filter((job) => job.status === "running").length;
  const qualitySucceeded = qualityJobs.filter((job) => job.status === "succeeded").length;
  const qualityFailed = qualityJobs.filter((job) => job.status === "failed").length;
  const commandJobs = jobs.filter((job) => commandFocus(job));
  const activeCommandJobs = commandJobs.filter((job) =>
    ["queued", "running"].includes(job.status),
  );
  const recentCommandJobs = commandJobs.slice(0, 8);
  const commandSucceeded = commandJobs.filter((job) => job.status === "succeeded").length;
  const commandFailed = commandJobs.filter((job) => job.status === "failed").length;
  const pipeline = pipelineStats({ jobs, pendingChanges: pending });
  const opsRisk = buildOpsRiskSummary({
    audit,
    usage,
    pending,
    jobs,
    overdueQueue,
    readHealth: {
      complete: !loadHealth.hasFailures,
      failedLabels: loadHealth.failed.map((item) => item.label),
    },
  });
  const staleJobs = staleRunningJobs(jobs);
  const acceptance = buildInstallAcceptanceSummary({
    contactCount: contacts.length,
    jobs,
    changes: acceptanceChanges,
    audit,
    provenance,
  });
  const commandCenter = buildOpsCommandCenter({
    contactCount: contacts.length,
    jobs,
    pending,
    acceptance,
    pipeline,
    risk: opsRisk,
  });
  const handoffInbox = buildOpsHandoffInbox({
    jobs,
    pendingChanges: pending,
  });
  const tenantId =
    contacts.find((contact) => contact.tenant_id)?.tenant_id ??
    testJobs.find((job) => job.tenant_id)?.tenant_id ??
    "";

  return (
    <>
      <div className="crumb">Ops</div>
      <h1 className="portal-title">Operations</h1>
      <p className="lede">
        Claude writes, review backlog, usage events, and audit activity in one
        place so failures and drift do not hide in the machinery.
      </p>

      {setupMode ? (
        <div className="notice">Setup mode is waiting for the private database.</div>
      ) : null}

      {params.message ? <div className="notice">{params.message}</div> : null}

      {loadHealth.notice ? <div className="notice">{loadHealth.notice}</div> : null}

      <section className="statband" aria-label="Operations stats">
        <div className="stat">
          <div className="number">{pendingCount ?? "Unknown"}</div>
          <div className="label">Pending changes</div>
        </div>
        <div className="stat">
          <div className="number">{claudeWriteCount}</div>
          <div className="label">Claude events</div>
        </div>
        <div className="stat">
          <div className="number">{queuedJobCount ?? "Unknown"}</div>
          <div className="label">Queued jobs</div>
        </div>
        <div className="stat">
          <div
            className={`number ${
              overdueQueue.state !== "complete" ||
              (overdueQueue.overdueProductionCount ?? 0) > 0
                ? "status-warn"
                : "status-ok"
            }`}
          >
            {overdueQueue.state === "complete"
              ? overdueQueue.overdueProductionCount
              : "Unknown"}
          </div>
          <div className="label">Overdue queued jobs</div>
        </div>
      </section>

      <div className="section-label">Command center</div>
      <section className="priority-board" aria-label="Claude command center">
        <div className="priority-lead">
          <span className={commandPillClass(commandCenter.tone)}>
            {commandCenter.status}
          </span>
          <h2>{commandCenter.headline}</h2>
          <p className="muted">{commandCenter.detail}</p>
          <div className="actions">
            <Link className="button hot" href={commandCenter.href}>
              {commandCenter.actionLabel}
            </Link>
            <Link className="button ghost" href="/claude-setup">
              Claude setup
            </Link>
          </div>
        </div>
        <div className="priority-list">
          {commandCenter.phases.map((phase) => (
            <Link className="priority-item link-quiet" href={phase.href} key={phase.label}>
              <span className={phasePillClass(phase.status)}>
                {phase.status === "ready"
                  ? "ready"
                  : phase.status === "action"
                    ? "action"
                    : "waiting"}
              </span>
              <b>{phase.label}</b>
              <span>{phase.detail}</span>
            </Link>
          ))}
        </div>
        <div className="priority-metrics">
          {commandCenter.metrics.map((metric) => (
            <div key={metric.label}>
              <span>{metric.label}</span>
              <b className={metricClass(metric.tone)}>{metric.value}</b>
              <small>{metric.detail}</small>
            </div>
          ))}
        </div>
      </section>

      <div className="grid four">
        {commandCenter.runbook.map((step) => (
          <Link
            className="lane-card command-step link-quiet"
            href={step.href}
            key={step.label}
          >
            <span className="pill gold">{step.label}</span>
            <p>{step.detail}</p>
          </Link>
        ))}
      </div>

      <div className="section-label">Handoff inbox</div>
      <section className="priority-board" aria-label="Operator handoff inbox">
        <div className="priority-lead">
          <span
            className={
              handoffInbox.nextItem && handoffInbox.nextItem.lane !== "closed"
                ? `pill ${handoffInbox.nextItem.tone}`
                : "pill cool"
            }
          >
            {handoffInbox.nextItem && handoffInbox.nextItem.lane !== "closed"
              ? "Action"
              : "Clear"}
          </span>
          <h2>{handoffInbox.nextItem?.title ?? "No handoffs need attention"}</h2>
          <p className="muted">
            {handoffInbox.nextItem?.detail ??
              "Queued, running, review, and capture lanes are clear."}
          </p>
          <div className="actions">
            {handoffInbox.nextItem ? (
              <Link className="button hot" href={handoffInbox.nextItem.href}>
                {handoffInbox.nextItem.actionLabel}
              </Link>
            ) : (
              <Link className="button hot" href="/contacts">
                Queue relationship work
              </Link>
            )}
            <Link className="button ghost" href="/changes">
              Review queue
            </Link>
          </div>
        </div>
        <div className="priority-list">
          {handoffInbox.lanes.map((lane) => (
            <Link
              className="priority-item link-quiet"
              href={lane.items[0]?.href ?? "/ops"}
              key={lane.key}
            >
              <span className={lane.items.length > 0 ? "pill hot" : "pill cool"}>
                {lane.items.length}
              </span>
              <b>{lane.label}</b>
              <span>{lane.detail}</span>
            </Link>
          ))}
        </div>
        <div className="priority-metrics">
          <div>
            <span>Return</span>
            <b>{handoffInbox.counts.needs_return}</b>
            <small>Claim, return, or unblock.</small>
          </div>
          <div>
            <span>Review</span>
            <b>{handoffInbox.counts.needs_review}</b>
            <small>Linked proposals waiting.</small>
          </div>
          <div>
            <span>Capture</span>
            <b>{handoffInbox.counts.needs_capture}</b>
            <small>Command outputs untracked.</small>
          </div>
          <div>
            <span>Closed</span>
            <b>{handoffInbox.counts.closed}</b>
            <small>Recently settled jobs.</small>
          </div>
        </div>
      </section>

      <div className="grid four">
        {handoffInbox.lanes.map((lane) => (
          <section
            className={`lane-card command-step ${lane.items.length === 0 ? "disabled" : ""}`}
            key={lane.key}
          >
            <span className={lane.items.length > 0 ? "pill gold" : "pill cool"}>
              {lane.items.length}
            </span>
            <h3>{lane.label}</h3>
            <p>{lane.detail}</p>
            {lane.items.length > 0 ? (
              <div className="mini-list compact">
                {lane.items.slice(0, 4).map((item) => (
                  <Link
                    className="mini-item dense link-quiet"
                    href={item.href}
                    key={item.key}
                  >
                    <div className="mini-item-head">
                      <b>{item.title}</b>
                      <span className={`pill ${item.tone}`}>{item.actionLabel}</span>
                    </div>
                    <span>{item.detail}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <span>No jobs in this lane.</span>
            )}
          </section>
        ))}
      </div>

      <div className="section-label">Review queue inventory</div>
      <section className="priority-board" aria-label="Pending review queue inventory">
        <div className="priority-lead">
          <span
            className={
              reviewQueue.state !== "complete" ||
              (reviewQueue.actionableCount ?? 0) > 0
                ? "pill hot"
                : "pill cool"
            }
          >
            {reviewQueue.state === "complete"
              ? `${reviewQueue.actionableCount} blocking`
              : "Unknown"}
          </span>
          <h2>
            {reviewQueue.state === "complete"
              ? "Every pending proposal has a lane"
              : "Review queue could not be reconciled"}
          </h2>
          <p className="muted">
            {reviewQueue.state === "complete"
              ? `${reviewQueue.excludedCount} controlled-test or replaced item${
                  reviewQueue.excludedCount === 1 ? " is" : "s are"
                } excluded from handoff readiness. No item is approved from this view.`
              : reviewQueue.reason}
          </p>
          <div className="actions">
            <Link className="button hot" href="/changes">
              Open Changes
            </Link>
          </div>
        </div>
        <div className="priority-list">
          {reviewQueue.lanes
            .filter((lane) => lane.blocking)
            .map((lane) => (
              <Link className="priority-item link-quiet" href={lane.href} key={lane.key}>
                <span className={lane.count > 0 ? "pill hot" : "pill cool"}>
                  {reviewQueue.state === "complete" ? lane.count : "Unknown"}
                </span>
                <b>{lane.label}</b>
                <span>{lane.detail}</span>
              </Link>
            ))}
        </div>
        <div className="priority-metrics">
          <div>
            <span>Total pending</span>
            <b>{reviewQueue.totalCount ?? "Unknown"}</b>
          </div>
          <div>
            <span>Blocks handoff</span>
            <b>{reviewQueue.actionableCount ?? "Unknown"}</b>
          </div>
          <div>
            <span>Excluded artifacts</span>
            <b>{reviewQueue.excludedCount ?? "Unknown"}</b>
          </div>
          <div>
            <span>Oldest blocker</span>
            <b>
              {reviewQueue.oldestActionableAt
                ? formatDate(reviewQueue.oldestActionableAt)
                : reviewQueue.state === "complete"
                  ? "None"
                  : "Unknown"}
            </b>
          </div>
        </div>
      </section>

      <div className="section-label">Relationship command jobs</div>
      <section className="priority-board" aria-label="Relationship command jobs">
        <div className="priority-lead">
          <span className={activeCommandJobs.length > 0 ? "pill hot" : "pill cool"}>
            {activeCommandJobs.length} active
          </span>
          <h2>
            {activeCommandJobs[0]
              ? commandLabel(activeCommandJobs[0])
              : "No command jobs waiting"}
          </h2>
          <p className="muted">
            Drafts, call prep, referral checks, and intro maps queued from contact
            command centers.
          </p>
          <div className="actions">
            {activeCommandJobs[0] ? (
              <Link
                className="button hot"
                href={
                  activeCommandJobs[0].status === "running"
                    ? `/ops/jobs/${activeCommandJobs[0].id}/handoff`
                    : `/ops/jobs/${activeCommandJobs[0].id}`
                }
              >
                Open active command
              </Link>
            ) : (
              <Link className="button hot" href="/contacts">
                Choose a contact
              </Link>
            )}
            <Link className="button ghost" href="/ops">
              Refresh Ops
            </Link>
          </div>
        </div>
        <div className="priority-list">
          {recentCommandJobs.length > 0 ? (
            recentCommandJobs.map((job) => (
              <Link
                className="priority-item link-quiet"
                href={`/ops/jobs/${job.id}`}
                key={job.id}
              >
                <span className={statusPillClass(job.status)}>{job.status}</span>
                <b>{commandLabel(job)}</b>
                <span>
                  {commandIntent(job)} · {contactLabel(jobContactId(job), contacts)}
                </span>
                <span>{commandOutput(job)}</span>
              </Link>
            ))
          ) : (
            <div className="priority-item">
              <span className="pill gold">empty</span>
              <b>No command history yet</b>
              <span>Queue a command from a contact profile to start this lane.</span>
            </div>
          )}
        </div>
        <div className="priority-metrics">
          <div>
            <span>Total</span>
            <b>{commandJobs.length}</b>
            <small>Visible command jobs.</small>
          </div>
          <div>
            <span>Succeeded</span>
            <b>{commandSucceeded}</b>
            <small>Returned command outputs.</small>
          </div>
          <div>
            <span>Failed</span>
            <b>{commandFailed}</b>
            <small>Blocked command jobs.</small>
          </div>
          <div>
            <span>Test</span>
            <b>{commandJobs.filter((job) => job.payload.test_mode === true).length}</b>
            <small>Dry-run command jobs.</small>
          </div>
        </div>
      </section>

      <div className="section-label">Operational risk</div>
      <section className="priority-board" aria-label="Operational risk summary">
        <div className="priority-lead">
          <span className={opsRisk.warningCount > 0 ? "pill warn" : "pill cool"}>
            {opsRisk.warningCount} warning{opsRisk.warningCount === 1 ? "" : "s"}
          </span>
          <h2>{opsRisk.nextAction.label}</h2>
          <p className="muted">{opsRisk.nextAction.detail}</p>
          <div className="actions">
            <Link className="button hot" href={opsRisk.nextAction.href}>
              Open risk item
            </Link>
          </div>
        </div>
        <div className="priority-list">
          {opsRisk.items.slice(0, 5).map((item) => (
            <Link className="priority-item link-quiet" href={item.href} key={item.key}>
              <span
                className={
                  item.tone === "warn"
                    ? "pill warn"
                    : item.tone === "ok"
                      ? "pill cool"
                      : "pill gold"
                }
              >
                {item.tone}
              </span>
              <b>{item.label}</b>
              <span>{item.detail}</span>
            </Link>
          ))}
        </div>
        <div className="priority-metrics">
          <div>
            <span>Audit Rows</span>
            <b>{audit.length}</b>
          </div>
          <div>
            <span>Usage Rows</span>
            <b>{usage.length}</b>
          </div>
          <div>
            <span>Visible Jobs</span>
            <b>{jobs.length}</b>
          </div>
          <div>
            <span>Pending Review</span>
            <b>{pending.length}</b>
          </div>
        </div>
      </section>

      {staleJobs.length > 0 ? (
        <>
          <div className="section-label">Stale handoff recovery</div>
          <section className="card">
            <h2>Running jobs with old locks</h2>
            <div className="mini-list">
              {staleJobs.map((job) => (
                <div className="mini-item" key={job.id}>
                  <div className="mini-item-head">
                    <b>{jobOrigin(job)}</b>
                    <span className="pill warn">
                      {hoursSince(job.locked_at ?? job.created_at)}h locked
                    </span>
                  </div>
                  <span>
                    {job.job_type} · attempt {job.attempts} ·{" "}
                    {contactLabel(jobContactId(job), contacts)}
                  </span>
                  <div className="review-actions">
                    <Link className="button hot small" href={`/ops/jobs/${job.id}/handoff`}>
                      Recover handoff
                    </Link>
                    <Link className="button ghost small" href={`/ops/jobs/${job.id}`}>
                      Inspect job
                    </Link>
                  </div>
                </div>
              ))}
            </div>
            <p className="source-note">
              A stale lock means Claude claimed the job but the handoff did not
              complete. Open the handoff, then complete it, mark it blocked, or
              queue retry from the failure path.
            </p>
          </section>
        </>
      ) : null}

      <div className="section-label">Quality cleanup command</div>
      <section className="priority-board" aria-label="Quality cleanup jobs">
        <div className="priority-lead">
          <span className={activeQualityJobs.length > 0 ? "pill hot" : "pill cool"}>
            {activeQualityJobs.length} active
          </span>
          <h2>
            {activeQualityJobs.length > 0
              ? "Quality cleanup is queued for Claude"
              : "Quality cleanup queue is clear"}
          </h2>
          <p className="muted">
            These are operator-selected records from Data Quality. Claude should
            resolve the stored quality focus, create pending changes for
            judgment fields, and leave uncertain gaps intentionally blank.
          </p>
          <div className="actions">
            <Link className="button hot" href="/quality">
              Queue more cleanup
            </Link>
            <Link className="button ghost" href="/claude-setup">
              Claude claim instructions
            </Link>
          </div>
        </div>
        <div className="priority-list">
          {latestQualityJobs.length > 0 ? (
            latestQualityJobs.map((job) => (
              <Link
                className="priority-item link-quiet"
                href={`/ops/jobs/${job.id}`}
                key={job.id}
              >
                <span className={statusPillClass(job.status)}>{job.status}</span>
                <b>{contactLabel(jobContactId(job), contacts)}</b>
                <span>
                  {qualityReadiness(job)} · missing {qualityMissing(job)}
                </span>
              </Link>
            ))
          ) : (
            <Link className="priority-item link-quiet" href="/quality">
              <span className="pill gold">waiting</span>
              <b>No quality cleanup jobs yet</b>
              <span>Use Data Quality to queue the first batch.</span>
            </Link>
          )}
        </div>
        <div className="priority-metrics">
          <div>
            <span>Queued</span>
            <b>{qualityQueued}</b>
          </div>
          <div>
            <span>Running</span>
            <b>{qualityRunning}</b>
          </div>
          <div>
            <span>Succeeded</span>
            <b>{qualitySucceeded}</b>
          </div>
          <div>
            <span>Failed</span>
            <b className={qualityFailed > 0 ? "status-warn" : "status-ok"}>
              {qualityFailed}
            </b>
          </div>
        </div>
      </section>

      <div className="section-label">Install acceptance</div>
      <section className="priority-board" aria-label="Install acceptance runner">
        <div className="priority-lead">
          <span className={acceptance.ready ? "pill cool" : "pill hot"}>
            {acceptance.completed}/{acceptance.total} passed
          </span>
          <h2>{acceptance.ready ? "Acceptance loop is proven" : acceptance.nextAction.label}</h2>
          <p className="muted">
            {acceptance.ready
              ? "Claude writes, review lanes, audit, provenance, and follow-up queueing have all been exercised for this install."
              : acceptance.nextAction.detail}
          </p>
          <div className="actions">
            <Link className="button hot" href={acceptance.nextAction.href}>
              Open acceptance step
            </Link>
            <Link className="button ghost" href="/launch">
              Launch checklist
            </Link>
          </div>
          <form action={submitLowRiskAcceptanceProposal} className="settings-form">
            <label className="field">
              <span>Low-risk proposal contact</span>
              <select name="contact_id" required>
                <option value="">Choose a contact</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {[contact.full_name, contact.company_name, contact.email]
                      .filter(Boolean)
                      .join(" / ")}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button primary"
              disabled={contacts.length === 0}
              type="submit"
            >
              Create low-risk proposal
            </button>
          </form>
          <p className="source-note">
            This uses the Claude pending-change endpoint and repeats the current
            contact name, so approval proves the write path without adding fake
            relationship context.
          </p>
        </div>
        <div className="priority-list">
          {acceptance.items.map((item) => (
            <Link className="priority-item link-quiet" href={item.href} key={item.key}>
              <span className={acceptancePillClass(item.status)}>
                {item.status}
              </span>
              <b>{item.label}</b>
              <span>{item.detail}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="section-label">Import and enrichment pipeline</div>
      <div className="grid two">
        <article className="card">
          <h2>{pipeline.nextAction.label}</h2>
          <p className="muted">{pipeline.nextAction.detail}</p>
          <div className="actions">
            <Link className="button hot" href={pipeline.nextAction.href}>
              Open next step
            </Link>
          </div>
        </article>

        <article className="card">
          <h2>Pipeline Health</h2>
          <ul className="security-list">
            <li>
              <span>
                Exact overdue production queue
                <small>
                  {overdueQueue.state !== "complete"
                    ? "Observation incomplete; not treated as clear."
                    : overdueQueue.oldestDueAt
                      ? `Oldest due ${formatDate(overdueQueue.oldestDueAt)}.`
                      : "No production job was due at the shared cutoff."}
                </small>
              </span>
              <span
                className={
                  overdueQueue.state !== "complete" ||
                  (overdueQueue.overdueProductionCount ?? 0) > 0
                    ? "status-warn"
                    : "status-ok"
                }
              >
                {overdueQueue.state === "complete"
                  ? overdueQueue.overdueProductionCount
                  : "Unknown"}
              </span>
            </li>
            <li>
              <span>Active production enrichment jobs</span>
              <span className="status-neutral">
                {pipeline.activeProductionJobs.length}
              </span>
            </li>
            <li>
              <span>High-risk review proposals</span>
              <span
                className={
                  pipeline.highRiskPending.length > 0 ? "status-warn" : "status-ok"
                }
              >
                {pipeline.highRiskPending.length}
              </span>
            </li>
            <li>
              <span>Blocked enrichment jobs</span>
              <span
                className={pipeline.blockedJobs.length > 0 ? "status-warn" : "status-ok"}
              >
                {pipeline.blockedJobs.length}
              </span>
            </li>
            <li>
              <span>Recent production jobs visible</span>
              <span className="status-neutral">{pipeline.productionJobs.length}</span>
            </li>
          </ul>
        </article>
      </div>

      <div className="grid three">
        <section>
          <div className="section-label">Source lanes</div>
          <div className="card">
            {pipeline.byOrigin.some((lane) => lane.total > 0) ? (
              <ul className="security-list">
                {pipeline.byOrigin
                  .filter((lane) => lane.total > 0)
                  .map((lane) => (
                    <li key={lane.origin}>
                      <span>
                        <b>{lane.label}</b>
                        <small>
                          queued {lane.queued} · running {lane.running} · done{" "}
                          {lane.succeeded} · blocked {lane.failed}
                        </small>
                      </span>
                      <span className="status-neutral">{lane.total}</span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="muted">
                No production enrichment work has been queued yet.
              </p>
            )}
          </div>
        </section>

        <section>
          <div className="section-label">Active work</div>
          <div className="card">
            {pipeline.activeProductionJobs.length > 0 ? (
              <div className="mini-list">
                {pipeline.activeProductionJobs.slice(0, 6).map((job) => (
                  <div className="mini-item dense" key={job.id}>
                    <div className="mini-item-head">
                      <b>{originLabel(jobOrigin(job))}</b>
                      <span className={statusPillClass(job.status)}>{job.status}</span>
                    </div>
                    <span>
                      {shortId(job.id)} · attempts {job.attempts} · run after{" "}
                      {formatDate(job.run_after)}
                    </span>
                    <span>Contact: {jobContactId(job) ?? "not linked"}</span>
                    <div className="review-actions">
                      <Link className="button ghost small" href={`/ops/jobs/${job.id}`}>
                        Inspect
                      </Link>
                      <Link
                        className="button ghost small"
                        href={`/ops/jobs/${job.id}/handoff`}
                      >
                        Handoff
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No production enrichment jobs are active.</p>
            )}
          </div>
        </section>

        <section>
          <div className="section-label">Review pressure</div>
          <div className="card">
            {pipeline.pendingEnrichmentChanges.length > 0 ? (
              <div className="mini-list">
                {pipeline.pendingEnrichmentChanges.slice(0, 6).map((change) => (
                  <div className="mini-item dense" key={change.id}>
                    <div className="mini-item-head">
                      <b>{change.change_type}</b>
                      <span
                        className={
                          change.risk_level === "high" ? "pill warn" : "pill cool"
                        }
                      >
                        {change.risk_level ?? "low"}
                      </span>
                    </div>
                    <span>
                      {change.source ?? "unknown source"} ·{" "}
                      {formatDate(change.created_at)}
                    </span>
                    <div className="review-actions">
                      <Link className="button ghost small" href={`/changes/${change.id}`}>
                        Review
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">
                No import or enrichment proposals are waiting for review.
              </p>
            )}
          </div>
        </section>
      </div>

      {pipeline.blockedJobs.length > 0 ? (
        <>
          <div className="section-label">Blocked enrichment</div>
          <div className="card">
            <div className="mini-list">
              {pipeline.blockedJobs.slice(0, 5).map((job) => (
                <div className="mini-item" key={job.id}>
                  <div className="mini-item-head">
                    <b>{originLabel(jobOrigin(job))}</b>
                    <span className="pill warn">blocked</span>
                  </div>
                  <span>
                    {shortId(job.id)} · {jobBlockedOn(job) ?? "unclassified"} ·{" "}
                    created {formatDate(job.created_at)}
                  </span>
                  <span>{jobSummary(job)}</span>
                  <div className="review-actions">
                    <Link className="button ghost small" href={`/ops/jobs/${job.id}`}>
                      Inspect
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}

      <div className="grid two">
        <section>
          <div className="section-label">Claude loop test</div>
          <div className="card">
            <form action={createTestEnrichmentJob} className="settings-form">
              <label className="field">
                <span>Create test job for</span>
                <select name="contact_id" required>
                  <option value="">Choose a contact</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {[contact.full_name, contact.company_name, contact.email]
                        .filter(Boolean)
                        .join(" / ")}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button primary" type="submit">
                Create test enrichment job
              </button>
            </form>

            <form action={createTestCommandJob} className="settings-form ops-strip">
              <div className="form-grid two-fields">
                <label className="field">
                  <span>Create test command for</span>
                  <select name="contact_id" required>
                    <option value="">Choose a contact</option>
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {[contact.full_name, contact.company_name, contact.email]
                          .filter(Boolean)
                          .join(" / ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Command</span>
                  <select name="intent" defaultValue="draft_outreach">
                    <option value="draft_outreach">Draft outreach</option>
                    <option value="verify_referral_lane">Verify referral lane</option>
                    <option value="prep_for_call">Prep for call</option>
                    <option value="build_intro_map">Build intro map</option>
                  </select>
                </label>
              </div>
              <button className="button ghost" type="submit">
                Create test command job
              </button>
            </form>

            <div className="review-actions">
              <form action={claimTestEnrichmentJob}>
                <input name="tenant_id" type="hidden" value={tenantId} />
                <button
                  className="button hot"
                  disabled={!tenantId}
                  type="submit"
                >
                  Claim next test job
                </button>
              </form>
            </div>

            {runningTestJobs.length > 0 ? (
              <div className="form-grid three">
                <form
                  action={submitDryRunEnrichmentProposal}
                  className="settings-form"
                >
                  <label className="field">
                    <span>Dry-run proposal</span>
                    <select name="job_id" required>
                      <option value="">Choose job</option>
                      {runningTestJobs.map((job) => (
                        <option key={job.id} value={job.id}>
                          {job.id.slice(0, 8)} / attempts {job.attempts}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="button hot" type="submit">
                    Submit proposal
                  </button>
                </form>
                <form action={completeTestEnrichmentJob} className="settings-form">
                  <label className="field">
                    <span>Complete running test</span>
                    <select name="job_id" required>
                      <option value="">Choose job</option>
                      {runningTestJobs.map((job) => (
                        <option key={job.id} value={job.id}>
                          {job.id.slice(0, 8)} / attempts {job.attempts}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="button ghost" type="submit">
                    Complete no-change
                  </button>
                </form>
                <form action={failTestEnrichmentJob} className="settings-form">
                  <label className="field">
                    <span>Fail running test</span>
                    <select name="job_id" required>
                      <option value="">Choose job</option>
                      {runningTestJobs.map((job) => (
                        <option key={job.id} value={job.id}>
                          {job.id.slice(0, 8)} / attempts {job.attempts}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="button quiet" type="submit">
                    Fail test
                  </button>
                </form>
              </div>
            ) : null}

            {activeTestJobs.length > 0 ? (
              <div className="ops-strip">
                <div className="section-label compact">Active test jobs</div>
                <div className="mini-list">
                  {activeTestJobs.map((job) => (
                    <div className="mini-item dense" key={job.id}>
                      <div className="mini-item-head">
                        <b>{testJobLabel(job)}</b>
                        <span className={statusPillClass(job.status)}>{job.status}</span>
                      </div>
                      <span>
                        {shortId(job.id)} · attempts {job.attempts} · run after{" "}
                        {formatDate(job.run_after)}
                      </span>
                      <span>{jobOutcome(job)}</span>
                      <div className="review-actions">
                        <Link className="button ghost small" href={`/ops/jobs/${job.id}`}>
                          Inspect
                        </Link>
                        <Link
                          className="button ghost small"
                          href={`/ops/jobs/${job.id}/handoff`}
                        >
                          Handoff
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="status-neutral compact-note">
                No active test jobs are waiting right now.
              </p>
            )}

            <p className="source-note">
              Test jobs use the real Claude endpoints but are tagged as test
              mode, so claiming from this panel will not pull normal queued
              enrichment work. The dry-run proposal creates a review item that
              repeats an existing safe field instead of adding invented context.
            </p>
          </div>
        </section>

        <section>
          <div className="section-label">Last test outcomes</div>
          <div className="card">
            {latestTestJobs.length > 0 ? (
              <div className="mini-list">
                {latestTestJobs.map((job) => (
                  <div className="mini-item" key={job.id}>
                    <div className="mini-item-head">
                      <b>{testJobLabel(job)}</b>
                      <span className={statusPillClass(job.status)}>{job.status}</span>
                    </div>
                    <span>
                      {shortId(job.id)} · {jobOutcome(job)} · attempts {job.attempts} ·{" "}
                      {formatDate(job.created_at)}
                    </span>
                    <span>{jobSummary(job)}</span>
                    <div className="review-actions">
                      <Link className="button ghost small" href={`/ops/jobs/${job.id}`}>
                        Inspect
                      </Link>
                      <Link
                        className="button ghost small"
                        href={`/ops/jobs/${job.id}/handoff`}
                      >
                        Handoff
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No test outcomes are recorded yet.</p>
            )}
          </div>
        </section>

        <section>
          <div className="section-label">Review backlog</div>
          <div className="card">
            {pending.length > 0 ? (
              <div className="mini-list">
                {pending.map((change) => (
                  <div className="mini-item" key={change.id}>
                    <b>{change.summary}</b>
                    <span>
                      {change.change_type} · {change.risk_level} ·{" "}
                      {change.source ?? "unknown source"} · {formatDate(change.created_at)}
                    </span>
                    <div className="review-actions">
                      <Link className="button ghost small" href={`/changes/${change.id}`}>
                        Review
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No pending changes are waiting for review.</p>
            )}
            <div className="actions">
              <Link className="button ghost" href="/changes">
                Open Changes
              </Link>
            </div>
          </div>
        </section>

        <section>
          <div className="section-label">Recent enrichment jobs</div>
          <div className="card">
            {jobs.length > 0 ? (
              <div className="mini-list">
                {jobs.map((job) => (
                  <div className="mini-item" key={job.id}>
                    <div className="mini-item-head">
                      <b>
                        {job.job_type}
                        {job.payload.test_mode === true ? " / test" : ""}
                      </b>
                      <span className={statusPillClass(job.status)}>{job.status}</span>
                    </div>
                    <span>
                      {jobOutcome(job)} · attempts {job.attempts} ·{" "}
                      created {formatDate(job.created_at)}
                    </span>
                    <span>Lane: {originLabel(jobOrigin(job))}</span>
                    <span>
                      Contact:{" "}
                      {jobContactId(job) ?? "not linked"}
                    </span>
                    <span>{jobSummary(job)}</span>
                    <div className="review-actions">
                      <Link className="button ghost small" href={`/ops/jobs/${job.id}`}>
                        Inspect
                      </Link>
                      <Link
                        className="button ghost small"
                        href={`/ops/jobs/${job.id}/handoff`}
                      >
                        Handoff
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No enrichment or operations jobs are queued.</p>
            )}
          </div>
        </section>

        <section>
          <div className="section-label">Usage events</div>
          <div className="card">
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
              <p className="muted">No usage events are stored yet.</p>
            )}
          </div>
        </section>
      </div>

      <div className="section-label">Audit activity</div>
      <div className="card">
        {audit.length > 0 ? (
          <div className="mini-list">
            {audit.map((row) => (
              <div className="mini-item" key={row.id}>
                <b>{row.action}</b>
                <span>
                  {row.actor_type} · {row.table_name ?? "system"} ·{" "}
                  {formatDate(row.created_at)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No audit activity is visible yet.</p>
        )}
      </div>
    </>
  );
}
