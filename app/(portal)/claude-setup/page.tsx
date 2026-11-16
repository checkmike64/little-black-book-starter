import Link from "next/link";
import {
  buildClaudeProjectInstructions,
  buildDailyCloseoutPrompt,
  buildEndpointCheatsheet,
  buildClaudeFirstRunSequence,
  buildFirstContactImportPrompt,
  buildIntakeTranscriptPrompt,
  buildOwnerVerificationPrompt,
  buildWeeklyNetworkPrompt,
} from "@/lib/claude-setup-package";
import {
  getClaudeImportReceipt,
  getSetupRevisions,
} from "@/lib/claude-setup/data";
import { requireOperatorAccess } from "@/lib/operator-access";
import {
  buildProspectingResearchPrompt,
  buildProspectingVerificationPrompt,
  buildWantToKnowCandidateProposalPrompt,
} from "@/lib/prospecting-workflow";
import { getTenantContext } from "@/lib/tenant-context";
import {
  intakeCompletion,
  normalizeTenantSettings,
} from "@/lib/tenant-settings";

function formatDate(value: string | null | undefined) {
  if (!value) return "No revision";

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function receiptPillClass(status: string) {
  if (status === "recorded") return "pill cool";
  if (status === "review") return "pill hot";
  return "pill gold";
}

function actionPillClass(priority: "critical" | "important" | "useful") {
  if (priority === "critical") return "pill hot";
  if (priority === "important") return "pill gold";
  return "pill cool";
}

export default async function ClaudeSetupPage() {
  await requireOperatorAccess();
  const context = await getTenantContext();
  const settings = normalizeTenantSettings(context?.settings);
  const revisions = await getSetupRevisions(context?.tenantId);
  const importReceipt = await getClaudeImportReceipt(context?.tenantId);
  const latestRevision = revisions[0];
  const completion = intakeCompletion(settings);
  const tenantName = context?.tenantName ?? "Current install";
  const projectInstructions = buildClaudeProjectInstructions({
    tenantName,
    settings,
  });
  const endpointCheatsheet = buildEndpointCheatsheet();
  const intakeTranscriptPrompt = buildIntakeTranscriptPrompt({
    tenantName,
    settings,
  });
  const firstContactImportPrompt = buildFirstContactImportPrompt({
    tenantName,
    settings,
  });
  const ownerVerificationPrompt = buildOwnerVerificationPrompt();
  const dailyCloseoutPrompt = buildDailyCloseoutPrompt();
  const weeklyNetworkPrompt = buildWeeklyNetworkPrompt();
  const firstRunSequence = buildClaudeFirstRunSequence(settings);
  const prospectingResearchPrompt = buildProspectingResearchPrompt(settings);
  const prospectingProposalPrompt =
    buildWantToKnowCandidateProposalPrompt(settings);
  const prospectingVerificationPrompt =
    buildProspectingVerificationPrompt(settings);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="crumb">Claude Setup</div>
          <h1 className="portal-title">Claude Setup</h1>
          <p className="lede">
            Copy-ready instructions, endpoint rules, and workflow prompts for the
            client Claude project.
          </p>
        </div>
        <div className="actions">
          <Link className="button hot" href="/claude-setup/packet">
            Download setup packet
          </Link>
          <Link className="button ghost" href="/intake">
            Intake profile
          </Link>
        </div>
      </div>

      <section className="statband" aria-label="Claude setup status">
        <div className="stat">
          <div className="number">{completion.percent}%</div>
          <div className="label">Intake ready</div>
        </div>
        <div className="stat">
          <div className="number">{completion.complete}</div>
          <div className="label">Answers stored</div>
        </div>
        <div className="stat">
          <div className="number">
            {settings.write_rules.mechanical_writes ? "On" : "Off"}
          </div>
          <div className="label">Mechanical writes</div>
        </div>
        <div className="stat">
          <div className="number">{context?.role ?? "—"}</div>
          <div className="label">Your role</div>
        </div>
        <div className="stat">
          <div className="number">{revisions.length}</div>
          <div className="label">Setup revisions</div>
        </div>
      </section>

      {latestRevision ? (
        <div className="notice">
          Current Claude packet reflects the latest setup revision from{" "}
          {formatDate(latestRevision.createdAt)}: {latestRevision.summary}.
        </div>
      ) : null}

      {completion.percent < 100 ? (
        <div className="notice">
          Intake is not complete yet. This package is still usable, but the best
          Claude behavior comes after the owner&apos;s thesis, referral lanes, rules,
          voice, and assistant style are saved.
        </div>
      ) : null}

      <div className="section-label">Client setup loop</div>
      <div className="grid three">
        <article className="card">
          <h2>1. Intake Transcript</h2>
          <p className="muted">
            Convert the interview into install settings, operating rules, and
            focused owner follow-up questions before importing contacts.
          </p>
        </article>
        <article className="card">
          <h2>2. Starter Book</h2>
          <p className="muted">
            Import a small verified batch first, search for duplicates, and queue
            enrichment rather than filling a heavy manual form.
          </p>
        </article>
        <article className="card">
          <h2>3. Verification Pass</h2>
          <p className="muted">
            Ask the owner to confirm trust, referral safety, promises, and private
            context before judgment fields become durable.
          </p>
        </article>
      </div>

      <div className="section-label">Claude first run</div>
      <article className="card">
        <h2>First Operating Pass</h2>
        <p className="muted">
          Use this sequence after creating the client Claude project. It keeps the
          first install run focused on proof, not volume.
        </p>
        <ul className="security-list">
          {firstRunSequence.map((step, index) => (
            <li key={step.label}>
              <span>
                <b>
                  {index + 1}. {step.label}
                </b>
                <small>{step.detail}</small>
                <small>Evidence: {step.evidence}</small>
              </span>
              <span className="status-neutral">Manual</span>
            </li>
          ))}
        </ul>
      </article>

      <div className="section-label">Claude import receipt</div>
      <section className="card">
        <div className="mini-item-head">
          <h2>Latest Supabase Evidence</h2>
          <span className={receiptPillClass(importReceipt.status)}>
            {importReceipt.status}
          </span>
        </div>
        <p className="muted">
          A lightweight receipt for what Claude has actually written or queued in
          Supabase. Use this after the first operating pass before adding more
          contacts, correspondence, or prospecting volume.
        </p>
        <div className="grid three">
          <div className="priority-item">
            <span>Completed jobs</span>
            <b>{importReceipt.completedJobCount}</b>
            <small>Claude jobs closed through the private endpoint.</small>
          </div>
          <div className="priority-item">
            <span>Pending proposals</span>
            <b>{importReceipt.pendingReviewCount}</b>
            <small>{importReceipt.highRiskPendingCount} high-risk proposal(s).</small>
          </div>
          <div className="priority-item">
            <span>Interactions</span>
            <b>{importReceipt.interactionCount}</b>
            <small>Transcript or correspondence events stored.</small>
          </div>
          <div className="priority-item">
            <span>Provenance rows</span>
            <b>{importReceipt.provenanceCount}</b>
            <small>Field-level source evidence in Supabase.</small>
          </div>
          <div className="priority-item">
            <span>Owner verification</span>
            <b>{importReceipt.ownerVerificationCount}</b>
            <small>Proposals that still need owner judgment.</small>
          </div>
          <div className="priority-item">
            <span>Latest activity</span>
            <b>{formatDate(importReceipt.latestActivityAt)}</b>
            <small>
              Duplicate/replacement signals: {importReceipt.duplicateSignalCount}
            </small>
          </div>
        </div>
        {importReceipt.actions.length > 0 ? (
          <div className="mini-list">
            {importReceipt.actions.map((action) => (
              <Link
                className="mini-item dense link-quiet"
                href={action.href}
                key={`${action.href}-${action.label}`}
              >
                <div className="mini-item-head">
                  <b>{action.label}</b>
                  <span className={actionPillClass(action.priority)}>
                    {action.priority}
                  </span>
                </div>
                <span>{action.detail}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <b>Claude import evidence is settled.</b>
            <p>
              No immediate review or first-pass proof action is visible from the
              current Supabase records.
            </p>
          </div>
        )}
      </section>

      <div className="grid three">
        <section>
          <div className="section-label">Intake transcript</div>
          <section className="ask-brief" aria-label="Intake transcript prompt">
            <label className="field">
              <span>Prompt</span>
              <textarea readOnly value={intakeTranscriptPrompt} />
            </label>
          </section>
        </section>

        <section>
          <div className="section-label">First import</div>
          <section className="ask-brief" aria-label="First contact import prompt">
            <label className="field">
              <span>Prompt</span>
              <textarea readOnly value={firstContactImportPrompt} />
            </label>
          </section>
        </section>

        <section>
          <div className="section-label">Owner verification</div>
          <section className="ask-brief" aria-label="Owner verification prompt">
            <label className="field">
              <span>Prompt</span>
              <textarea readOnly value={ownerVerificationPrompt} />
            </label>
          </section>
        </section>
      </div>

      <div className="grid two">
        <section>
          <div className="section-label">Project instructions</div>
          <section className="ask-brief" aria-label="Project instructions">
            <label className="field">
              <span>
                Paste into Claude project instructions
                {latestRevision
                  ? ` · version ${formatDate(latestRevision.createdAt)}`
                  : ""}
              </span>
              <textarea readOnly value={projectInstructions} />
            </label>
            <p className="source-note">
              Do not paste Supabase service-role keys into Claude. Use only the
              narrow Little Black Book write token.
            </p>
          </section>
        </section>

        <section>
          <div className="section-label">Endpoint cheatsheet</div>
          <section className="ask-brief" aria-label="Endpoint cheatsheet">
            <label className="field">
              <span>Private endpoint contract</span>
              <textarea readOnly value={endpointCheatsheet} />
            </label>
            <p className="source-note">
              These examples intentionally use placeholders for private values.
            </p>
          </section>
        </section>
      </div>

      <div className="grid three">
        <section>
          <div className="section-label">Prospecting research</div>
          <section className="ask-brief" aria-label="Prospecting research prompt">
            <label className="field">
              <span>Prompt</span>
              <textarea readOnly value={prospectingResearchPrompt} />
            </label>
          </section>
        </section>

        <section>
          <div className="section-label">Want to Know boundary</div>
          <section className="ask-brief" aria-label="Want to Know boundary">
            <label className="field">
              <span>Endpoint contract</span>
              <textarea readOnly value={prospectingProposalPrompt} />
            </label>
          </section>
        </section>

        <section>
          <div className="section-label">Prospecting verification</div>
          <section
            className="ask-brief"
            aria-label="Prospecting verification prompt"
          >
            <label className="field">
              <span>Prompt</span>
              <textarea readOnly value={prospectingVerificationPrompt} />
            </label>
          </section>
        </section>
      </div>

      <div className="grid two">
        <section>
          <div className="section-label">Daily closeout</div>
          <section className="ask-brief" aria-label="Daily closeout prompt">
            <label className="field">
              <span>Prompt</span>
              <textarea readOnly value={dailyCloseoutPrompt} />
            </label>
          </section>
        </section>

        <section>
          <div className="section-label">Weekly intelligence</div>
          <section className="ask-brief" aria-label="Weekly network prompt">
            <label className="field">
              <span>Prompt</span>
              <textarea readOnly value={weeklyNetworkPrompt} />
            </label>
          </section>
        </section>
      </div>

      <div className="section-label">Setup checklist</div>
      <div className="grid three">
        <article className="card">
          <h2>Claude Project</h2>
          <ul className="security-list">
            <li>
              <span>Paste project instructions</span>
              <span className="status-neutral">Manual</span>
            </li>
            <li>
              <span>Add app URL</span>
              <span className="status-neutral">Private</span>
            </li>
            <li>
              <span>Add write token</span>
              <span className="status-neutral">Private</span>
            </li>
          </ul>
        </article>

        <article className="card">
          <h2>Boundaries</h2>
          <ul className="security-list">
            <li>
              <span>No Supabase secret in Claude</span>
              <span className="status-ok">Required</span>
            </li>
            <li>
              <span>Source accounts stay outside the app</span>
              <span className="status-ok">Required</span>
            </li>
            <li>
              <span>Judgment changes reviewed</span>
              <span className="status-ok">Required</span>
            </li>
          </ul>
        </article>

        <article className="card">
          <h2>Test Path</h2>
          <ul className="security-list">
            <li>
              <span>Create test enrichment job</span>
              <span className="status-neutral">Ops</span>
            </li>
            <li>
              <span>Run handoff packet</span>
              <span className="status-neutral">Ops</span>
            </li>
            <li>
              <span>Review pending changes</span>
              <span className="status-neutral">Changes</span>
            </li>
          </ul>
        </article>
      </div>
    </>
  );
}
