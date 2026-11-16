import Link from "next/link";
import { Download, Eye } from "lucide-react";
import {
  clientInstallModulePlan,
  clientInstallPlan,
  clientInstallReadiness,
} from "@/lib/client-install-plan";
import {
  buildClientHandoffEvidencePack,
  formatClientHandoffEvidencePack,
} from "@/lib/client-handoff-evidence";
import {
  buildClientLaunchChecklist,
  buildLaunchActionPlan,
} from "@/lib/client-launch-readiness";
import { buildClientInstallQuestions } from "@/lib/client-install-questions";
import { buildClientInstallCommandCenter } from "@/lib/client-install-command-center";
import { buildClientInstallPlaybook } from "@/lib/client-install-playbook";
import { qualityStats } from "@/lib/data-quality";
import {
  deploymentReadiness,
  productionCheckEvidence,
} from "@/lib/deployment-readiness";
import { buildInstallAcceptanceSummary } from "@/lib/install-acceptance";
import {
  hasClosedLaunchRehearsalAction,
  hasSucceededLaunchRehearsalJob,
  isLaunchRehearsalJob,
} from "@/lib/launch-rehearsal-evidence";
import { getLaunchData, type ContactOption, type LaunchJobRow } from "@/lib/launch/data";
import { requireOperatorAccess } from "@/lib/operator-access";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { runCommandLifecycleRehearsal } from "@/app/(portal)/ops/actions";
import { QualityCleanupQueueButton } from "@/app/(portal)/quality/quality-cleanup-queue-button";
import type { ModuleKey } from "@/lib/modules";

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "No date";

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function checklistPillClass(status: "pass" | "action" | "waiting") {
  if (status === "pass") return "pill cool";
  if (status === "action") return "pill hot";
  return "pill gold";
}

function statusPillClass(status: string) {
  if (status === "succeeded" || status === "done") return "pill cool";
  if (status === "queued" || status === "open") return "pill gold";
  if (status === "running") return "pill hot";
  if (status === "failed") return "pill warn";
  return "pill";
}

function tileStatusClass(tone: "ok" | "warn" | "neutral") {
  if (tone === "ok") return "status-ok";
  if (tone === "warn") return "status-warn";
  return "status-neutral";
}

function sprintPillClass(priority: "critical" | "important" | "useful") {
  if (priority === "critical") return "pill hot";
  if (priority === "important") return "pill gold";
  return "pill cool";
}

function playbookStatusClass(status: "done" | "active" | "waiting" | "blocked") {
  if (status === "done") return "pill cool";
  if (status === "blocked") return "pill hot";
  if (status === "active") return "pill gold";
  return "pill";
}

function commandFocus(job: LaunchJobRow) {
  const focus = job.payload.command_focus;
  if (!focus || typeof focus !== "object" || Array.isArray(focus)) return null;
  return focus as Record<string, unknown>;
}

function commandOutput(job: LaunchJobRow) {
  const output = job.result.command_output;
  return typeof output === "string" && output.trim() ? output.trim() : null;
}

function contactLabel(contactId: string | null, contacts: ContactOption[]) {
  if (!contactId) return "No contact linked";
  const contact = contacts.find((item) => item.id === contactId);
  if (!contact) return contactId.slice(0, 8);
  return [contact.full_name, contact.company_name].filter(Boolean).join(" / ");
}

