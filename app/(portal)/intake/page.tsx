import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import { updateIntakeSettings } from "@/app/(portal)/settings/actions";
import {
  clientInstallModulePlan,
  clientInstallPlan,
  clientInstallReadiness,
} from "@/lib/client-install-plan";
import { buildInstallBrief } from "@/lib/install-brief";
import { getIntakeRevisionHistory } from "@/lib/intake/data";
import { requireOperatorAccess } from "@/lib/operator-access";
import { formatProspectingBucketLines } from "@/lib/prospecting-buckets";
import { getTenantContext } from "@/lib/tenant-context";
import {
  intakeCompletion,
  normalizeTenantSettings,
} from "@/lib/tenant-settings";

type IntakeSearchParams = Promise<Record<string, string | string[] | undefined>>;

const interviewPrompts = [
  "What kinds of people should this book make easier to find?",
  "Which relationships are referral-safe, and which are simply friendly?",
  "What promises does the owner routinely make and forget?",
  "What should Claude never infer without explicit approval?",
  "What outreach opportunities matter this quarter?",
];

const starterBlocks = [
  {
    label: "Network thesis",
    text: "Describe the owner’s relationship world in plain English: who matters, why the network is valuable, which circles should be easy to search, and what the book should help the owner remember before each interaction.",
  },
  {
    label: "Referral lanes",
    text: "List the categories where the owner can confidently refer, receive referrals, or make introductions. Separate trusted lanes from friendly-but-unproven relationships.",
  },
  {
    label: "Relationship rules",
    text: "Define what trust, referral safety, relationship strength, and touch cadence mean for this owner. Note which judgments require explicit owner approval before landing in the Book.",
  },
  {
    label: "Owner voice",
    text: "Capture how the owner naturally writes and speaks: directness, warmth, brevity, humor, formality, and words or tones to avoid.",
  },
  {
    label: "Assistant style",
    text: "Tell Claude how to brief the owner, ask verification questions, propose changes, and handle uncertainty without over-explaining or inventing context.",
  },
];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function completed(value: string) {
  return value.trim().length > 0;
}

