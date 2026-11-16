import { Download, ShieldCheck } from "lucide-react";
import Link from "next/link";
import {
  buildBookExportManifest,
} from "@/lib/book-export-manifest";
import { getBookExportSnapshot } from "@/lib/book-export";
import { requireOperatorAccess } from "@/lib/operator-access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function sectionStatus(section: {
  error?: string;
  truncated: boolean;
}) {
  if (section.error) return { className: "status-warn", label: "Failed" };
  if (section.truncated) return { className: "status-warn", label: "Capped" };
  return { className: "status-ok", label: "Included" };
}

export default async function ExportPage() {
  await requireOperatorAccess();
  const snapshot = await getBookExportSnapshot();
  const totalRows = snapshot.sections.reduce(
    (sum, section) => sum + (section.count ?? 0),
    0,
  );
  const exportManifest = buildBookExportManifest(snapshot.sections);
  const warningCount =
    exportManifest.failed.length + exportManifest.capped.length;
  const portableExportReady = snapshot.ok && exportManifest.portableExportReady;
  const installManifest = snapshot.ok ? snapshot.clientManifest : null;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="crumb">Export</div>
          <h1 className="portal-title">Book Export</h1>
          <p className="lede">
            Download a portable snapshot of selected relationship data for
            client handoff or offboarding. This is not a disaster-recovery
            backup of Supabase Auth, Storage, configuration, or credentials.
          </p>
        </div>
        <div className="actions">
          <Link className="button ghost" href="/export/owner-handoff">
            <Download aria-hidden={true} />
            Owner packet
          </Link>
          <Link className="button ghost" href="/export/handoff">
            <Download aria-hidden={true} />
            Handoff summary
          </Link>
          <Link className="button primary" href="/export/book">
            <Download aria-hidden={true} />
            Download JSON
          </Link>
        </div>
      </div>

      {!snapshot.ok ? <div className="notice">{snapshot.reason}</div> : null}
      {!portableExportReady ? (
        <div className="notice">
          Portable export is on hold. Resolve every failed or capped included
          section and every scope inventory mismatch before using it as
          offboarding evidence.
        </div>
      ) : null}
      <div className="notice">
        This portable export does not complete offboarding. Review excluded
        records, revoke access and integrations, apply the approved retention
        plan, and record separate return or deletion evidence.
      </div>

      <section className="statband" aria-label="Export summary">
        <div className="stat">
          <div className="number">{portableExportReady ? "Ready" : "Hold"}</div>
          <div className="label">Portable export</div>
        </div>
        <div className="stat">
          <div className="number">{totalRows}</div>
          <div className="label">Visible rows</div>
        </div>
        <div className="stat">
          <div className="number">{exportManifest.included.length}</div>
          <div className="label">Included sections</div>
        </div>
        <div className="stat">
          <div className="number">{warningCount}</div>
          <div className="label">Warnings</div>
        </div>
        <div className="stat">
          <div className="number">
            {exportManifest.scopeInventoryReady
              ? `${exportManifest.tenantScopedTableCount}/${exportManifest.tenantScopedTableCount}`
              : "Hold"}
          </div>
          <div className="label">Categorized tenant tables</div>
        </div>
      </section>

      <div className="grid two">
        <article className="card">
          <h2>Included Sections</h2>
          <ul className="security-list">
            {snapshot.sections.map((section) => {
              const status = sectionStatus(section);
              return (
                <li key={section.key}>
                  <span>
                    {section.label}
                    <small>
                      {section.error
                        ? `${section.table} could not be read; no database error detail is shown here.`
                        : `${section.table} through the signed-in user's RLS policies; ${
                          section.truncated
                            ? `${section.exportedCount} of ${section.count ?? "unknown"} rows available because the section cap is ${section.limit}`
                            : `${section.count ?? 0} rows available`
                        }`}
                    </small>
                  </span>
                  <span className={status.className}>{status.label}</span>
                </li>
              );
            })}
          </ul>
        </article>

        <article className="card">
          <h2>Excluded Sections</h2>
          <ul className="security-list">
            {exportManifest.excluded.map((section) => (
              <li key={section.label}>
                <span>
                  {section.label}
                  <small>
                    {section.tables.join(", ")}. {section.reason}
                  </small>
                </span>
                <span className="status-neutral">Excluded</span>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <div className="grid two">
        <article className="card">
          <h2>Privacy Posture</h2>
          <ul className="security-list">
            <li>
              <span>
                Uses the current browser session
                <small>No service-role export path is exposed.</small>
              </span>
              <span className="status-ok">RLS</span>
            </li>
            <li>
              <span>
                Includes private relationship context
                <small>
                  Contacts, private notes, pending changes, provenance, jobs,
                  and transcript records may be included.
                </small>
              </span>
              <span className="status-neutral">Sensitive</span>
            </li>
            <li>
              <span>
                No cloud storage handoff
                <small>The export is generated on demand and not saved by the app.</small>
              </span>
              <span className="status-ok">No store</span>
            </li>
          </ul>
        </article>

        <article className="card">
          <h2>Offboarding Boundary</h2>
          <p>
            An export is one input to offboarding, not proof that access,
            provider data, backups, credentials, or the production install were
            returned or deleted.
          </p>
          <div className="actions">
            <Link className="button ghost" href="/deployment">
              <ShieldCheck aria-hidden={true} />
              Review production signoff
            </Link>
          </div>
        </article>
      </div>

      {installManifest ? (
        <div className="grid two">
          <article className="card">
            <h2>Client Install Manifest</h2>
            <ul className="security-list">
              <li>
                <span>Owner visibility</span>
                <span className="status-ok">{installManifest.ownerVisibility}</span>
              </li>
              <li>
                <span>Review surface</span>
                <span className="status-ok">{installManifest.ownerReviewSurface}</span>
              </li>
              <li>
                <span>Enabled modules</span>
                <span className="status-neutral">{installManifest.enabledModules.length}</span>
              </li>
              <li>
                <span>Configured buckets</span>
                <span className="status-neutral">{installManifest.prospectingBuckets.length}</span>
              </li>
              <li>
                <span>Open setup items</span>
                <span className={installManifest.missingSetup.length ? "status-warn" : "status-ok"}>
                  {installManifest.missingSetup.length}
                </span>
              </li>
            </ul>
          </article>

          <article className="card">
            <h2>Write Posture</h2>
            <ul className="security-list">
              <li>
                <span>Mechanical writes</span>
                <span className="status-neutral">
                  {installManifest.writePosture.mechanicalWrites}
                </span>
              </li>
              <li>
                <span>Judgment fields</span>
                <span className="status-ok">{installManifest.writePosture.judgmentFields}</span>
              </li>
              <li>
                <span>Transcript storage</span>
                <span className="status-neutral">
                  {installManifest.writePosture.transcriptStorage}
                </span>
              </li>
            </ul>
          </article>
        </div>
      ) : null}
    </>
  );
}
