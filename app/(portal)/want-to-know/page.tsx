import { ClipboardList, ExternalLink, Radar, Route } from "lucide-react";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  logWantToKnowTouch,
  proposeWantToKnowGraduation,
  updateWantToKnowStage,
} from "@/app/(portal)/want-to-know/actions";
import { adminToolsCookieName, shouldUseAdminTools } from "@/lib/admin-mode";
import { requireEnabledModule } from "@/lib/module-gate";
import { buildOwnerFirstUseState } from "@/lib/owner-first-use";
import {
  getProspectingBucketMap,
  prospectingBucketExamples,
  type ProspectingBucketMap,
} from "@/lib/prospecting-buckets";
import {
  bucketOperatingRows,
  buildBucketOperatingPrompt,
  buildCandidateResearchPacket,
  buildProspectingBucketSetupRows,
  dossierValue,
  nextStageOptions,
  prospectingStages,
  stageColumns,
  stageLabel,
  type ProspectingOpsCandidate,
  type ProspectingStage,
} from "@/lib/prospecting-ops";
import { buildBucketResearchPrompt } from "@/lib/prospecting-workflow";
import { proposalConfidence } from "@/lib/pending-change-inspection";
import { getTenantContext } from "@/lib/tenant-context";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { OwnerWantToKnowWorkspace } from "@/app/(portal)/want-to-know/owner-workspace";
import {
  bucketConfig,
  getPendingProspectingProposals,
  getWantToKnow,
  type Candidate,
} from "@/lib/want-to-know/data";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const stages = prospectingStages;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validStage(value: string | undefined): ProspectingStage | "all" {
  if (!value || value === "all") return "all";
  return stages.includes(value as ProspectingStage)
    ? (value as ProspectingStage)
    : "all";
}

function validBucket(value: string | undefined, buckets: string[]) {
  if (!value || value === "all") return "all";
  return buckets.includes(value) ? value : "all";
}

function daysSince(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 1000 / 60 / 60 / 24));
}

function cleanString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function pendingProposalVerification(payload: Record<string, unknown>) {
  const verification = payload.verification;
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
    return "";
  }

  return cleanString((verification as Record<string, unknown>).owner_question);
}

