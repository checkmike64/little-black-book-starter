import Link from "next/link";
import { qualityStats } from "@/lib/data-quality";
import { productionCheckItems } from "@/lib/deployment-readiness";
import { requireOperatorAccess } from "@/lib/operator-access";
import { getPreinstallReviewData } from "@/lib/preinstall/data";
import { buildPreinstallEvidencePlan } from "@/lib/preinstall-evidence-plan";
import { normalizeTenantSettings } from "@/lib/tenant-settings";

function shortId(value: string) {
  return value.slice(0, 8);
}

export default async function PreinstallReviewPage() {
  const context = await requireOperatorAccess();
  const { contacts, loadError, review, setupMode } = await getPreinstallReviewData(
    context?.tenantId,
  );
  const quality = qualityStats(contacts);
  const settings = normalizeTenantSettings(context?.settings);
  const evidencePlan = buildPreinstallEvidencePlan({
    checks: productionCheckItems,
    records: settings.delivery.production_checks,
  });

  return (
    <>
      <div className="crumb">Client Admin / Pre-install review</div>
      <h1 className="portal-title">Pre-install review</h1>
      <p className="lede">
        Work that can be prepared safely is separated from decisions that still
        need the owner or source evidence.
      </p>

      {setupMode || loadError ? (
        <div className="notice" role="status">
          The review inventory could not be verified completely. No relationship
          decision has been made.
        </div>
      ) : null}

      <section className="statband" aria-label="Pre-install review counts">
        <div className="stat">
          <div className="number">{review.exactCandidates.length}</div>
          <div className="label">Exact identity matches</div>
        </div>
        <div className="stat">
          <div className="number">{review.identityReview.length}</div>
          <div className="label">Identity decisions</div>
        </div>
        <div className="stat">
          <div className="number">{quality.highValueWeak}</div>
          <div className="label">High-value cleanup</div>
        </div>
        <div className="stat">
          <div className="number">{review.sourceBlockedJobs.length}</div>
          <div className="label">Jobs missing source</div>
        </div>
      </section>

      <section className="grid two" aria-label="Pre-install work lanes">
        <article className="card">
          <h2>Exact identity matches</h2>
          <p>
            These proposals match exactly one existing person by both normalized
            name and email. They are prepared for review, but are not merged
            automatically.
          </p>
          {review.exactCandidates.length > 0 ? (
            <div className="mini-list compact">
              {review.exactCandidates.map(({ change, contact, reason }) => (
                <div className="mini-item" key={change.id}>
                  <div>
                    <b>{contact.full_name}</b>
                    <span>{reason}</span>
                  </div>
                  <Link className="button ghost small" href={`/changes/${change.id}`}>
                    Review merge
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No exact name-and-email matches are waiting.</p>
          )}
        </article>

        <article className="card">
          <h2>Identity decisions</h2>
          <p>
            These people do not have one exact existing match. Compare them one
            at a time; a name or email similarity is not enough to merge them.
          </p>
          {review.identityReview.length > 0 ? (
            <div className="mini-list compact">
              {review.identityReview.slice(0, 12).map(({ change, proposedName }) => (
                <div className="mini-item" key={change.id}>
                  <div>
                    <b>{proposedName}</b>
                    <span>Change {shortId(change.id)}</span>
                  </div>
                  <Link className="button ghost small" href={`/changes/${change.id}`}>
                    Compare
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No unresolved identity decisions are waiting.</p>
          )}
          {review.identityReview.length > 12 ? (
            <p className="source-note">
              {review.identityReview.length - 12} more are available in Changes.
            </p>
          ) : null}
        </article>

        <article className="card">
          <h2>Other repair proposals</h2>
          <p>
            These are existing-record proposals that need correction, replacement,
            or decline. They are never included with exact identity matches.
          </p>
          {review.operatorRepairs.length > 0 ? (
            <div className="mini-list compact">
              {review.operatorRepairs.map((change) => (
                <div className="mini-item" key={change.id}>
                  <div>
                    <b>{change.change_type.replaceAll("_", " ")}</b>
                    <span>Change {shortId(change.id)}</span>
                  </div>
                  <Link className="button ghost small" href={`/changes/${change.id}`}>
                    Review
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No other repair proposal is waiting.</p>
          )}
        </article>

        <article className="card">
          <h2>High-value cleanup</h2>
          <p>
            {quality.highValueWeak} high-value relationship record
            {quality.highValueWeak === 1 ? "" : "s"} still need verified facts or
            owner judgment before referral and outreach decisions should rely on them.
          </p>
          <div className="actions">
            <Link className="button ghost" href="/quality?view=high_value">
              Review data gaps
            </Link>
          </div>
        </article>

        <article className="card">
          <h2>Claude enrichment jobs</h2>
          <p>
            A due job is not safe to claim unless its authorized source material
            is available. A trigger or source label alone is not evidence.
          </p>
          {review.dueJobs.length > 0 ? (
            <div className="mini-list compact">
              {review.dueJobs.map((job) => (
                <div className="mini-item" key={job.id}>
                  <div>
                    <b>Job {shortId(job.id)}</b>
                    <span>
                      {job.sourceReady
                        ? "Source material is attached for operator review"
                        : "Blocked: source material is not attached"}
                    </span>
                  </div>
                  <Link className="button ghost small" href={`/ops/jobs/${job.id}`}>
                    Inspect
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No production enrichment job is due.</p>
          )}
        </article>
      </section>

      <div className="section-label">Installation evidence</div>
      <section className="statband" aria-label="Installation evidence counts">
        <div className="stat">
          <div className="number">
            {evidencePlan.confirmed}/{evidencePlan.total}
          </div>
          <div className="label">Evidence confirmed</div>
        </div>
        <div className="stat">
          <div className="number">
            {evidencePlan.technical.filter((item) => item.status !== "confirmed").length}
          </div>
          <div className="label">Technical items open</div>
        </div>
        <div className="stat">
          <div className="number">
            {evidencePlan.client.filter((item) => item.status !== "confirmed").length}
          </div>
          <div className="label">Client records open</div>
        </div>
        <div className="stat">
          <div className="number">{evidencePlan.evidenceNeeded}</div>
          <div className="label">Old checks missing proof</div>
        </div>
      </section>

      {evidencePlan.next ? (
        <section className="card">
          <span className="pill hot">Next evidence item</span>
          <h2>{evidencePlan.next.label}</h2>
          <p>{evidencePlan.next.evidenceNeeded}</p>
          <div className="actions">
            <Link className="button hot" href={evidencePlan.next.href}>
              {evidencePlan.next.actionLabel}
            </Link>
            <Link className="button ghost" href="/deployment">
              Open production signoff
            </Link>
          </div>
        </section>
      ) : null}

      <section className="grid two" aria-label="Installation evidence plan">
        <article className="card">
          <h2>Technical proof</h2>
          <p>
            These checks can be prepared before the client-specific agreement and
            operating decisions are final.
          </p>
          <div className="mini-list compact">
            {evidencePlan.technical.map((item) => (
              <div className="mini-item" key={item.key}>
                <div>
                  <b>{item.label}</b>
                  <span>{item.evidenceNeeded}</span>
                </div>
                <Link className="button ghost small" href={item.href}>
                  {item.statusLabel}
                </Link>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <h2>Client and operator records</h2>
          <p>
            These items require the exact client agreement, operating choices,
            restore evidence, or owner acceptance. The app does not fill them in.
          </p>
          <div className="mini-list compact">
            {evidencePlan.client.map((item) => (
              <div className="mini-item" key={item.key}>
                <div>
                  <b>{item.label}</b>
                  <span>{item.evidenceNeeded}</span>
                </div>
                <Link className="button ghost small" href={item.href}>
                  {item.statusLabel}
                </Link>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="card">
        <h2>Evidence stays outside the Book</h2>
        <p>
          The app stores only an opaque evidence ID and confirmation state. Keep
          agreements, private-invoice records, support exercises, restore output,
          retention rules, and owner acceptance in the restricted operator packet.
        </p>
        <div className="actions">
          <Link className="button ghost" href="/deployment">
            Open production signoff
          </Link>
          <Link className="button ghost" href="/admin">
            Back to Control Center
          </Link>
        </div>
      </section>
    </>
  );
}
