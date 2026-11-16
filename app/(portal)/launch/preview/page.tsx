import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import {
  buildClientLaunchChecklist,
  buildLaunchActionPlan,
} from "@/lib/client-launch-readiness";
import {
  clientInstallModulePlan,
  clientInstallReadiness,
} from "@/lib/client-install-plan";
import { buildInstallAcceptanceSummary } from "@/lib/install-acceptance";
import {
  hasClosedLaunchRehearsalAction,
  hasSucceededLaunchRehearsalJob,
} from "@/lib/launch-rehearsal-evidence";
import { getPreviewData, type LaunchJobRow } from "@/lib/launch/data";
import { buildOwnerFirstUseState } from "@/lib/owner-first-use";
import { buildOwnerLaunchPreview } from "@/lib/owner-launch-preview";
import { buildOwnerSurfaceAudit } from "@/lib/owner-surface-audit";
import { requireOperatorAccess } from "@/lib/operator-access";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import {
  deploymentReadiness,
  productionCheckEvidence,
} from "@/lib/deployment-readiness";
import type { ModuleKey } from "@/lib/modules";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function commandFocus(job: LaunchJobRow) {
  return isRecord(job.payload.command_focus) ? job.payload.command_focus : null;
}

function commandOutput(job: LaunchJobRow) {
  const output = job.result.command_output;
  return typeof output === "string" && output.trim() ? output.trim() : null;
}

function metricClass(tone: "ok" | "warn" | "neutral") {
  if (tone === "ok") return "status-ok";
  if (tone === "warn") return "status-warn";
  return "status-neutral";
}

function actionClass(tone: "primary" | "review" | "neutral") {
  if (tone === "primary") return "pill cool";
  if (tone === "review") return "pill hot";
  return "pill";
}

function demoStatusClass(status: "pass" | "action" | "waiting") {
  if (status === "pass") return "pill cool";
  if (status === "action") return "pill hot";
  return "pill gold";
}

