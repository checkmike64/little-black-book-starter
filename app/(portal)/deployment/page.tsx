import Link from "next/link";
import { updateProductionCheck } from "@/app/(portal)/deployment/actions";
import { getDeploymentData } from "@/lib/deployment/data";
import {
  requiredVercelEnvironment,
} from "@/lib/deployment-readiness";
import {
  clientInstallRehearsal,
  rehearsalCommand,
} from "@/lib/install-rehearsal";
import { requireOperatorAccess } from "@/lib/operator-access";
import {
  existingDataBackfillSql,
  supabaseLiveAuditSql,
  tenantBootstrapSql,
} from "@/lib/supabase-install-sql";

type SearchParams = Record<string, string | string[] | undefined>;

function statusClass(tone: "ok" | "warn" | "neutral") {
  if (tone === "ok") return "status-ok";
  if (tone === "warn") return "status-warn";
  return "status-neutral";
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null) {
  if (!value) return "No date";

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function DeploymentPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  await requireOperatorAccess();
  const params = searchParams ? await searchParams : {};
  const message = firstParam(params.message);
  const {
    context,
    readiness,
    productionEvidence,
    installManifest,
    launchPlan,
    launchReadiness,
    redirectUrls,
    liveSmoke,
    signedInOwnerSmoke,
    rehearsal,
    launchGates,
  } = await getDeploymentData();

  return (
    <>
      <div className="topbar">
        <div>
          <div className="crumb">Deployment</div>
          <h1 className="portal-title">Deployment</h1>
          <p className="lede">
            Production preflight for a private client install on Vercel and
            Supabase.
          </p>
        </div>
        <div className="actions">
          <Link className="button ghost" href="/launch">
            Launch checklist
          </Link>
          <Link className="button ghost" href="/claude-setup">
            Claude setup
          </Link>
        </div>
      </div>

      <section className="statband" aria-label="Deployment readiness">
        <div className="stat">
          <div className="number">{readiness.ready ? "Ready" : "Hold"}</div>
          <div className="label">Deploy status</div>
        </div>
        <div className="stat">
          <div className="number">{readiness.blockingCount}</div>
          <div className="label">Blocking items</div>
        </div>
        <div className="stat">
          <div className="number">{rehearsal.steps}</div>
          <div className="label">Rehearsal steps</div>
        </div>
        <div className="stat">
          <div className="number">{launchReadiness.percent}%</div>
          <div className="label">Client plan ready</div>
        </div>
        <div className="stat">
          <div className="number">
            {productionEvidence.confirmed}/{productionEvidence.total}
          </div>
          <div className="label">Production signoff</div>
        </div>
      </section>

      {message ? <div className="notice">{message}</div> : null}

      {readiness.ready ? (
        <div className="notice">
          Core deployment inputs are present. Still run the manual Supabase and
          Vercel checks before putting a client install into production.
        </div>
      ) : (
        <div className="notice">
          Some production inputs are still missing. Keep this install in testing
          until the warnings below are cleared.
        </div>
      )}

      <div className="section-label">Client launch gates</div>
      <div className="grid two">
        <article className="card">
          <h2>{launchGates.ready ? "Ready For Handoff" : "Next Operator Move"}</h2>
          <p className="muted">{launchGates.summary}</p>
          <div className="actions">
            <Link className="button hot" href={launchGates.next?.href ?? "/deployment"}>
              {launchGates.next?.label ?? "Review deployment"}
            </Link>
            <Link className="button ghost" href="/launch/preview">
              Owner preview
            </Link>
          </div>
        </article>

        <article className="card">
          <h2>Gate Status</h2>
          <ul className="security-list">
            {launchGates.gates.map((gate) => (
              <li key={gate.key}>
                <span>
                  <b>{gate.label}</b>
                  <small>{gate.detail}</small>
                </span>
                <Link
                  className={
                    gate.status === "pass"
                      ? "status-ok"
                      : gate.status === "action"
                        ? "status-warn"
                        : "status-neutral"
                  }
                  href={gate.href}
                >
                  {gate.status === "pass"
                    ? "Pass"
                    : gate.status === "action"
                      ? "Fix"
                      : "Waiting"}
                </Link>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <div className="grid two">
        <article className="card">
          <h2>Environment Preflight</h2>
          <ul className="security-list">
            {readiness.checks.map((check) => (
              <li key={check.label}>
                <span>
                  {check.label}
                  <small>{check.detail}</small>
                </span>
                <span className={statusClass(check.tone)}>{check.value}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Vercel Variables</h2>
          <ul className="security-list">
            {requiredVercelEnvironment.map((key) => (
              <li key={key}>
                <span>{key}</span>
                <span
                  className={
                    key.startsWith("NEXT_PUBLIC_") ? "status-neutral" : "status-ok"
                  }
                >
                  {key.startsWith("NEXT_PUBLIC_") ? "Browser safe" : "Server only"}
                </span>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <div className="grid two">
        <article className="card">
          <h2>Supabase Auth URLs</h2>
          <ul className="security-list">
            {redirectUrls.map((url) => (
              <li key={url}>
                <span>{url}</span>
                <span className="status-neutral">Allow</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Production Signoff</h2>
          <ul className="security-list">
            {productionEvidence.items.map((item) => (
              <li key={item.key}>
                <span>
                  <b>{item.label}</b>
                  <small>{item.detail}</small>
                  {item.confirmed ? (
                    <small>
                      Confirmed {formatDate(item.confirmedAt)}
                      {item.confirmedBy ? " by operator" : ""}
                    </small>
                  ) : null}
                </span>
                <form action={updateProductionCheck} className="inline-form">
                  <input name="key" type="hidden" value={item.key} />
                  <input
                    name="settings_version"
                    type="hidden"
                    value={context?.settingsVersion ?? 1}
                  />
                  <label>
                    <span className="visually-hidden">
                      External evidence ID for {item.label}
                    </span>
                    <input
                      aria-label={`External evidence ID for ${item.label}`}
                      defaultValue={item.evidenceRef ?? ""}
                      maxLength={500}
                      name="evidence_ref"
                      pattern="[A-Za-z0-9][A-Za-z0-9._:/-]{5,499}"
                      placeholder="Opaque evidence ID"
                      title="Use an opaque external record ID, not client details or a URL."
                      type="text"
                    />
                  </label>
                  <label className="toggle-row compact">
                    <input
                      defaultChecked={item.confirmed}
                      name="confirmed"
                      type="checkbox"
                    />
                    <span>{item.confirmed ? "Confirmed" : "Confirm"}</span>
                  </label>
                  <button className="button quiet" type="submit">
                    Save
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <p className="source-note">
            These are operator-held controls. They become launch evidence, but
            they do not expose setup workflows to the executive owner.
          </p>
        </article>
      </div>

      <div className="section-label">Client install manifest</div>
      <div className="grid three">
        <article className="card">
          <h2>Owner Surface</h2>
          <ul className="security-list">
            <li>
              <span>Setup model</span>
              <span className="status-ok">Operator-led</span>
            </li>
            <li>
              <span>Owner visibility</span>
              <span className="status-ok">{installManifest.ownerVisibility}</span>
            </li>
            <li>
              <span>Review surface</span>
              <span className="status-ok">{installManifest.ownerReviewSurface}</span>
            </li>
          </ul>
        </article>

        <article className="card">
          <h2>Enabled Modules</h2>
          <ul className="security-list">
            {(installManifest.enabledModules.length
              ? installManifest.enabledModules
              : ["None enabled"]
            ).map((module) => (
              <li key={module}>
                <span>{module}</span>
                <span className={module === "None enabled" ? "status-warn" : "status-ok"}>
                  {module === "None enabled" ? "Review" : "Visible"}
                </span>
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Open Setup Items</h2>
          <ul className="security-list">
            {(installManifest.missingSetup.length
              ? installManifest.missingSetup
              : ["None"]
            ).map((item) => (
              <li key={item}>
                <span>{item}</span>
                <span className={item === "None" ? "status-ok" : "status-warn"}>
                  {item === "None" ? "Ready" : "Needed"}
                </span>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <div className="section-label">Client handoff plan</div>
      <article className="card">
        <ul className="security-list">
          {launchPlan.map((step) => (
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

      <div className="section-label">Supabase bootstrap and audit</div>
      <div className="grid two">
        <article className="card">
          <h2>Tenant Bootstrap SQL</h2>
          <p className="muted">
            Run after the executive owner has signed in once and exists in
            Supabase Auth. Replace the placeholders before running.
          </p>
          <pre className="json-box">{tenantBootstrapSql}</pre>
        </article>

        <article className="card">
          <h2>Live Audit SQL</h2>
          <p className="muted">
            Run after migrations and bootstrap. Every row should be pass or an
            intentional review item before client handoff.
          </p>
          <pre className="json-box">{supabaseLiveAuditSql}</pre>
        </article>
      </div>

      <div className="section-label">Existing data conversion</div>
      <article className="card">
        <h2>Tenant Backfill SQL</h2>
        <p className="muted">
          Use only when converting an existing single-client project that already
          has relationship rows with no tenant id. Skip this for a fresh client
          install.
        </p>
        <pre className="json-box">{existingDataBackfillSql}</pre>
      </article>

      <div className="section-label">Client install rehearsal</div>
      <div className="grid two">
        <article className="card">
          <h2>Runbook</h2>
          <ul className="security-list">
            {clientInstallRehearsal.map((step) => (
              <li key={`${step.phase}-${step.label}`}>
                <span>
                  <b>
                    {step.phase} · {step.label}
                  </b>
                  <small>{step.detail}</small>
                  <small>Evidence: {step.evidence}</small>
                </span>
                <span className="status-neutral">{step.owner}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Local Rehearsal Command</h2>
          <p className="muted">
            Run this before a clean client install and again before production
            handoff. It checks repo-level privacy, RLS migration coverage, Claude
            gateway presence, and secret naming mistakes.
          </p>
          <pre className="json-box">{rehearsalCommand}</pre>
          <div className="kv">
            <span className="k">Phases</span>
            <span>{rehearsal.phases}</span>
          </div>
          <div className="kv">
            <span className="k">Steps</span>
            <span>{rehearsal.steps}</span>
          </div>
        </article>
      </div>

      <div className="section-label">Live deployment smoke</div>
      <article className="card">
        <h2>Owner Flow Production Smoke</h2>
        <p className="muted">
          Run after Vercel deploys. It checks the private owner routes, crawler
          blocking, protected redirects, and unsigned Claude gateway rejection
          against {liveSmoke.target}.
        </p>
        <pre className="json-box">{liveSmoke.command}</pre>
        <div className="grid two">
          <div>
            <h3>Owner routes covered</h3>
            <ul className="security-list">
              {liveSmoke.ownerRoutes.map((route) => (
                <li key={route.path}>
                  <span>
                    <b>{route.label}</b>
                    <small>
                      {route.path} · {route.expected}
                    </small>
                  </span>
                  <span className="status-neutral">Redirect check</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Evidence expected</h3>
            <ul className="security-list">
              {liveSmoke.evidence.map((item) => (
                <li key={item}>
                  <span>{item}</span>
                  <span className="status-neutral">Smoke</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </article>

      <div className="section-label">Signed-in owner smoke</div>
      <article className="card">
        <h2>Owner Experience Check</h2>
        <p className="muted">
          Run this after signing in as the executive owner on {signedInOwnerSmoke.target}.
          It verifies the working product surface, not just the security redirects.
        </p>
        <pre className="json-box">{signedInOwnerSmoke.command}</pre>
        <div className="grid two">
          <div>
            <h3>Owner pages to inspect</h3>
            <ul className="security-list">
              {signedInOwnerSmoke.routes.map((route) => (
                <li key={route.path}>
                  <span>
                    <b>{route.label}</b>
                    <small>
                      {route.path} · H1 should include "{route.expectedHeading}"
                    </small>
                    <small>{route.evidence}</small>
                  </span>
                  <span className="status-neutral">Signed in</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Owner-mode guardrails</h3>
            <ul className="security-list">
              {signedInOwnerSmoke.evidence.map((item) => (
                <li key={item}>
                  <span>{item}</span>
                  <span className="status-neutral">Verify</span>
                </li>
              ))}
              <li>
                <span>
                  Forbidden normal-mode nav
                  <small>{signedInOwnerSmoke.forbiddenNavLabels.join(", ")}</small>
                </span>
                <span className="status-ok">Hidden</span>
              </li>
            </ul>
          </div>
        </div>
      </article>

      <div className="section-label">Supabase email template</div>
      <article className="card">
        <h2>Auth email delivery</h2>
        <p className="muted">
          Configure a production SMTP provider, then include the one-time code in
          the Supabase Auth email so a client can paste the code if the magic link
          was opened in a different browser. Test both delivery and code entry for
          the exact install before confirming this check.
        </p>
        <pre className="json-box">{`Sign in to Little Black Book

Use this private link:
{{ .ConfirmationURL }}

Or enter this code in the app:
{{ .Token }}`}</pre>
      </article>
    </>
  );
}