export default async function LaunchPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const operatorContext = await requireOperatorAccess();
  const params = searchParams ? await searchParams : {};
  const message = firstParam(params.message);
  const {
    context,
    contacts,
    contactCount,
    jobs,
    changes,
    pendingReviewCount,
    reviewQueue,
    audit,
    provenance,
    rehearsalActions,
    relationshipActionCount,
    wantToKnowCount,
    askRunCount,
    askRunUndecidedCount,
  } = await getLaunchData(operatorContext);
  const settings = normalizeTenantSettings(context?.settings);
  const modulePlan = clientInstallModulePlan(settings);
  const deployment = deploymentReadiness();
  const productionEvidence = productionCheckEvidence(settings);
  const installPlan = clientInstallPlan(settings);
  const installReadiness = clientInstallReadiness(settings);
  const quality = qualityStats(contacts);
  const qualityPriorityRecords = quality.scored
    .filter((contact) => contact.readiness < 80)
    .slice(0, 5);
  const commandJobs = jobs.filter(
    (job) => job.status === "succeeded" && commandFocus(job) && commandOutput(job),
  );
  const enabledModules = modulePlan
    .filter((module) => module.enabled)
    .map((module) => module.key as ModuleKey);
  const acceptance = buildInstallAcceptanceSummary({
    contactCount,
    jobs,
    changes,
    audit,
    provenance,
    moduleProof: {
      enabledModules,
      askRunCount,
      askRunUndecidedCount,
      commandJobCount: commandJobs.length,
      relationshipActionCount,
      wantToKnowCount,
    },
  });
  const rehearsalJobs = jobs.filter(isLaunchRehearsalJob);
  const latestRehearsalJob = rehearsalJobs[0];
  const latestRehearsalAction = rehearsalActions[0];
  const recommendedRehearsalContact = contacts[0] ?? null;
  const enabledModuleCount = Object.values(settings.modules).filter(Boolean).length;
  const launchChecklist = buildClientLaunchChecklist({
    deploymentReady: deployment.ready,
    deploymentBlockingCount: deployment.blockingCount,
    tenantReady: Boolean(context?.tenantId),
    contactCount,
    qualityAverage: quality.average,
    weakRecordCount: quality.weak,
    highValueWeakCount: quality.highValueWeak,
    installPlanPercent: installReadiness.percent,
    installPlanBlocked: installReadiness.blocked,
    enabledModuleCount,
    moduleProofItems: acceptance.items.filter((item) =>
      item.key.startsWith("module-"),
    ),
    acceptanceReady: acceptance.ready,
    acceptanceCompleted: acceptance.completed,
    acceptanceTotal: acceptance.total,
    acceptanceNextAction: acceptance.nextAction,
    pendingReviewCount,
    reviewQueueComplete: reviewQueue.state === "complete",
    commandJobCount: commandJobs.length,
    rehearsalJobSucceeded: hasSucceededLaunchRehearsalJob(rehearsalJobs),
    rehearsalActionClosed: hasClosedLaunchRehearsalAction(rehearsalActions),
    askRunCount,
    askRunUndecidedCount,
    launchNotesReady: settings.delivery.launch_notes.trim().length > 0,
    noindexReady: productionEvidence.ready,
  });
  const launchActionPlan = buildLaunchActionPlan(launchChecklist.items);
  const operatorQuestions = buildClientInstallQuestions({
    contactCount,
    enabledModules: modulePlan
      .filter((module) => module.enabled)
      .map((module) => module.label),
    hiddenModules: modulePlan
      .filter((module) => !module.enabled)
      .map((module) => module.label),
    highValueWeakCount: quality.highValueWeak,
    pendingReviewCount,
    askRunCount,
    commandJobCount: commandJobs.length,
    rehearsalComplete:
      hasSucceededLaunchRehearsalJob(rehearsalJobs) &&
      hasClosedLaunchRehearsalAction(rehearsalActions),
    launchNotesReady: settings.delivery.launch_notes.trim().length > 0,
    networkThesis: settings.onboarding.network_thesis,
    referralLanes: settings.onboarding.referral_lanes,
    prospectingFocus: settings.onboarding.prospecting_focus,
    outreachFocus: settings.onboarding.outreach_focus,
    relationshipRules: settings.onboarding.relationship_rules,
    ownerVoice: settings.voice_profile.owner_voice,
    prospectingBucketCount: settings.prospecting.buckets.length,
  });
  const installCommandCenter = buildClientInstallCommandCenter({
    tenantName: context?.tenantName ?? "Little Black Book install",
    contactCount,
    enabledModules: modulePlan
      .filter((module) => module.enabled)
      .map((module) => module.label),
    prospectingBucketCount: settings.prospecting.buckets.length,
    highValueWeakCount: quality.highValueWeak,
    pendingReviewCount,
    askRunCount,
    askRunUndecidedCount,
    commandJobCount: commandJobs.length,
    rehearsalComplete:
      hasSucceededLaunchRehearsalJob(rehearsalJobs) &&
      hasClosedLaunchRehearsalAction(rehearsalActions),
    launchReady: launchChecklist.ready,
    launchNotesReady: settings.delivery.launch_notes.trim().length > 0,
    deploymentReady: deployment.ready,
    productionSignoffReady: productionEvidence.ready,
    operatorQuestions,
    launchNextActions: launchActionPlan.next,
    moduleProofItems: acceptance.items,
  });
  const installPlaybook = buildClientInstallPlaybook({
    launchItems: launchChecklist.items,
    acceptanceItems: acceptance.items,
    operatorQuestions,
  });
  const handoffPack = buildClientHandoffEvidencePack({
    tenantName: context?.tenantName ?? "Little Black Book install",
    generatedAt: new Date().toISOString(),
    launchStatus: launchChecklist.statusLabel,
    launchCompleted: launchChecklist.completed,
    launchTotal: launchChecklist.total,
    installStage: installCommandCenter.stage,
    installStageDetail: installCommandCenter.detail,
    actionSummary: launchActionPlan.summary,
    nextActions: launchActionPlan.next.map((item) => ({
      label: item.label,
      detail: item.detail,
      href: item.href,
      lane: item.lane,
    })),
    nextSprints: installCommandCenter.sprints.map((item) => ({
      label: item.label,
      detail: item.detail,
      href: item.href,
      lane: item.lane,
    })),
    claudeFirstJobs: installCommandCenter.claudeFirstJobs,
    moduleProof: installCommandCenter.moduleProof.map((item) => ({
      label: item.label,
      detail: item.detail,
      status: item.status,
      href: item.href,
    })),
    enabledModules: modulePlan
      .filter((module) => module.enabled)
      .map((module) => module.label),
    hiddenModules: modulePlan
      .filter((module) => !module.enabled)
      .map((module) => module.label),
    contactCount,
    qualityAverage: quality.average,
    weakRecordCount: quality.weak,
    highValueWeakCount: quality.highValueWeak,
    pendingReviewCount,
    commandJobCount: commandJobs.length,
    askRunCount,
    askRunUndecidedCount,
    rehearsalJobStatus: latestRehearsalJob?.status ?? null,
    rehearsalActionStatus: latestRehearsalAction?.status ?? null,
    launchNotes: settings.delivery.launch_notes,
  });
  const handoffPackText = formatClientHandoffEvidencePack(handoffPack);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="crumb">Operator launch</div>
          <h1 className="portal-title">Client Launch</h1>
          <p className="lede">
            A private handoff checklist for proving this install before an
            executive sees the final Book.
          </p>
        </div>
        <div className="actions">
          <Link className="button ghost" href="/launch/preview">
            <Eye aria-hidden={true} />
            Owner preview
          </Link>
          <Link className="button ghost" href="/export/owner-handoff">
            <Download aria-hidden={true} />
            Owner packet
          </Link>
          <Link className="button ghost" href="/ops">
            Ops
          </Link>
          <Link className="button ghost" href="/deployment">
            Deployment
          </Link>
        </div>
      </div>

      {message ? <div className="notice">{message}</div> : null}

      <section className="statband" aria-label="Client launch readiness">
        <div className="stat">
          <div className="number">{launchChecklist.statusLabel}</div>
          <div className="label">Launch status</div>
        </div>
        <div className="stat">
          <div className="number">
            {launchChecklist.completed}/{launchChecklist.total}
          </div>
          <div className="label">Checklist passed</div>
        </div>
        <div className="stat">
          <div className="number">{acceptance.completed}/{acceptance.total}</div>
          <div className="label">Acceptance</div>
        </div>
        <div className="stat">
          <div className="number">{quality.average}%</div>
          <div className="label">Data quality</div>
        </div>
        <div className="stat">
          <div className="number">{rehearsalActions.length}</div>
          <div className="label">Rehearsals</div>
        </div>
      </section>

      <section className="priority-board" aria-label="Client install command center">
        <div className="priority-lead">
          <span className={launchChecklist.ready ? "pill cool" : "pill hot"}>
            {installCommandCenter.stage}
          </span>
          <h2>{installCommandCenter.title}</h2>
          <p>{installCommandCenter.detail}</p>
          <div className="grid two">
            {installCommandCenter.tiles.map((tile) => (
              <div className="priority-item" key={tile.label}>
                <span>{tile.label}</span>
                <b>{tile.value}</b>
                <small className={tileStatusClass(tile.tone)}>{tile.detail}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="priority-list">
          {installCommandCenter.sprints.map((sprint) => (
            <Link className="priority-item link-quiet" href={sprint.href} key={`${sprint.href}-${sprint.label}`}>
              <span className={sprintPillClass(sprint.priority)}>{sprint.lane}</span>
              <b>{sprint.label}</b>
              <span>{sprint.detail}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="section-label">Concierge install playbook</div>
      <section className="card">
        <div className="mini-item-head">
          <div>
            <h2>Repeatable Operator Path</h2>
            <p className="muted">{installPlaybook.summary}</p>
          </div>
          <span className={playbookStatusClass(installPlaybook.active.status)}>
            {installPlaybook.active.status}
          </span>
        </div>
        <div className="mini-list">
          {installPlaybook.phases.map((phase) => (
            <Link className="mini-item dense link-quiet" href={phase.href} key={phase.key}>
              <div className="mini-item-head">
                <b>{phase.label}</b>
                <span className={playbookStatusClass(phase.status)}>
                  {phase.status}
                </span>
              </div>
              <span>{phase.objective}</span>
              <span className="source-note">{phase.exitCriteria}</span>
              <span>{phase.nextStep}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="section-label">Module proof by workflow</div>
      <section className="card">
        <h2>Enabled Workflow Evidence</h2>
        <p className="muted">
          Each enabled owner-facing module gets its own proof target, so a
          custom install can stay lean without hiding weak spots inside the
          global launch score.
        </p>
        {installCommandCenter.moduleProof.length > 0 ? (
          <div className="mini-list">
            {installCommandCenter.moduleProof.map((item) => (
              <Link
                className="mini-item dense link-quiet"
                href={item.href}
                key={item.key}
              >
                <div className="mini-item-head">
                  <b>{item.label}</b>
                  <span className={checklistPillClass(item.status)}>
                    {item.status}
                  </span>
                </div>
                <span>{item.detail}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <b>No owner-facing modules are enabled.</b>
            <p>
              Enable only the workflows promised for this client, then prove
              each one before the owner walkthrough.
            </p>
          </div>
        )}
      </section>

      <div className="section-label">Claude first jobs</div>
      <section className="card">
        <h2>Next Claude Work To Prove</h2>
        <p className="muted">
          The first Claude jobs should prove the configured install with a small,
          source-backed sample before scaling data volume or workflow complexity.
        </p>
        {installCommandCenter.claudeFirstJobs.length > 0 ? (
          <div className="mini-list">
            {installCommandCenter.claudeFirstJobs.map((job) => (
              <Link className="mini-item dense link-quiet" href={job.href} key={`${job.href}-${job.label}`}>
                <div className="mini-item-head">
                  <b>{job.label}</b>
                  <span className="pill gold">Claude</span>
                </div>
                <span>{job.detail}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <b>No first-job gaps detected.</b>
            <p>
              Claude proof exists for the current handoff posture. Use the launch
              action plan for any remaining non-Claude checks.
            </p>
          </div>
        )}
      </section>

      <div className="grid two">
        <article className="card">
          <h2>Launch action plan</h2>
          <p className="muted">{launchActionPlan.summary}</p>
          {launchActionPlan.next.length > 0 ? (
            <div className="mini-list">
              {launchActionPlan.next.map((item, index) => (
                <Link
                  className="mini-item dense link-quiet"
                  href={item.href}
                  key={item.key}
                >
                  <div className="mini-item-head">
                    <b>
                      {index + 1}. {item.label}
                    </b>
                    <span className={checklistPillClass(item.status)}>
                      {item.lane === "fix_now" ? "fix now" : "waiting"}
                    </span>
                  </div>
                  <span>{item.detail}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <b>Launch evidence is complete.</b>
              <p>Keep the final handoff focused on the workflows enabled for this client.</p>
            </div>
          )}
        </article>

        <article className="card">
          <h2>Launch posture</h2>
          <ul className="security-list">
            <li>
              <span>Fix-now items</span>
              <span className={launchActionPlan.fixNow.length ? "status-warn" : "status-ok"}>
                {launchActionPlan.fixNow.length}
              </span>
            </li>
            <li>
              <span>Waiting items</span>
              <span
                className={launchActionPlan.waiting.length ? "status-neutral" : "status-ok"}
              >
                {launchActionPlan.waiting.length}
              </span>
            </li>
            <li>
              <span>Operator confidence</span>
              <span className={launchChecklist.ready ? "status-ok" : "status-warn"}>
                {launchChecklist.ready ? "Handoff ready" : "Keep testing"}
              </span>
            </li>
          </ul>
          <p className="source-note">
            This list is intentionally conservative: it favors clearing privacy,
            tenant, data-quality, and review pressure before giving the owner the
            production URL.
          </p>
        </article>
      </div>

      <div className="section-label">Operator questions</div>
      <section className="card">
        <h2>Concierge setup prompts</h2>
        <p className="muted">
          Product-manager questions for the operator before handoff. These keep
          each install custom in the useful way, without making the executive do
          self-serve setup.
        </p>
        {operatorQuestions.length > 0 ? (
          <div className="mini-list">
            {operatorQuestions.map((question) => (
              <Link className="mini-item dense link-quiet" href={question.href} key={question.key}>
                <div className="mini-item-head">
                  <b>{question.question}</b>
                  <span
                    className={
                      question.priority === "critical"
                        ? "pill hot"
                        : question.priority === "important"
                          ? "pill gold"
                          : "pill cool"
                    }
                  >
                    {question.priority}
                  </span>
                </div>
                <span>{question.why}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <b>No unresolved operator questions.</b>
            <p>
              The setup profile, proof checks, review lanes, and handoff notes
              are strong enough to proceed.
            </p>
          </div>
        )}
      </section>

      <div className="section-label">Handoff evidence pack</div>
      <section className="ask-brief" aria-label="Client handoff evidence pack">
        <label className="field">
          <span>
            Owner readiness · {handoffPack.readyForOwner ? "ready" : "not yet"} ·{" "}
            {handoffPack.riskLevel} risk
          </span>
          <textarea readOnly value={handoffPackText} />
        </label>
        <p className="source-note">
          This is the operator-facing launch packet. It summarizes what is ready,
          what is hidden, what still needs review, and what evidence exists before
          the owner sees the production Book.
        </p>
      </section>

      <section className="priority-board" aria-label="Launch next action">
        <div className="priority-lead">
          <span className={launchChecklist.ready ? "pill cool" : "pill hot"}>
            {launchChecklist.ready ? "ready" : "next action"}
          </span>
          <h2>
            {launchChecklist.ready
              ? "This install has launch evidence"
              : launchChecklist.nextAction.label}
          </h2>
          <p className="muted">
            {launchChecklist.ready
              ? "The launch checklist is fully green. Keep production handoff intentional, but the major operating loops have been proven."
              : launchChecklist.nextAction.detail}
          </p>
          <div className="actions">
            <Link className="button hot" href={launchChecklist.nextAction.href}>
              Open next evidence
            </Link>
          </div>
        </div>

        <div className="priority-list">
          {launchChecklist.items.map((item) => (
            <Link className="priority-item link-quiet" href={item.href} key={item.key}>
              <span className={checklistPillClass(item.status)}>{item.status}</span>
              <b>{item.label}</b>
              <span>{item.detail}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="section-label">End-to-end rehearsal runner</div>
      <div className="grid two">
        <article className="card">
          <h2>Run Live Rehearsal</h2>
          <p className="muted">
            This creates a test Claude command job, claims it through the private
            endpoint, completes it with command output, turns that output into a
            tracked action, and immediately closes the action as rehearsal
            evidence.
          </p>
          {recommendedRehearsalContact ? (
            <form action={runCommandLifecycleRehearsal} className="settings-form">
              <input
                name="contact_id"
                type="hidden"
                value={recommendedRehearsalContact.id}
              />
              <button className="button primary" type="submit">
                Run recommended proof
              </button>
              <p className="source-note">
                Uses {contactLabel(recommendedRehearsalContact.id, contacts)} as
                the current demo contact.
              </p>
            </form>
          ) : null}
          <form action={runCommandLifecycleRehearsal} className="settings-form">
            <label className="field">
              <span>Rehearsal contact</span>
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
              Run launch rehearsal
            </button>
          </form>
          <p className="source-note">
            It does not send outreach, approve pending changes, or write new
            relationship claims.
          </p>
        </article>

        <article className="card">
          <h2>Latest Evidence</h2>
          <ul className="security-list">
            <li>
              <span>
                Latest rehearsal job
                <small>
                  {latestRehearsalJob
                    ? `Created ${formatDate(latestRehearsalJob.created_at)}`
                    : "No launch rehearsal job yet."}
                </small>
              </span>
              {latestRehearsalJob ? (
                <Link
                  className={statusPillClass(latestRehearsalJob.status)}
                  href={`/ops/jobs/${latestRehearsalJob.id}`}
                >
                  {latestRehearsalJob.status}
                </Link>
              ) : (
                <span className="status-neutral">Waiting</span>
              )}
            </li>
            <li>
              <span>
                Latest rehearsal action
                <small>
                  {latestRehearsalAction
                    ? `${contactLabel(
                        latestRehearsalAction.contact_id ?? null,
                        contacts,
                      )} · ${formatDate(
                        latestRehearsalAction.completed_at ??
                          latestRehearsalAction.created_at,
                      )}`
                    : "No tracked rehearsal action yet."}
                </small>
              </span>
              <span
                className={
                  latestRehearsalAction
                    ? statusPillClass(latestRehearsalAction.status)
                    : "status-neutral"
                }
              >
                {latestRehearsalAction?.status ?? "Waiting"}
              </span>
            </li>
            <li>
              <span>Completed command outputs</span>
              <span className={commandJobs.length > 0 ? "status-ok" : "status-warn"}>
                {commandJobs.length}
              </span>
            </li>
            <li>
              <span>
                Pending review items
                <small>
                  {reviewQueue.state === "complete"
                    ? `${reviewQueue.excludedCount} controlled-test or replaced item${
                        reviewQueue.excludedCount === 1 ? "" : "s"
                      } excluded.`
                    : reviewQueue.reason}
                </small>
              </span>
              <span
                className={
                  reviewQueue.state !== "complete" || pendingReviewCount > 0
                    ? "status-warn"
                    : "status-ok"
                }
              >
                {reviewQueue.state === "complete" ? pendingReviewCount : "Unknown"}
              </span>
            </li>
          </ul>
        </article>
      </div>

      <div className="section-label">Review queue inventory</div>
      <section className="card">
        <h2>
          {reviewQueue.state === "complete"
            ? `${pendingReviewCount} handoff-blocking item${
                pendingReviewCount === 1 ? "" : "s"
              }`
            : "Review queue could not be verified"}
        </h2>
        <p className="muted">
          {reviewQueue.state === "complete"
            ? "Every pending proposal is assigned to a decision, repair, waiting, or excluded lane. Nothing is approved from this inventory."
            : reviewQueue.reason}
        </p>
        <div className="grid four">
          {reviewQueue.lanes.map((lane) => (
            <Link
              className={`lane-card command-step link-quiet ${lane.count === 0 ? "disabled" : ""}`}
              href={lane.href}
              key={lane.key}
            >
              <span className={lane.blocking && lane.count > 0 ? "pill hot" : "pill cool"}>
                {reviewQueue.state === "complete" ? lane.count : "Unknown"}
              </span>
              <h3>{lane.label}</h3>
              <p>{lane.detail}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="section-label">Handoff data quality</div>
      <div className="grid two">
        <article className="card">
          <h2>Quality Gate</h2>
          <ul className="security-list">
            <li>
              <span>Average readiness</span>
              <span className={quality.average >= 75 ? "status-ok" : "status-warn"}>
                {quality.average}%
              </span>
            </li>
            <li>
              <span>Ready records</span>
              <span className="status-neutral">{quality.ready}</span>
            </li>
            <li>
              <span>Weak records</span>
              <span className={quality.weak > 0 ? "status-warn" : "status-ok"}>
                {quality.weak}
              </span>
            </li>
            <li>
              <span>High-value gaps</span>
              <span
                className={quality.highValueWeak > 0 ? "status-warn" : "status-ok"}
              >
                {quality.highValueWeak}
              </span>
            </li>
          </ul>
          <div className="actions">
            <Link className="button ghost" href="/quality">
              Open quality workspace
            </Link>
          </div>
        </article>

        <article className="card">
          <h2>Priority Cleanup</h2>
          {qualityPriorityRecords.length > 0 ? (
            <>
              <div className="actions">
                <QualityCleanupQueueButton
                  contactIds={qualityPriorityRecords.map((contact) => contact.id)}
                  label={`Queue ${qualityPriorityRecords.length} cleanup job${
                    qualityPriorityRecords.length === 1 ? "" : "s"
                  }`}
                  note="Keeps judgment-heavy updates in review and uses the existing Claude cleanup queue."
                />
              </div>
              <div className="mini-list">
                {qualityPriorityRecords.map((contact) => (
                  <Link
                    className="mini-item dense link-quiet"
                    href={`/contacts/${contact.id}`}
                    key={contact.id}
                  >
                    <span className="pill gold">{contact.readiness}% ready</span>
                    <b>{contact.full_name}</b>
                    <span>
                      Missing:{" "}
                      {contact.missing.length > 0
                        ? contact.missing.slice(0, 4).join(", ")
                        : "Nothing critical"}
                    </span>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <p className="muted">
              No priority quality gaps are visible in the current launch sample.
            </p>
          )}
        </article>
      </div>

      <div className="section-label">Client install plan</div>
      <article className="card">
        <ul className="security-list">
          {installPlan.map((step) => (
            <li key={`${step.phase}-${step.label}`}>
              <span>
                <b>
                  {step.phase} · {step.label}
                </b>
                <small>{step.detail}</small>
              </span>
              <span
                className={
                  step.status === "ready"
                    ? "status-ok"
                    : step.status === "blocked"
                      ? "status-warn"
                      : "status-neutral"
                }
              >
                {step.status === "needs_input"
                  ? "Needs input"
                  : step.status === "blocked"
                    ? "Blocked"
                    : "Ready"}
              </span>
            </li>
          ))}
        </ul>
      </article>

      <div className="section-label">Recent rehearsals</div>
      <article className="card">
        {rehearsalActions.length > 0 ? (
          <div className="mini-list">
            {rehearsalActions.map((action) => (
              <div className="mini-item dense" key={action.id}>
                <span className={statusPillClass(action.status)}>
                  {action.status}
                </span>
                <b>{action.title ?? "Launch rehearsal action"}</b>
                <span>
                  {contactLabel(action.contact_id ?? null, contacts)} ·{" "}
                  {formatDate(action.completed_at ?? action.created_at)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">
            No launch rehearsals have been recorded yet. Run the rehearsal once
            the current acceptance checks are close.
          </p>
        )}
      </article>
    </>
  );
}
