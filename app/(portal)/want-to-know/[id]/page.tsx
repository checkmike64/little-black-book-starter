import Link from "next/link";
import { notFound } from "next/navigation";
import {
  archiveWantToKnowRelationship,
  logWantToKnowEvent,
  pauseWantToKnowRelationship,
  proposeWantToKnowGraduation,
  restoreWantToKnowRelationship,
  scanWantToKnowContent,
  updateWantToKnowProfile,
} from "@/app/(portal)/want-to-know/actions";
import { requireEnabledModule } from "@/lib/module-gate";
import { PendingButton } from "@/app/(portal)/want-to-know/pending-button";
import {
  getWantToKnowCandidateDetail,
  getWantToKnowCategoryWorkspace,
  type WantToKnowContentItem,
  type WantToKnowEvent,
  type WantToKnowProgram,
  type WantToKnowSignal,
} from "@/lib/want-to-know/workspace";
import styles from "../want-to-know-workspace.module.css";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function dossierText(dossier: Record<string, unknown>, key: string) {
  const value = dossier[key];
  return typeof value === "string" ? value : "";
}

function displayDate(value: string | null) {
  if (!value) return "Not yet";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Date unavailable";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(parsed));
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stageLabel(value: string) {
  if (value === "ready") return "Add to Book";
  if (value === "graduated") return "In the Book";
  if (value === "researching") return "Watching";
  return titleCase(value);
}

function cadenceLabel(value: number | null) {
  if (value === 0) return "Watch";
  const count = value ?? 1;
  return `${count} touch${count === 1 ? "" : "es"} / month`;
}

function EvidenceItem({ item }: { item: WantToKnowSignal | WantToKnowContentItem }) {
  const isSignal = "signal_type" in item;
  const sourceUrl = item.source_url;
  const title = isSignal
    ? item.summary
    : item.title || item.content?.slice(0, 160) || "Captured content";
  const detail = isSignal
    ? item.why_now || item.recommended_action || item.classification
    : item.relevance || item.classification;
  const date = isSignal ? item.published_at || item.observed_at : item.published_at;
  return (
    <li>
      <time dateTime={date}>{displayDate(date)}</time>
      <div>
        <strong>
          {sourceUrl ? <a className={styles.evidenceLink} href={sourceUrl} rel="noreferrer" target="_blank">{title}</a> : title}
        </strong>
        {detail ? <p>{detail}</p> : null}
      </div>
    </li>
  );
}

function RelevantPost({ item }: { item: WantToKnowContentItem }) {
  const label = titleCase(item.platform || item.content_type);
  const title = item.title || item.content?.slice(0, 180) || "Captured update";
  return (
    <li className={styles.contentItem}>
      <div className={styles.contentMeta}>
        <span>{label}</span>
        <time dateTime={item.published_at}>{displayDate(item.published_at)}</time>
      </div>
      <div className={styles.contentBody}>
        <strong>{title}</strong>
        {item.relevance ? <p>{item.relevance}</p> : null}
      </div>
      <a className={styles.contentAction} href={item.source_url} rel="noreferrer" target="_blank">Open post ↗</a>
    </li>
  );
}

function TimelineEvent({ event }: { event: WantToKnowEvent }) {
  return (
    <li>
      <time dateTime={event.occurred_at}>{displayDate(event.occurred_at)}</time>
      <div>
        <strong>{event.title || titleCase(event.event_type)}</strong>
        {event.summary ? <p>{event.summary}</p> : null}
        <div className={styles.metaLine}>
          {event.channel ? <span>{titleCase(event.channel)}</span> : null}
          {event.direction ? <span>{titleCase(event.direction)}</span> : null}
          <span>{event.source === "owner_manual" ? "Recorded by you" : titleCase(event.source)}</span>
        </div>
      </div>
    </li>
  );
}

export default async function WantToKnowProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: SearchParams;
}) {
  await requireEnabledModule("want_to_know");
  const [{ id }, query] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>),
  ]);
  const [detail, workspace] = await Promise.all([
    getWantToKnowCandidateDetail(id),
    getWantToKnowCategoryWorkspace({ includeArchived: true }),
  ]);
  if (!detail) notFound();

  const { candidate, content, events, program, signals } = detail;
  const programs = workspace.categories
    .map((category) => category.program)
    .filter((item): item is WantToKnowProgram => Boolean(item))
    .filter((item) => item.status !== "archived" || item.id === candidate.program_id);
  const message = firstParam(query.message);
  const returnTo = `/want-to-know/${candidate.id}`;
  const pausedContext = candidate.relationship_status === "paused" || program?.status === "paused";
  const backHref = program
    ? `/want-to-know?${pausedContext ? "status=paused&" : ""}purpose=${encodeURIComponent(program.program_key)}`
    : pausedContext ? "/want-to-know?status=paused" : "/want-to-know";
  const relevantContent = content.filter(
    (item) => item.match_status === "matched" && item.status !== "dismissed" && item.status !== "expired",
  );
  const relationshipStatus = program?.status === "paused"
    ? "Programme paused"
    : titleCase(candidate.relationship_status);

  return (
    <main className={styles.page}>
      <Link className={styles.backLink} href={backHref}>← Back to {program?.name ?? "Want to Know"}</Link>
      {message ? <div className={styles.notice} role="status">{message}</div> : null}

      <header className={styles.profileHeader}>
        <div>
          <span className={styles.kicker}>{program?.name ?? "Unassigned"} / {relationshipStatus}</span>
          <h1 className={styles.profileTitle}>{candidate.full_name}</h1>
          <p className={styles.profileSubhead}>{candidate.company || "Company not added"}</p>
        </div>
        <div className={styles.profileActions}>
          {candidate.linkedin ? <a className="button quiet" href={candidate.linkedin} rel="noreferrer" target="_blank">LinkedIn ↗</a> : null}
          {candidate.linkedin ? (
            <form action={scanWantToKnowContent}>
              <input name="want_to_know_id" type="hidden" value={candidate.id} />
              <input name="return_to" type="hidden" value={returnTo} />
              <PendingButton className="button quiet" label="Scan for posts" pendingLabel="Starting scan…" />
            </form>
          ) : null}
          <form action={proposeWantToKnowGraduation}>
            <input name="want_to_know_id" type="hidden" value={candidate.id} />
            <input name="return_to" type="hidden" value={returnTo} />
            <PendingButton className="button hot" label="Add to Book" pendingLabel="Preparing review…" />
          </form>
        </div>
      </header>

      <div className={styles.profileGrid}>
        <div className={styles.profileMain}>
          <section className={styles.profileSection} aria-labelledby="rationale-heading">
            <span className={styles.eyebrow}>Purpose</span>
            <h2 id="rationale-heading">Why this relationship matters</h2>
            <p>{candidate.why || "No rationale has been written yet. Add one to keep recommendations specific to this relationship."}</p>
            <dl className={styles.definitionList}>
              <div className={styles.definitionRow}><dt className={styles.metaLabel}>Programme goal</dt><dd>{dossierText(candidate.dossier, "goal") || program?.goal || "Not recorded"}</dd></div>
              <div className={styles.definitionRow}><dt className={styles.metaLabel}>Look for</dt><dd>{dossierText(candidate.dossier, "look_for") || program?.look_for || "Not recorded"}</dd></div>
              <div className={styles.definitionRow}><dt className={styles.metaLabel}>Next move</dt><dd>{dossierText(candidate.dossier, "next_touch") || "Not planned"}</dd></div>
              <div className={styles.definitionRow}><dt className={styles.metaLabel}>Current focus</dt><dd>{candidate.engagement_focus || "Not recorded"}</dd></div>
            </dl>
          </section>

          <section className={styles.profileSection} aria-labelledby="plan-heading">
            <span className={styles.eyebrow}>Plan</span>
            <h2 id="plan-heading">Relationship plan</h2>
            <form action={updateWantToKnowProfile} className={styles.form}>
              <input name="want_to_know_id" type="hidden" value={candidate.id} />
              <input name="return_to" type="hidden" value={returnTo} />
              <div className={styles.formGrid}>
                <label className={styles.field}><span className={styles.fieldLabel}>Name</span><input defaultValue={candidate.full_name} maxLength={300} name="full_name" required /></label>
                <label className={styles.field}><span className={styles.fieldLabel}>Company</span><input defaultValue={candidate.company ?? ""} maxLength={300} name="company" /></label>
                <label className={styles.field}><span className={styles.fieldLabel}>Email</span><input defaultValue={candidate.email ?? ""} name="email" type="email" /></label>
                <label className={styles.field}><span className={styles.fieldLabel}>Website</span><input defaultValue={dossierText(candidate.dossier, "website")} name="website" placeholder="https://" type="url" /></label>
                <label className={`${styles.field} ${styles.fieldWide}`}><span className={styles.fieldLabel}>LinkedIn</span><input defaultValue={candidate.linkedin ?? ""} name="linkedin" placeholder="https://" type="url" /></label>
                <label className={styles.field}><span className={styles.fieldLabel}>Purpose</span><select defaultValue={candidate.program_id ?? ""} name="program_id" required>{programs.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status === "paused" ? " — paused" : ""}</option>)}</select></label>
                <label className={styles.field}><span className={styles.fieldLabel}>Stage</span><select defaultValue={candidate.stage === "researching" ? "watching" : candidate.stage} name="stage"><option value="watching">Watching</option><option value="warming">Warming</option><option value="ready">Add to Book</option></select></label>
                <label className={styles.field}><span className={styles.fieldLabel}>Priority</span><select defaultValue={candidate.relationship_priority} name="relationship_priority"><option value="high">High</option><option value="standard">Standard</option><option value="watch">Watch</option></select></label>
                <label className={styles.field}><span className={styles.fieldLabel}>Touches per month</span><select defaultValue={String(candidate.engagement_target_per_month ?? 1)} name="engagement_target_per_month"><option value="0">Watch</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></label>
                <label className={`${styles.field} ${styles.fieldWide}`}><span className={styles.fieldLabel}>Why you want to know them</span><textarea defaultValue={candidate.why ?? ""} maxLength={1000} name="why" rows={3} /></label>
                <label className={`${styles.field} ${styles.fieldWide}`}><span className={styles.fieldLabel}>Engagement focus</span><textarea defaultValue={candidate.engagement_focus ?? ""} maxLength={500} name="engagement_focus" rows={3} /></label>
                <label className={`${styles.field} ${styles.fieldWide}`}><span className={styles.fieldLabel}>Individual goal</span><textarea defaultValue={dossierText(candidate.dossier, "goal")} maxLength={700} name="dossier_goal" rows={2} /></label>
                <label className={`${styles.field} ${styles.fieldWide}`}><span className={styles.fieldLabel}>Signals to look for</span><textarea defaultValue={dossierText(candidate.dossier, "look_for")} maxLength={1000} name="dossier_look_for" rows={3} /></label>
                <label className={`${styles.field} ${styles.fieldWide}`}><span className={styles.fieldLabel}>Next move</span><textarea defaultValue={dossierText(candidate.dossier, "next_touch")} maxLength={700} name="dossier_next_touch" rows={2} /></label>
                <label className={`${styles.field} ${styles.fieldWide}`}><span className={styles.fieldLabel}>Notes</span><textarea defaultValue={dossierText(candidate.dossier, "notes")} maxLength={2000} name="dossier_notes" rows={4} /></label>
              </div>
              <div className={styles.formActions}><PendingButton className="button hot" label="Save relationship plan" pendingLabel="Saving…" /></div>
            </form>
          </section>

          <section className={styles.profileSection} aria-labelledby="evidence-heading">
            <span className={styles.eyebrow}>Signals</span>
            <h2 id="evidence-heading">What is worth noticing</h2>
            {signals.length ? <ul className={styles.timeline}>{signals.slice(0, 30).map((item) => <EvidenceItem item={item} key={`signal-${item.id}`} />)}</ul> : <p>No verified website or social signal has been captured for this person yet.</p>}
          </section>

          <section className={styles.profileSection} aria-labelledby="activity-heading">
            <span className={styles.eyebrow}>History</span>
            <h2 id="activity-heading">Touches and relationship history</h2>
            {events.length ? <ul className={styles.timeline}>{events.map((event) => <TimelineEvent event={event} key={event.id} />)}</ul> : <p>No relationship activity has been recorded yet.</p>}
          </section>
        </div>

        <aside className={styles.profileAside}>
          <section className={styles.profileSection} aria-labelledby="snapshot-heading">
            <span className={styles.eyebrow}>Snapshot</span>
            <h2 id="snapshot-heading">At a glance</h2>
            <dl className={styles.definitionList}>
              <div className={styles.definitionRow}><dt className={styles.metaLabel}>Purpose</dt><dd>{program?.name ?? "Unassigned"}</dd></div>
              <div className={styles.definitionRow}><dt className={styles.metaLabel}>Priority</dt><dd>{titleCase(candidate.relationship_priority)}</dd></div>
              <div className={styles.definitionRow}><dt className={styles.metaLabel}>Stage</dt><dd>{stageLabel(candidate.stage)}</dd></div>
              <div className={styles.definitionRow}><dt className={styles.metaLabel}>Cadence</dt><dd>{cadenceLabel(candidate.engagement_target_per_month)}</dd></div>
              <div className={styles.definitionRow}><dt className={styles.metaLabel}>Last touch</dt><dd>{displayDate(candidate.last_touch)}</dd></div>
              <div className={styles.definitionRow}><dt className={styles.metaLabel}>Touches</dt><dd>{candidate.engagement_count}</dd></div>
              <div className={styles.definitionRow}><dt className={styles.metaLabel}>Source</dt><dd>{candidate.source || "Not recorded"}</dd></div>
            </dl>
          </section>

          <section className={styles.profileSection} aria-labelledby="touch-heading">
            <span className={styles.eyebrow}>Record</span>
            <h2 id="touch-heading">Log what happened</h2>
            <form action={logWantToKnowEvent} className={styles.form}>
              <input name="want_to_know_id" type="hidden" value={candidate.id} />
              <input name="return_to" type="hidden" value={returnTo} />
              <label className={styles.field}><span className={styles.fieldLabel}>Type</span><select defaultValue="email" name="event_type"><option value="email">Email</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="message">Message</option><option value="touch">Other touch</option><option value="note">Note</option><option value="research">Research</option><option value="milestone">Milestone</option></select></label>
              <label className={styles.field}><span className={styles.fieldLabel}>Direction</span><select defaultValue="outbound" name="direction"><option value="outbound">Outbound</option><option value="inbound">Inbound</option><option value="mutual">Mutual</option><option value="system">Internal note</option></select></label>
              <label className={styles.field}><span className={styles.fieldLabel}>Date</span><input name="occurred_on" type="date" /></label>
              <label className={styles.field}><span className={styles.fieldLabel}>Title</span><input maxLength={240} name="title" placeholder="What happened?" /></label>
              <label className={styles.field}><span className={styles.fieldLabel}>Note</span><textarea maxLength={2000} name="summary" rows={4} required /></label>
              <label className={styles.field}><span className={styles.fieldLabel}>Channel</span><input maxLength={80} name="channel" placeholder="Email, LinkedIn, in person…" /></label>
              <PendingButton className="button hot" label="Record activity" pendingLabel="Recording…" />
            </form>
          </section>

          <section className={`${styles.profileSection} ${styles.dangerZone}`} aria-labelledby="status-heading">
            <span className={styles.eyebrow}>Status</span>
            <h2 id="status-heading">Relationship lifecycle</h2>
            <p>Pause a relationship without losing its history. Archive only when it should leave the active workspace.</p>
            <div className={styles.stack}>
              {candidate.relationship_status === "active" ? (
                <form action={pauseWantToKnowRelationship}><input name="want_to_know_id" type="hidden" value={candidate.id} /><input name="return_to" type="hidden" value={returnTo} /><PendingButton className="button quiet" label="Pause relationship" pendingLabel="Pausing…" /></form>
              ) : (
                <form action={restoreWantToKnowRelationship}><input name="want_to_know_id" type="hidden" value={candidate.id} /><input name="return_to" type="hidden" value={returnTo} /><PendingButton className="button quiet" label="Restore relationship" pendingLabel="Restoring…" /></form>
              )}
              <details>
                <summary className={styles.secondaryLink}>Archive relationship…</summary>
                <p className={styles.warning}>This removes the person from active programmes while preserving their record and history.</p>
                <form action={archiveWantToKnowRelationship}><input name="want_to_know_id" type="hidden" value={candidate.id} /><input name="return_to" type="hidden" value="/want-to-know" /><PendingButton className="button ghost" label="Confirm archive" pendingLabel="Archiving…" /></form>
              </details>
            </div>
          </section>
        </aside>
      </div>

      <section className={styles.profilePosts} aria-labelledby="posts-heading">
        <div className={styles.sectionHead}>
          <div>
            <span className={styles.eyebrow}>Relevant posts</span>
            <h2 id="posts-heading">Posts and releases to engage with</h2>
            <p>Verified material connected to this person and the purpose of the relationship.</p>
          </div>
          <span className={styles.postCount}>{relevantContent.length}</span>
        </div>
        {relevantContent.length ? (
          <ul className={styles.contentLedger}>
            {relevantContent.map((item) => <RelevantPost item={item} key={item.id} />)}
          </ul>
        ) : (
          <div className={styles.contentEmpty}>
            <strong>No relevant posts have been captured yet.</strong>
            <p>Verified website updates, social posts, episodes, and milestones will collect here when they match this relationship’s saved focus.</p>
          </div>
        )}
      </section>
    </main>
  );
}