export default async function OwnerLaunchPreviewPage() {
  const operatorContext = await requireOperatorAccess();
  const data = await getPreviewData(operatorContext);
  const settings = normalizeTenantSettings(data.context?.settings);
  const modulePlan = clientInstallModulePlan(settings);
  const enabledModules = modulePlan
    .filter((module) => module.enabled)
    .map((module) => module.key as ModuleKey);
  const commandJobs = data.jobs.filter(
    (job) => job.status === "succeeded" && commandFocus(job) && commandOutput(job),
  );
  const acceptance = buildInstallAcceptanceSummary({
    contactCount: data.contacts,
    jobs: data.jobs,
    changes: data.changes,
    audit: data.audit,
    provenance: data.provenance,
    moduleProof: {
      enabledModules,
      askRunCount: data.askRunCount,
      askRunUndecidedCount: data.askRunUndecidedCount,
      commandJobCount: commandJobs.length,
      relationshipActionCount: data.relationshipActionCount,
      wantToKnowCount: data.wantToKnowCount,
    },
  });
  const deployment = deploymentReadiness();
  const productionEvidence = productionCheckEvidence(settings);
  const installReadiness = clientInstallReadiness(settings);
  const launchChecklist = buildClientLaunchChecklist({
    deploymentReady: deployment.ready,
    deploymentBlockingCount: deployment.blockingCount,
    tenantReady: Boolean(data.context?.tenantId),
    contactCount: data.contacts,
    qualityAverage: data.qualityAverage,
    weakRecordCount: data.weakRecordCount,
    highValueWeakCount: data.highValueWeakCount,
    installPlanPercent: installReadiness.percent,
    installPlanBlocked: installReadiness.blocked,
    enabledModuleCount: enabledModules.length,
    moduleProofItems: acceptance.items.filter((item) =>
      item.key.startsWith("module-"),
    ),
    acceptanceReady: acceptance.ready,
    acceptanceCompleted: acceptance.completed,
    acceptanceTotal: acceptance.total,
    acceptanceNextAction: acceptance.nextAction,
    pendingReviewCount: data.pendingReview,
    reviewQueueComplete: data.reviewQueue.state === "complete",
    commandJobCount: commandJobs.length,
    rehearsalJobSucceeded: hasSucceededLaunchRehearsalJob(data.jobs),
    rehearsalActionClosed: hasClosedLaunchRehearsalAction(data.rehearsalActions),
    askRunCount: data.askRunCount,
    askRunUndecidedCount: data.askRunUndecidedCount,
    launchNotesReady: settings.delivery.launch_notes.trim().length > 0,
    noindexReady: productionEvidence.ready,
  });
  const actionPlan = buildLaunchActionPlan(launchChecklist.items);
  const preview = buildOwnerLaunchPreview({
    tenantName: data.context?.tenantName ?? "Little Black Book install",
    enabledModules,
    contactCount: data.contacts,
    pendingReviewCount: data.pendingReview,
    openActionCount: data.openActions,
    openPromiseCount: data.openPromises,
    askRunCount: data.askRunCount,
    askRunUndecidedCount: data.askRunUndecidedCount,
    launchStatus: launchChecklist.statusLabel,
    launchCompleted: launchChecklist.completed,
    launchTotal: launchChecklist.total,
  });
  const surfaceAudit = buildOwnerSurfaceAudit({
    ownerNav: preview.ownerNav,
    hiddenOperatorTools: preview.hiddenOperatorTools,
    enabledModules,
    adminModeDefault: false,
    reviewSurface: settings.delivery.owner_review_surface,
    ownerHrefs: preview.ownerHrefs,
  });
  const firstUseProof = buildOwnerFirstUseState("launch_preview", {
    contactCount: data.contacts,
    pendingReviewCount: data.pendingReview,
  });

  return (
    <>
      <div className="topbar">
        <div>
          <div className="crumb">Operator launch</div>
          <h1 className="portal-title">Owner Preview</h1>
          <p className="lede">
            A pre-handoff view of what the executive will see: enabled modules,
            owner-facing starting points, and hidden operator tooling.
          </p>
        </div>
        <div className="actions">
          <Link className="button ghost" href="/launch">
            Launch
          </Link>
          <Link className="button primary" href="/export/owner-handoff">
            Owner packet
          </Link>
        </div>
      </div>

      <section className="statband" aria-label="Owner preview readiness">
        <div className="stat">
          <div className="number">{preview.ready ? "Ready" : "Review"}</div>
          <div className="label">Owner preview</div>
        </div>
        <div className="stat">
          <div className="number">{preview.ownerNav.length}</div>
          <div className="label">Visible nav items</div>
        </div>
        <div className="stat">
          <div className="number">{enabledModules.length}</div>
          <div className="label">Enabled workflows</div>
        </div>
        <div className="stat">
          <div className="number">{preview.hiddenOperatorTools.length}</div>
          <div className="label">Hidden operator tools</div>
        </div>
        <div className="stat">
          <div className="number">{surfaceAudit.ready ? "Clean" : "Check"}</div>
          <div className="label">Owner/admin split</div>
        </div>
      </section>

      <section className="priority-board" aria-label="Owner first screen preview">
        <div className="priority-lead">
          <span className={preview.ready ? "pill cool" : "pill hot"}>
            {preview.ready ? "owner-ready" : "pre-handoff review"}
          </span>
          <h2>{preview.tenantName}</h2>
          <p className="muted">
            This preview does not impersonate the owner or change access. It
            mirrors the owner-visible surfaces using the current install
            settings and tenant-scoped data.
          </p>
          <div className="actions">
            <Link className="button hot" href={actionPlan.next[0]?.href ?? "/launch"}>
              Resolve next launch item
            </Link>
          </div>
        </div>

        <div className="priority-list">
          {preview.firstUseActions.map((action) => (
            <Link className="priority-item link-quiet" href={action.href} key={action.label}>
              <span className={actionClass(action.tone)}>{action.tone}</span>
              <b>{action.label}</b>
              <span>{action.detail}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="section-label">Owner walkthrough</div>
      <section className="card">
        <h2>First Demo Path</h2>
        <p className="muted">
          Use this as the concierge walkthrough before handing the URL to the
          owner. It keeps the executive experience focused on the finished Book,
          while operator setup remains hidden.
        </p>
        <div className="mini-list">
          {preview.demoSteps.map((step) => (
            <Link
              className="mini-item dense link-quiet"
              href={step.href}
              key={`${step.step}-${step.href}`}
            >
              <div className="mini-item-head">
                <b>
                  {step.step}. {step.label}
                </b>
                <span className={demoStatusClass(step.status)}>{step.status}</span>
              </div>
              <span>{step.detail}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid two">
        <article className="card">
          <h2>Owner/admin separation</h2>
          <p className="muted">{surfaceAudit.summary}</p>
          <ul className="security-list">
            {surfaceAudit.items.map((auditItem) => (
              <li key={auditItem.key}>
                <span>
                  {auditItem.label}
                  <small>{auditItem.detail}</small>
                </span>
                <Link
                  className={auditItem.status === "pass" ? "status-ok" : "status-warn"}
                  href={auditItem.href}
                >
                  {auditItem.status === "pass" ? "Pass" : "Review"}
                </Link>
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>First-use proof</h2>
          <p className="muted">{firstUseProof.detail}</p>
          <ul className="security-list">
            {firstUseProof.proof.map((item) => (
              <li key={item}>
                <span>{item}</span>
                <span className="status-ok">Checked</span>
              </li>
            ))}
          </ul>
          <div className="actions">
            <Link className="button hot small" href={firstUseProof.primaryHref}>
              {firstUseProof.primaryLabel}
            </Link>
            {firstUseProof.secondaryHref && firstUseProof.secondaryLabel ? (
              <Link className="button ghost small" href={firstUseProof.secondaryHref}>
                {firstUseProof.secondaryLabel}
              </Link>
            ) : null}
          </div>
        </article>
      </div>

      <div className="grid two">
        <article className="card">
          <h2>Owner-visible navigation</h2>
          <div className="mini-list">
            {preview.ownerNav.map((item) => (
              <Link className="mini-item dense link-quiet" href={item.href} key={item.href}>
                <span className="pill cool">
                  <Eye aria-hidden={true} />
                  {item.kind}
                </span>
                <b>{item.label}</b>
                <span>{item.href}</span>
              </Link>
            ))}
          </div>
        </article>

        <article className="card">
          <h2>Hidden from owner</h2>
          <div className="mini-list">
            {preview.hiddenOperatorTools.map((label) => (
              <div className="mini-item dense" key={label}>
                <span className="pill">
                  <EyeOff aria-hidden={true} />
                  operator
                </span>
                <b>{label}</b>
                <span>Kept out of the executive's normal application navigation.</span>
              </div>
            ))}
          </div>
        </article>
      </div>

      <div className="grid two">
        <article className="card">
          <h2>Owner-facing state</h2>
          <ul className="security-list">
            {preview.metrics.map((metric) => (
              <li key={metric.label}>
                <span>
                  {metric.label}
                  <small>{metric.detail}</small>
                </span>
                <span className={metricClass(metric.tone)}>{metric.value}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Enabled workflow purpose</h2>
          <ul className="security-list">
            {modulePlan
              .filter((module) => module.enabled)
              .map((module) => (
                <li key={module.key}>
                  <span>
                    {module.label}
                    <small>{module.operatingUse}</small>
                  </span>
                  <span className="status-ok">Visible</span>
                </li>
              ))}
          </ul>
        </article>
      </div>
    </>
  );
}