function pendingProposalEvidence(payload: Record<string, unknown>) {
  const evidence = payload.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return "";

  return Object.entries(evidence as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${String(value).slice(0, 120)}`)
    .join(" · ");
}

function proposalAge(value: string) {
  const days = daysSince(value);
  if (days === null) return "Recently proposed";
  if (days === 0) return "Proposed today";
  return `Proposed ${days} day${days === 1 ? "" : "s"} ago`;
}

function touchLine(candidate: ProspectingOpsCandidate) {
  if (candidate.staleDays === null) return "No touch logged";
  if (candidate.staleDays === 0) return "Touched today";
  return `${candidate.staleDays} day${candidate.staleDays === 1 ? "" : "s"} since touch`;
}

function candidateSourceFacts(candidate: ProspectingOpsCandidate) {
  return [
    candidate.source ? `Source: ${candidate.source}` : "Source not stored",
    candidate.lane ? `Lane: ${candidate.lane}` : null,
    candidate.engagement_count
      ? `${candidate.engagement_count} recorded touch${candidate.engagement_count === 1 ? "" : "es"}`
      : null,
  ].filter(Boolean).join(" · ");
}

function stageClass(stage: ProspectingStage) {
  if (stage === "ready") return "pill hot";
  if (stage === "warming") return "pill gold";
  if (stage === "graduated") return "pill cool";
  return "pill";
}

function bucketSetupClass(tone: "hot" | "gold" | "cool") {
  if (tone === "hot") return "pill hot";
  if (tone === "gold") return "pill gold";
  return "pill cool";
}

function bucketSourceLabel(source: string) {
  return source === "client" ? "custom" : "template";
}

function relationshipPriorityLabel(value: Candidate["relationship_priority"]) {
  if (value === "high") return "High priority";
  if (value === "watch") return "Watch";
  return "Standard priority";
}

function monthlyEngagementLabel(value: number | null) {
  const count = value ?? 1;
  if (count === 0) return "Watch";
  return `${count} touch${count === 1 ? "" : "es"} / month`;
}

function claudePrompt(
  candidates: Candidate[],
  bucketMap: ProspectingBucketMap,
  bucketExamples: string,
) {
  if (candidates.length === 0) {
    return [
      "Seed the Little Black Book Want to Know list.",
      "",
      "Review the owner intake, recent calls, transcript notes, correspondence summaries, and existing contact context.",
      "Identify people the owner wants to meet, understand, research, warm, or eventually graduate into the Book.",
      "",
      "For each candidate, return:",
      "- full_name",
      `- bucket: the exact prospecting bucket this person belongs in. Current configured examples: ${bucketExamples}`,
      "- lane: podcast, referral, client, partner, investor, M&A, or other useful lane",
      "- stage: watching, warming, ready, or graduated",
      "- company",
      "- source",
      "- factual source context showing where this person was found",
      "- dossier.goal",
      "- dossier.look_for",
      "- dossier.next_touch",
      "",
      "The bucket is flexible and purpose-specific. Do not assume the owner wants podcast outreach unless the intake or source context says so.",
      "",
      "Do not invent people. If the source context is weak, ask the owner for verification before creating records.",
    ].join("\n");
  }

  const shortlist = candidates
    .filter((candidate) => candidate.stage !== "graduated")
    .slice(0, 8)
    .map((candidate, index) => {
      const config = bucketConfig(candidate.bucket, bucketMap);
      const goal = dossierValue(candidate.dossier, "goal") || config.goal;
      const lookFor = dossierValue(candidate.dossier, "look_for") || config.look_for;
      return `${index + 1}. ${candidate.full_name}${candidate.company ? `, ${candidate.company}` : ""} - ${candidate.bucket ?? "Uncategorized"} / ${candidate.stage}. ${candidateSourceFacts(candidate)} Goal: ${goal} Look for: ${lookFor} Suggested action: ${candidate.action}`;
    });

  return [
    "Review this Little Black Book outer-ring candidate list.",
    "Recommend who should be researched, warmed, paused, or graduated into the book by prospecting bucket.",
    "",
    ...(shortlist.length ? shortlist : ["No active candidates are visible."]),
    "",
    "Keep this lightweight: do not turn it into a CRM campaign. Respect the bucket purpose, recommend one useful next touch per person, and route any database writes through pending changes unless the update is purely mechanical.",
  ].join("\n");
}

export default async function WantToKnowPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  await requireEnabledModule("want_to_know");

  const params = searchParams ? await searchParams : {};
  const message = firstParam(params.message);
  const stageFilter = validStage(firstParam(params.stage));
  const context = await getTenantContext();
  const cookieStore = await cookies();
  const adminMode = shouldUseAdminTools({
    cookieValue: cookieStore.get(adminToolsCookieName)?.value,
    role: context?.role,
  });
  const settings = normalizeTenantSettings(context?.settings);
  const prospectingBucketMap = getProspectingBucketMap(settings);

  if (!adminMode) {
    return <OwnerWantToKnowWorkspace message={message} searchParams={params} />;
  }

  const { candidates, count, setupMode } = await getWantToKnow(
    prospectingBucketMap,
  );

  const pendingProposals = await getPendingProspectingProposals();
  const bucketSummaries = bucketOperatingRows(candidates, prospectingBucketMap);
  const bucketSetupRows = buildProspectingBucketSetupRows({
    rows: bucketSummaries,
    customBucketNames: settings.prospecting.buckets.map((bucket) => bucket.name),
    pendingProposalBuckets: pendingProposals.map((proposal) => proposal.bucket),
  });
  const bucketNames = Array.from(
    new Set([
      ...bucketSummaries.map((summary) => summary.bucket),
      ...pendingProposals.map((proposal) => proposal.bucket),
    ]),
  ).sort((a, b) => a.localeCompare(b));
  const bucketFilter = validBucket(firstParam(params.bucket), bucketNames);
  const activeCandidates = candidates.filter((candidate) => candidate.stage !== "graduated");
  const staleCandidateCount = activeCandidates.filter(
    (candidate) => candidate.staleDays !== null && candidate.staleDays > 21,
  ).length;
  const filteredCandidates =
    candidates
      .filter((candidate) =>
        stageFilter === "all" ? true : candidate.stage === stageFilter,
      )
      .filter((candidate) =>
        bucketFilter === "all" ? true : candidate.bucket === bucketFilter,
      );
  const filteredPendingProposals = pendingProposals.filter((proposal) =>
    bucketFilter === "all" ? true : proposal.bucket === bucketFilter,
  );
  const customBucketCount = bucketSetupRows.filter(
    (bucket) => bucket.source === "client",
  ).length;
  const bucketsNeedingSetup = bucketSetupRows.filter(
    (bucket) => bucket.status === "needs_config" || bucket.status === "needs_seed",
  ).length;
  const pipelineColumns = stageColumns(candidates);
  const selectedBucket =
    bucketFilter === "all"
      ? bucketSummaries.find((summary) => summary.active.length > 0) ?? bucketSummaries[0]
      : bucketSummaries.find((summary) => summary.bucket === bucketFilter) ?? null;
  const topResearchPackets = filteredCandidates
    .filter((candidate) => candidate.stage !== "graduated")
    .slice(0, 4);
  const readyToWarm = activeCandidates
    .filter((candidate) => candidate.stage === "ready" || candidate.stage === "warming")
    .slice(0, 6);
  const firstUse = buildOwnerFirstUseState("want_to_know", {
    bucketCount: bucketNames.length,
    candidateCount: count,
    filtered: count > 0 || stageFilter !== "all" || bucketFilter !== "all",
  });
  const prompt = claudePrompt(
    candidates,
    prospectingBucketMap,
    prospectingBucketExamples(settings),
  );

  if (!setupMode && count === 0 && pendingProposals.length === 0) {
    return (
      <>
        <div className="crumb">Want to Know</div>
        <h1 className="portal-title">Want to Know</h1>
        <p className="lede">
          Prospects stay outside the Book until there is enough verified context
          to spend relationship capital well.
        </p>
        {message ? <div className="notice" role="status">{message}</div> : null}

        <section className="empty-state prospecting-clear-state">
          <span className="pill cool">Outer ring clear</span>
          <b>No verified candidates are waiting.</b>
          <p>
            Research will propose people here only when a purpose lane, source,
            reason, and next useful touch are strong enough for review.
          </p>
          <div className="actions">
            <Link className="button hot" href="/ask?mode=search&q=who%20should%20I%20meet%20next">
              Ask who fits
            </Link>
            <Link className="button ghost" href="/changes">
              Review proposals
            </Link>
          </div>
        </section>

        <details className="secondary-workflow prospecting-lane-summary">
          <summary>View {bucketSetupRows.length} configured purpose lanes</summary>
          <div className="grid two">
            {bucketSetupRows.map((bucket) => (
              <article className="card" key={bucket.bucket}>
                <div className="mini-item-head">
                  <h2>{bucket.bucket}</h2>
                  <span className={bucketSetupClass(bucket.tone)}>
                    {bucket.source === "client" ? "Active" : "Template"}
                  </span>
                </div>
                <p>{bucket.goal}</p>
              </article>
            ))}
          </div>
        </details>
      </>
    );
  }

  return (
    <>
      <div className="crumb">Want to Know</div>
      <h1 className="portal-title">Want to Know</h1>
      <p className="lede">
        Prospects and future relationship candidates, grouped by purpose and warmed
        only when there is a useful reason.
      </p>

      {message ? <div className="notice">{message}</div> : null}

      {setupMode ? (
        <div className="notice">
          Your outer ring is still being prepared. A small preview is shown
          until verified relationship candidates are ready.
        </div>
      ) : null}

      {!setupMode && count === 0 ? (
        <div className="notice">
          The outer ring is empty. Verified candidates will appear here once a
          prospecting bucket has enough source context to be useful.
        </div>
      ) : null}

      <section className="statband" aria-label="Want to know stats">
        <div className="stat">
          <div className="number">{count}</div>
          <div className="label">Candidates</div>
        </div>
        <div className="stat">
          <div className="number">{customBucketCount}</div>
          <div className="label">Purpose lanes</div>
        </div>
        <div className="stat">
          <div className="number">
            {candidates.filter((row) => row.stage === "ready").length}
          </div>
          <div className="label">Ready</div>
        </div>
        <div className="stat">
          <div className="number">{pendingProposals.length}</div>
          <div className="label">Pending review</div>
        </div>
        <div className="stat">
          <div className="number">
            {staleCandidateCount}
          </div>
          <div className="label">Stale candidates</div>
        </div>
      </section>

      <form className="ask-bar" action="/want-to-know">
        <label className="field">
          <span>Stage</span>
          <select defaultValue={stageFilter} name="stage">
            <option value="all">All stages</option>
            {stages.map((stage) => (
              <option key={stage} value={stage}>
                {stageLabel(stage)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Prospecting bucket</span>
          <select defaultValue={bucketFilter} name="bucket">
            <option value="all">All buckets</option>
            {bucketNames.map((bucket) => (
              <option key={bucket} value={bucket}>
                {bucket}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Mode</span>
          <input readOnly value="Relationship research" />
        </div>
        <button className="button hot" type="submit">
          Filter
        </button>
      </form>

      <div className="section-label">Purpose lanes</div>
      <section className="card">
        <div className="mini-item-head">
          <h2>Prospecting Buckets</h2>
          <span className={bucketsNeedingSetup > 0 ? "pill gold" : "pill cool"}>
            {bucketsNeedingSetup > 0
              ? `${bucketsNeedingSetup} lane${
                  bucketsNeedingSetup === 1 ? "" : "s"
                } need candidates`
              : "Configured"}
          </span>
        </div>
        <p className="muted">
          Buckets stay flexible: podcast hosts, acquisition targets, investors,
          referral partners, or any other named outer-ring goal for this Book.
        </p>
        <div className="mini-list">
          {bucketSetupRows.slice(0, 9).map((bucket) => (
            <Link
              className="mini-item dense link-quiet"
              href={`/want-to-know?bucket=${encodeURIComponent(bucket.bucket)}`}
              key={bucket.bucket}
            >
              <div className="mini-item-head">
                <b>{bucket.bucket}</b>
                <span>
                  <span className={bucketSetupClass(bucket.tone)}>
                    {bucket.label}
                  </span>
                  <span className="pill">{bucketSourceLabel(bucket.source)}</span>
                </span>
              </div>
              <span>{bucket.goal}</span>
              <span>
                {bucket.activeCount} active · {bucket.pendingProposalCount} pending ·{" "}
                Look for: {bucket.lookFor}
              </span>
              <span>{bucket.action}</span>
            </Link>
          ))}
        </div>
        <p className="source-note">
          Template lanes are reusable examples. Active lanes can be changed later
          without changing the rest of the book.
        </p>
      </section>

      <div className="section-label">
        Awaiting your read · {filteredPendingProposals.length}
      </div>
      <div className="card">
        {filteredPendingProposals.length > 0 ? (
          <div className="mini-list">
            {filteredPendingProposals.map((proposal) => {
              const company = cleanString(proposal.candidate.company);
              const lane = cleanString(proposal.candidate.lane);
              const verification = pendingProposalVerification(proposal.payload);
              const evidence = pendingProposalEvidence(proposal.payload);

              return (
                <div className="mini-item dense" key={proposal.id}>
                  <div className="mini-item-head">
                    <b>{proposal.fullName}</b>
                    <span>
                      <span className="pill hot">Review</span>
                      <span className="pill cool">{proposal.bucket}</span>
                    </span>
                  </div>
                  <span>
                    {company || lane || "No company stored"} ·{" "}
                    {proposal.source ?? "prospecting proposal"} ·{" "}
                    {proposalAge(proposal.created_at)}
                  </span>
                  <span>Confidence: {proposalConfidence(proposal.payload)}</span>
                  {verification ? <span>Verify: {verification}</span> : null}
                  {evidence ? <span>Evidence: {evidence}</span> : null}
                  <div className="actions">
                    <Link className="button small hot" href={`/changes/${proposal.id}`}>
                      Review candidate
                    </Link>
                    <Link className="button small ghost" href="/changes">
                      Changes queue
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <b>No pending candidates for this bucket.</b>
            <p>
              New candidates appear here for review before they become part of
              the active prospecting board.
            </p>
          </div>
        )}
        <p className="source-note">
          This inbox shows proposed Want-to-Know candidates only. Approval still
          happens in Changes so bucket fit, evidence, and owner verification stay
          reviewable before anything enters the durable outer ring.
        </p>
      </div>

      <div className="section-label">Prospecting command center</div>
      <div className="prospecting-board">
        {bucketSummaries.slice(0, 9).map((summary) => {
          const {
            active,
            bucket,
            config,
            pressure,
            ready,
            rows,
            stale,
            topCandidate,
            watching,
            warming,
          } = summary;

          return (
            <article className="prospecting-bucket" key={bucket}>
              <div className="mini-item-head">
                <h2>{bucket}</h2>
                <span className={`pill ${summary.health.tone}`}>
                  {summary.health.label}
                </span>
              </div>
              <p>{config.goal}</p>
              <div className="bucket-metrics">
                <span>
                  <b>{active.length}</b>
                  active
                </span>
                <span>
                  <b>{watching.length}</b>
                  watching
                </span>
                <span>
                  <b>{warming.length}</b>
                  warming
                </span>
                <span>
                  <b>{ready.length}</b>
                  ready
                </span>
              </div>
              <div className="kv">
                <span className="k">Look for</span>
                <span>{config.look_for}</span>
              </div>
              <div className="kv">
                <span className="k">Top move</span>
                <span>
                  {topCandidate
                    ? `${topCandidate.full_name}: ${topCandidate.action}`
                    : "Seed one verified candidate only if this bucket is active for the client."}
                </span>
              </div>
              <div className="kv">
                <span className="k">Pressure</span>
                <span>
                  {pressure} · {stale.length} stale · {rows.length} total ·{" "}
                  {config.intensity} intensity
                </span>
              </div>
              <div className="kv">
                <span className="k">Next</span>
                <span>
                  {summary.health.nextAction}
                </span>
              </div>
            </article>
          );
        })}
      </div>

      <div className="section-label">Stage pipeline</div>
      <div className="stage-pipeline">
        {pipelineColumns.map((column) => (
          <section className="stage-column" key={column.stage}>
            <div className="stage-column-head">
              <b>{column.label}</b>
              <span>{column.rows.length}</span>
            </div>
            <p>{column.instruction}</p>
            <div className="mini-list">
              {column.rows.slice(0, 4).map((candidate) => (
                <div className="mini-item dense" key={`${column.stage}-${candidate.id}`}>
                  <b>{candidate.full_name}</b>
                  <span>{candidate.bucket ?? "Uncategorized"}</span>
                  <span>{touchLine(candidate)}</span>
                </div>
              ))}
              {column.rows.length === 0 ? (
                <span className="source-note">No candidates in this stage.</span>
              ) : null}
            </div>
          </section>
        ))}
      </div>

      {adminMode && selectedBucket ? (
        <>
          <div className="section-label">Selected bucket operating prompt</div>
          <section className="ask-brief" aria-label={`${selectedBucket.bucket} operating prompt`}>
            <label className="field">
              <span>
                <Route aria-hidden={true} size={14} /> {selectedBucket.bucket}
              </span>
              <textarea
                readOnly
                value={buildBucketOperatingPrompt({
                  bucket: selectedBucket.bucket,
                  candidates: selectedBucket.rows,
                  config: selectedBucket.config,
                })}
              />
            </label>
            <p className="source-note">
              This is the working prompt for the current bucket. It keeps
              prospecting flexible, tied to the client&apos;s bucket label, and
              routed through pending changes.
            </p>
          </section>
        </>
      ) : null}

      <div className="grid two">
        <section>
          <div className="section-label">
            Candidate queue · {filteredCandidates.length}
          </div>
          <div className="card">
            {filteredCandidates.length > 0 ? (
              <div className="mini-list">
                {filteredCandidates.map((candidate) => (
                  <div className="mini-item dense" key={candidate.id}>
                    <div className="mini-item-head">
                      <b>{candidate.full_name}</b>
                      <span>
                        <span className={stageClass(candidate.stage)}>{candidate.stage}</span>
                        <span className="pill cool">{candidate.intensity}</span>
                      </span>
                    </div>
                    <span>
                      {candidate.company ?? candidate.lane ?? "No company stored"} ·{" "}
                      Prospecting bucket: {candidate.bucket ?? "Uncategorized"} ·{" "}
                      {touchLine(candidate)}
                    </span>
                    <span>{candidateSourceFacts(candidate)}</span>
                    <span>{candidate.action}</span>
                    <div className="actions">
                      <form action={logWantToKnowTouch}>
                        <input
                          name="want_to_know_id"
                          type="hidden"
                          value={candidate.id}
                        />
                        <button className="button small ghost" type="submit">
                          Log touch
                        </button>
                      </form>
                      {candidate.stage !== "graduated" ? (
                        <form action={proposeWantToKnowGraduation}>
                          <input
                            name="want_to_know_id"
                            type="hidden"
                            value={candidate.id}
                          />
                          <button className="button small hot" type="submit">
                            Propose graduation
                          </button>
                        </form>
                      ) : null}
                      {candidate.linkedin ? (
                        <a className="button small ghost" href={candidate.linkedin}>
                          LinkedIn <ExternalLink aria-hidden="true" size={13} />
                        </a>
                      ) : null}
                      {nextStageOptions(candidate.stage).map((stage) => (
                        <form action={updateWantToKnowStage} key={stage}>
                          <input
                            name="want_to_know_id"
                            type="hidden"
                            value={candidate.id}
                          />
                          <input name="stage" type="hidden" value={stage} />
                          <button className="button small ghost" type="submit">
                            {stageLabel(stage)}
                          </button>
                        </form>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="section-label">{firstUse.eyebrow}</span>
                <b>{firstUse.title}</b>
                <p>{firstUse.detail}</p>
                <ul className="security-list">
                  {firstUse.proof.map((item) => (
                    <li key={item}>
                      <span>{item}</span>
                      <span className="status-ok">Flexible</span>
                    </li>
                  ))}
                </ul>
                <div className="actions">
                  <Link className="button hot small" href={firstUse.primaryHref}>
                    {firstUse.primaryLabel}
                  </Link>
                  {firstUse.secondaryHref && firstUse.secondaryLabel ? (
                    <Link className="button ghost small" href={firstUse.secondaryHref}>
                      {firstUse.secondaryLabel}
                    </Link>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="section-label">Ready to warm</div>
          <div className="card">
            {readyToWarm.length > 0 ? (
              <div className="mini-list">
                {readyToWarm.map((candidate) => (
                  <div className="mini-item dense" key={`${candidate.id}-warm`}>
                    <div className="mini-item-head">
                      <b>{candidate.full_name}</b>
                      <span className={stageClass(candidate.stage)}>
                        {candidate.stage}
                      </span>
                    </div>
                    <span>
                      {candidate.bucket ?? "Uncategorized"} ·{" "}
                      {candidate.company ?? candidate.lane ?? "No company stored"}
                    </span>
                    <span>
                      {dossierValue(candidate.dossier, "next_touch") ||
                        candidate.action}
                    </span>
                    <span className="source-note">
                      Verify fit before asking for relationship capital. If the
                      owner confirms this is a real relationship, graduate through
                      Changes instead of adding directly.
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <b>No warm-ready candidates yet.</b>
                <p>
                  Keep candidates in research until the source, reason, and next
                  useful touch are strong enough to ask for relationship capital.
                </p>
              </div>
            )}
          </div>

          <div className="section-label">Dossier detail</div>
          <div className="card">
            {filteredCandidates.length > 0 ? (
              <div className="mini-list">
                {filteredCandidates.slice(0, 8).map((candidate) => (
                  <div className="mini-item dense" key={`${candidate.id}-dossier`}>
                    <b>{candidate.full_name}</b>
                    <span>
                      <span className="pill gold">
                        {candidate.engagement_count ?? 0} touches
                      </span>
                      <span className="pill cool">
                        {candidate.source ?? "No source"}
                      </span>
                    </span>
                    <div className="kv">
                      <span className="k">Bucket</span>
                      <span>{candidate.bucket ?? "Uncategorized"}</span>
                    </div>
                    <div className="kv">
                      <span className="k">Goal</span>
                      <span>
                        {dossierValue(candidate.dossier, "goal") ||
                          bucketConfig(candidate.bucket, prospectingBucketMap).goal}
                      </span>
                    </div>
                    <div className="kv">
                      <span className="k">Look for</span>
                      <span>
                        {dossierValue(candidate.dossier, "look_for") ||
                          bucketConfig(candidate.bucket, prospectingBucketMap)
                            .look_for}
                      </span>
                    </div>
                    <div className="kv">
                      <span className="k">Next touch</span>
                      <span>
                        {dossierValue(candidate.dossier, "next_touch") ||
                          candidate.action}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <b>No dossiers yet.</b>
                <p>
                  Candidate dossiers should include a source, a reason, a
                  research goal, and the next useful touch.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="section-label">Research packets</div>
      <div className="grid two">
        {topResearchPackets.length > 0 ? (
          topResearchPackets.map((candidate) => {
            const config = bucketConfig(candidate.bucket, prospectingBucketMap);

            return (
              <section
                className="ask-brief"
                aria-label={`${candidate.full_name} research packet`}
                key={`${candidate.id}-packet`}
              >
                <label className="field">
                  <span>
                    <ClipboardList aria-hidden={true} size={14} />{" "}
                    {candidate.full_name}
                  </span>
                  <textarea
                    readOnly
                    value={buildCandidateResearchPacket({ candidate, config })}
                  />
                </label>
              </section>
            );
          })
        ) : (
          <div className="empty-state">
            <b>No active research packets.</b>
            <p>
              Reviewed Want to Know candidates will turn this section into a
              per-person research workspace.
            </p>
          </div>
        )}
      </div>

      {adminMode ? (
        <>
          <div className="section-label">Claude handoff</div>
          <section className="ask-brief" aria-label="Claude handoff">
            <label className="field">
              <span>
                <Radar aria-hidden={true} size={14} /> Outer-ring prompt
              </span>
              <textarea readOnly value={prompt} />
            </label>
            <p className="source-note">
              Use this for research, warming, and graduation recommendations.
              Graduation creates a reviewed new-contact proposal first, so the person
              enters the Book only after duplicate review.
            </p>
          </section>

          <div className="section-label">Bucket research prompts</div>
          <div className="grid three">
            {bucketSummaries.slice(0, 6).map(({ bucket, config }) => (
              <section className="ask-brief" aria-label={`${bucket} prompt`} key={bucket}>
                <label className="field">
                  <span>{bucket}</span>
                  <textarea readOnly value={buildBucketResearchPrompt(config)} />
                </label>
              </section>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