function stepClass(status: "ready" | "needs_input" | "blocked") {
  if (status === "ready") return "status-ok";
  if (status === "blocked") return "status-warn";
  return "status-neutral";
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

export default async function IntakePage({
  searchParams,
}: {
  searchParams?: IntakeSearchParams;
}) {
  await requireOperatorAccess();
  const params = searchParams ? await searchParams : {};
  const message = firstParam(params.message);
  const context = await getTenantContext();
  const settings = normalizeTenantSettings(context?.settings);
  const revisions = await getIntakeRevisionHistory(context?.tenantId);
  const latestRevision = revisions[0];
  const completion = intakeCompletion(settings);
  const launchPlan = clientInstallPlan(settings);
  const modulePlan = clientInstallModulePlan(settings);
  const launchReadiness = clientInstallReadiness(settings);
  const installBrief = buildInstallBrief({
    tenantName: context?.tenantName ?? "Current install",
    settings,
  });
  const prospectingBuckets = formatProspectingBucketLines(
    settings.prospecting.buckets,
  );

  const checklist = [
    ["Network thesis", settings.onboarding.network_thesis],
    ["Referral lanes", settings.onboarding.referral_lanes],
    ["Prospecting buckets", prospectingBuckets],
    ["Relationship rules", settings.onboarding.relationship_rules],
    ["Owner voice", settings.voice_profile.owner_voice],
    ["Assistant style", settings.voice_profile.assistant_style],
  ] as const;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="crumb">Intake</div>
          <h1 className="portal-title">Client Intake</h1>
          <p className="lede">
            Operator-only workspace for capturing the context Claude and the app
            need before importing contacts, extracting correspondence, or enabling
            optional workflows.
          </p>
        </div>
        <div className="actions">
          <Link className="button hot" href="/admin/preinstall">
            Review prepared work
          </Link>
          <Link className="button ghost" href="/intake/import">
            Preview client list
          </Link>
          <Link className="button ghost" href="/claude-setup">
            Claude setup
          </Link>
          <Link className="button ghost" href="/settings">
            Install settings
          </Link>
        </div>
      </div>

      {message ? <div className="notice">{message}</div> : null}

      <section className="statband" aria-label="Intake readiness">
        <div className="stat">
          <div className="number">{completion.percent}%</div>
          <div className="label">Profile complete</div>
        </div>
        <div className="stat">
          <div className="number">{completion.complete}</div>
          <div className="label">Core answers stored</div>
        </div>
        <div className="stat">
          <div className="number">{completion.total}</div>
          <div className="label">Core prompts</div>
        </div>
        <div className="stat">
          <div className="number">{context?.role ?? "—"}</div>
          <div className="label">Your role</div>
        </div>
        <div className="stat">
          <div className="number">{launchReadiness.percent}%</div>
          <div className="label">Launch plan ready</div>
        </div>
        <div className="stat">
          <div className="number">{revisions.length}</div>
          <div className="label">Setup revisions</div>
        </div>
      </section>

      <div className="grid two">
        <section>
          <div className="section-label">Interview profile</div>
          <form action={updateIntakeSettings} className="card settings-form">
            <input name="settings_version" type="hidden" value={context?.settingsVersion ?? 1} />
            <label className="field">
              <span>Network thesis</span>
              <textarea
                defaultValue={settings.onboarding.network_thesis}
                name="network_thesis"
                placeholder="Who matters in this client’s network, and why?"
                rows={4}
              />
            </label>
            <label className="field">
              <span>Referral lanes</span>
              <textarea
                defaultValue={settings.onboarding.referral_lanes}
                name="referral_lanes"
                placeholder="Where can the client confidently refer, receive referrals, or make intros?"
                rows={4}
              />
            </label>
            <label className="field">
              <span>Prospecting focus</span>
              <textarea
                defaultValue={settings.onboarding.prospecting_focus}
                name="prospecting_focus"
                placeholder="Optional: target companies, buyer types, investors, operators, partners..."
                rows={3}
              />
            </label>
            <label className="field">
              <span>Activated Want to Know buckets</span>
              <textarea
                defaultValue={prospectingBuckets}
                name="prospecting_buckets"
                placeholder="One per line: name | goal | look for | intensity | lane | cadence days | signals | actions | sources | voice | evidence | approval | success | minimum evidence sources"
                rows={8}
              />
              <small>
                Only buckets saved here appear to the owner. Separate signals,
                actions, and sources with commas. Approval is operator, owner, or
                automatic. Templates are never activated automatically.
              </small>
            </label>
            <label className="field">
              <span>Outreach focus</span>
              <textarea
                defaultValue={settings.onboarding.outreach_focus}
                name="outreach_focus"
                placeholder="Optional: podcast spots, guest posts, deal flow, board roles, community invitations..."
                rows={3}
              />
            </label>
            <label className="field">
              <span>Relationship rules</span>
              <textarea
                defaultValue={settings.onboarding.relationship_rules}
                name="relationship_rules"
                placeholder="How should trust, referral safety, touch cadence, and relationship strength be interpreted?"
                rows={4}
              />
            </label>
            <label className="field">
              <span>Intake notes</span>
              <textarea
                defaultValue={settings.onboarding.intake_notes}
                name="intake_notes"
                placeholder="Anything that should guide setup but not become a contact field."
                rows={5}
              />
            </label>

            <div className="form-grid three">
              <label className="field">
                <span>Owner voice</span>
                <textarea
                  defaultValue={settings.voice_profile.owner_voice}
                  name="owner_voice"
                  placeholder="Direct, warm, concise, thoughtful..."
                  rows={4}
                />
              </label>
              <label className="field">
                <span>Assistant style</span>
                <textarea
                  defaultValue={settings.voice_profile.assistant_style}
                  name="assistant_style"
                  placeholder="How the Book should brief, ask, and propose changes."
                  rows={4}
                />
              </label>
              <label className="field">
                <span>Default outreach tone</span>
                <textarea
                  defaultValue={settings.voice_profile.default_outreach_tone}
                  name="default_outreach_tone"
                  placeholder="How drafted outreach should sound."
                  rows={4}
                />
              </label>
            </div>

            <div className="actions">
              <button className="button hot" disabled={!context} type="submit">
                Save intake profile
              </button>
            </div>
          </form>
        </section>

        <section>
          <div className="section-label">Readiness</div>
          <div className="card">
            <h2>{context?.tenantName ?? "Current install"}</h2>
            <ul className="security-list">
              <li>
                <span>Client setup visibility</span>
                <span className="status-ok">Hidden</span>
              </li>
              {checklist.map(([label, value]) => {
                const isComplete = completed(value);

                return (
                  <li key={label}>
                    <span>{label}</span>
                    <span className={isComplete ? "status-ok" : "status-neutral"}>
                      {isComplete ? (
                        <CheckCircle2 aria-hidden="true" size={16} />
                      ) : (
                        <Circle aria-hidden="true" size={16} />
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="source-note">
              These answers shape Claude instructions, module defaults, review
              thresholds, and how Ask the Book should interpret relationship context.
            </p>
          </div>

          <div className="section-label">Client launch plan</div>
          <div className="card">
            <div className="mini-list">
              {launchPlan.map((step) => (
                <div className="mini-item dense" key={`${step.phase}-${step.label}`}>
                  <b>
                    {step.phase} · {step.label}
                  </b>
                  <span>{step.detail}</span>
                  <small className={stepClass(step.status)}>
                    {step.status === "needs_input"
                      ? "Needs input"
                      : step.status === "blocked"
                        ? "Blocked"
                        : "Ready"}{" "}
                    · {step.ownerVisible ? "Owner visible" : "Operator only"}
                  </small>
                </div>
              ))}
            </div>
          </div>

          <div className="section-label">Module plan</div>
          <div className="card">
            <ul className="security-list">
              {modulePlan.map((module) => (
                <li key={module.key}>
                  <span>
                    <b>{module.label}</b>
                    <small>{module.operatingUse}</small>
                  </span>
                  <span className={module.enabled ? "status-ok" : "status-neutral"}>
                    {module.enabled ? "Shown" : "Hidden"}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="section-label">Interview prompts</div>
          <div className="card">
            <div className="mini-list">
              {interviewPrompts.map((prompt) => (
                <div className="mini-item" key={prompt}>
                  <b>{prompt}</b>
                </div>
              ))}
            </div>
          </div>

          <div className="section-label">Starter scaffold</div>
          <div className="card">
            <div className="mini-list">
              {starterBlocks.map((block) => (
                <div className="mini-item dense" key={block.label}>
                  <b>{block.label}</b>
                  <span>{block.text}</span>
                </div>
              ))}
            </div>
            <p className="source-note">
              Use this as the initial interview script. The saved answers become
              Claude operating context, not contact data.
            </p>
          </div>

          <div className="section-label">Claude setup brief</div>
          <section className="ask-brief" aria-label="Claude setup brief">
            <label className="field">
              <span>
                Install brief
                {latestRevision ? ` · updated ${formatDate(latestRevision.createdAt)}` : ""}
              </span>
              <textarea readOnly value={installBrief} />
            </label>
            <p className="source-note">
              This is the compact handoff for configuring Claude behavior for this
              client install.
            </p>
          </section>

          <div className="section-label">Setup revision history</div>
          <div className="card">
            {revisions.length > 0 ? (
              <div className="mini-list">
                {revisions.map((revision) => (
                  <div className="mini-item dense" key={revision.id}>
                    <div className="mini-item-head">
                      <b>{revision.actionLabel}</b>
                      <span className="pill gold">
                        {formatDate(revision.createdAt)}
                      </span>
                    </div>
                    <span>{revision.summary}</span>
                    <small className="status-neutral">
                      {revision.changedSections.length} section
                      {revision.changedSections.length === 1 ? "" : "s"} changed ·{" "}
                      {revision.actorLabel}
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <b>No setup revisions yet.</b>
                <p>
                  Save the intake profile or install settings to create the first
                  operator-visible revision.
                </p>
              </div>
            )}
            <p className="source-note">
              This history comes from the tenant audit log, so it stays attached
              to the client install without creating another database surface.
            </p>
          </div>

          <div className="section-label">Write posture</div>
          <div className="card">
            <div className="kv">
              <span className="k">Mechanical</span>
              <span>
                {settings.write_rules.mechanical_writes ? "Enabled" : "Disabled"}
              </span>
            </div>
            <div className="kv">
              <span className="k">Judgment</span>
              <span>Proposal only</span>
            </div>
            <div className="kv">
              <span className="k">Transcript</span>
              <span>
                {settings.write_rules.transcript_storage === "detailed_notes"
                  ? "Detailed notes only"
                  : "Full intake transcript, then detailed notes"}
              </span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
