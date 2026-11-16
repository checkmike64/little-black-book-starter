import Link from "next/link";
import {
  archiveWantToKnowProgram,
  createManualWantToKnow,
  createWantToKnowProgram,
  pauseWantToKnowProgram,
  proposeWantToKnowGraduation,
  reorderWantToKnowPrograms,
  restoreWantToKnowProgram,
  updateWantToKnowProgram,
} from "@/app/(portal)/want-to-know/actions";
import { RelationshipPlanNavigator } from "@/app/(portal)/want-to-know/relationship-plan-navigator";
import { PendingButton } from "@/app/(portal)/want-to-know/pending-button";
import {
  WantToKnowDisclosureProvider,
  WorkspaceDisclosure,
} from "@/app/(portal)/want-to-know/want-to-know-controls";
import {
  getWantToKnowCategoryWorkspace,
  type WantToKnowProgram,
  type WantToKnowWorkspaceCandidate,
} from "@/lib/want-to-know/workspace";
import styles from "./want-to-know-workspace.module.css";

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function priorityLabel(value: WantToKnowWorkspaceCandidate["relationship_priority"]) {
  if (value === "high") return "High priority";
  if (value === "watch") return "Watch";
  return "Standard";
}

function paceLabel(value: number | null) {
  if (value === 0) return "Watch";
  const count = value ?? 1;
  return `${count} touch${count === 1 ? "" : "es"} / month`;
}

function stageLabel(value: WantToKnowWorkspaceCandidate["stage"]) {
  if (value === "ready") return "Add to Book";
  if (value === "graduated") return "In the Book";
  return value === "researching" ? "Watching" : value.charAt(0).toUpperCase() + value.slice(1);
}

function touchLabel(value: string | null) {
  if (!value) return "No touchpoints yet";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Touch date unavailable";
  return `Last touch ${new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(parsed))}`;
}

function moveOrder(programs: WantToKnowProgram[], index: number, direction: -1 | 1) {
  const ids = programs.map((program) => program.id);
  const target = index + direction;
  if (target < 0 || target >= ids.length) return ids;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return ids;
}

function ProgramManager({
  programs,
  returnTo,
}: {
  programs: WantToKnowProgram[];
  returnTo: string;
}) {
  const ordered = programs.filter((program) => program.status !== "archived");
  return (
    <div className={styles.stack}>
      <div>
        <span className={styles.eyebrow}>New purpose</span>
        <p className={styles.lede}>
          Define the outcome and the evidence worth noticing before adding people.
        </p>
      </div>
      <form action={createWantToKnowProgram} className={styles.form}>
        <input name="return_to" type="hidden" value={returnTo} />
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <input maxLength={80} name="name" placeholder="Referral partners" required />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Lane</span>
            <input maxLength={80} name="lane" placeholder="referral" />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.fieldLabel}>Goal</span>
            <textarea maxLength={500} name="goal" placeholder="What should this relationship program accomplish?" rows={2} />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.fieldLabel}>Signals worth noticing</span>
            <textarea maxLength={700} name="look_for" placeholder="The specific work, milestones, or topics that make an engagement relevant." rows={3} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Attention level</span>
            <select defaultValue="Medium" name="intensity">
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </label>
        </div>
        <div className={styles.formActions}>
          <PendingButton className="button hot" label="Create purpose" pendingLabel="Creating…" />
        </div>
      </form>

      <div className={styles.manageList}>
        {ordered.map((program, index) => {
          const active = program.status === "active";
          return (
            <div className={styles.manageRow} key={program.id}>
              <div className={styles.manageRowHead}>
                <div>
                  <strong>{program.name}</strong>
                  <div className={styles.metaLine}>
                    <span>{active ? "Active" : "Paused"}</span>
                    <span>{program.intensity} attention</span>
                  </div>
                </div>
                <form action={active ? pauseWantToKnowProgram : restoreWantToKnowProgram}>
                  <input name="program_id" type="hidden" value={program.id} />
                  <input name="return_to" type="hidden" value={returnTo} />
                  <button
                    aria-checked={active}
                    aria-label={`${active ? "Pause" : "Restore"} ${program.name}`}
                    className={styles.switchButton}
                    role="switch"
                    type="submit"
                  >
                    <span />
                  </button>
                </form>
              </div>
              <details>
                <summary className={styles.secondaryLink}>Edit purpose</summary>
                <form action={updateWantToKnowProgram} className={styles.manageForm}>
                  <input name="program_id" type="hidden" value={program.id} />
                  <input name="return_to" type="hidden" value={returnTo} />
                  <label className={styles.field}><span className={styles.fieldLabel}>Name</span><input defaultValue={program.name} maxLength={80} name="name" required /></label>
                  <label className={styles.field}><span className={styles.fieldLabel}>Lane</span><input defaultValue={program.lane ?? ""} maxLength={80} name="lane" /></label>
                  <label className={styles.field}><span className={styles.fieldLabel}>Goal</span><textarea defaultValue={program.goal ?? ""} maxLength={500} name="goal" rows={2} /></label>
                  <label className={styles.field}><span className={styles.fieldLabel}>Signals worth noticing</span><textarea defaultValue={program.look_for ?? ""} maxLength={700} name="look_for" rows={3} /></label>
                  <label className={styles.field}><span className={styles.fieldLabel}>Attention level</span><select defaultValue={program.intensity} name="intensity"><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option></select></label>
                  <PendingButton className="button quiet small" label="Save purpose" pendingLabel="Saving…" />
                </form>
              </details>
              <div className={styles.manageButtons}>
                <form action={reorderWantToKnowPrograms}>
                  <input name="program_ids" type="hidden" value={moveOrder(ordered, index, -1).join(",")} />
                  <input name="return_to" type="hidden" value={returnTo} />
                  <button className="button quiet small" disabled={index === 0} type="submit">Move up</button>
                </form>
                <form action={reorderWantToKnowPrograms}>
                  <input name="program_ids" type="hidden" value={moveOrder(ordered, index, 1).join(",")} />
                  <input name="return_to" type="hidden" value={returnTo} />
                  <button className="button quiet small" disabled={index === ordered.length - 1} type="submit">Move down</button>
                </form>
                {program.status === "paused" ? (
                  <form action={archiveWantToKnowProgram}>
                    <input name="program_id" type="hidden" value={program.id} />
                    <input name="return_to" type="hidden" value={returnTo} />
                    <PendingButton className="button ghost small" label="Archive if empty" pendingLabel="Archiving…" />
                  </form>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export async function OwnerWantToKnowWorkspace({
  message,
  searchParams,
}: {
  message?: string;
  searchParams: SearchParams;
}) {
  const workspace = await getWantToKnowCategoryWorkspace();
  const programs = workspace.categories
    .map((category) => category.program)
    .filter((program): program is WantToKnowProgram => Boolean(program));
  const activePrograms = programs.filter((program) => program.status === "active");
  const programById = new Map(programs.map((program) => [program.id, program]));
  const allCandidates = workspace.categories.flatMap((category) => category.candidates);
  const activeCandidates = allCandidates.filter((candidate) =>
    candidate.relationship_status === "active"
    && programById.get(candidate.program_id ?? "")?.status === "active",
  );
  const pausedCandidates = allCandidates.filter((candidate) =>
    candidate.relationship_status === "paused"
    || programById.get(candidate.program_id ?? "")?.status === "paused",
  );
  const pausedView = firstParam(searchParams.status) === "paused";
  const relationshipCandidates = pausedView ? pausedCandidates : activeCandidates;
  const visiblePrograms = pausedView
    ? programs.filter((program) =>
        program.status === "paused"
        || pausedCandidates.some((candidate) => candidate.program_id === program.id),
      )
    : activePrograms;
  const requestedPurpose = firstParam(searchParams.purpose) ?? "all";
  const selectedProgram = visiblePrograms.find(
    (program) => program.program_key === requestedPurpose,
  ) ?? null;
  const visibleCandidates = selectedProgram
    ? relationshipCandidates.filter((candidate) => candidate.program_id === selectedProgram.id)
    : relationshipCandidates;
  const activeId = selectedProgram?.program_key ?? "all";
  const viewQuery = pausedView ? "status=paused" : "";
  const returnTo = selectedProgram
    ? `/want-to-know?${viewQuery ? `${viewQuery}&` : ""}purpose=${encodeURIComponent(selectedProgram.program_key)}`
    : viewQuery ? `/want-to-know?${viewQuery}` : "/want-to-know";
  const navigationItems = [
    {
      count: relationshipCandidates.length,
      goal: pausedView
        ? "Relationships and programmes held without losing their history."
        : "Every active relationship you have deliberately chosen to build.",
      href: pausedView ? "/want-to-know?status=paused" : "/want-to-know",
      id: "all",
      label: pausedView ? "All paused" : "All relationships",
      signal: pausedView
        ? "Open any person to restore the relationship."
        : "A single register across every active purpose.",
    },
    ...visiblePrograms.map((program) => {
      const count = relationshipCandidates.filter(
        (candidate) => candidate.program_id === program.id,
      ).length;
      return {
        count,
        goal: program.goal || "A purpose defined by you.",
        href: `/want-to-know?${viewQuery ? `${viewQuery}&` : ""}purpose=${encodeURIComponent(program.program_key)}`,
        id: program.program_key,
        label: program.name,
        signal: program.look_for || "Use the saved relationship context to decide what matters.",
      };
    }),
  ];

  return (
    <WantToKnowDisclosureProvider>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Want to Know</h1>
            <p className={styles.lede}>
              People you have deliberately chosen to know, organized by purpose and the signals that make an approach relevant.
            </p>
          </div>
          <div className={styles.headerActions}>
            <WorkspaceDisclosure id="manage-purposes" label="Manage purposes">
              <ProgramManager programs={programs} returnTo={returnTo} />
            </WorkspaceDisclosure>
            <WorkspaceDisclosure id="add-person" label="Add person" tone="accent">
              <form action={createManualWantToKnow} className={styles.form}>
                <input name="return_to" type="hidden" value={returnTo} />
                <div className={styles.formGrid}>
                  <label className={styles.field}><span className={styles.fieldLabel}>Name</span><input maxLength={300} name="full_name" required /></label>
                  <label className={styles.field}><span className={styles.fieldLabel}>Purpose</span><select defaultValue={selectedProgram?.id ?? ""} name="program_id" required><option value="">Choose purpose</option>{activePrograms.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}</select></label>
                  <label className={styles.field}><span className={styles.fieldLabel}>Primary email</span><input name="email" type="email" /></label>
                  <label className={styles.field}><span className={styles.fieldLabel}>Company</span><input maxLength={300} name="company" /></label>
                  <label className={`${styles.field} ${styles.fieldWide}`}><span className={styles.fieldLabel}>LinkedIn</span><input name="linkedin" placeholder="https://" type="url" /></label>
                  <label className={styles.field}><span className={styles.fieldLabel}>Priority</span><select defaultValue="standard" name="relationship_priority"><option value="high">High</option><option value="standard">Standard</option><option value="watch">Watch</option></select></label>
                  <label className={styles.field}><span className={styles.fieldLabel}>Touches per month</span><select defaultValue="1" name="engagement_target_per_month"><option value="0">Watch</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></label>
                  <label className={`${styles.field} ${styles.fieldWide}`}><span className={styles.fieldLabel}>What should we pay attention to?</span><textarea maxLength={500} name="engagement_focus" rows={3} /></label>
                </div>
                <div className={styles.formActions}><PendingButton className="button hot" label="Add to Want to Know" pendingLabel="Adding…" /></div>
              </form>
            </WorkspaceDisclosure>
            <div aria-label={`${activeCandidates.length} active people`} className={styles.total}>
              <strong>{activeCandidates.length}</strong><span>active</span>
            </div>
          </div>
        </header>

        {message ? <div className={styles.notice} role="status">{message}</div> : null}
        {workspace.setupMode ? <div className={styles.notice} role="status">The private relationship workspace is still being prepared.</div> : null}

        <section className={styles.navigator} aria-labelledby="purpose-heading">
          <div className={styles.sectionHead}>
            <div>
              <span className={styles.eyebrow}>Purpose</span>
              <h2 id="purpose-heading">Choose the relationship programme</h2>
              <p>Each purpose has its own signals, attention level, and reason to engage.</p>
            </div>
          </div>
          <RelationshipPlanNavigator activeId={activeId} items={navigationItems} />
        </section>

        <section aria-labelledby="people-heading">
          <div className={styles.sectionHead}>
            <div>
              <span className={styles.eyebrow}>People</span>
              <h2 id="people-heading">{selectedProgram?.name ?? (pausedView ? "Paused relationships" : "All active relationships")}</h2>
              <p>{selectedProgram?.goal || "One continuous register. Open a person to work on the relationship."}</p>
            </div>
            <nav aria-label="Relationship status" className={styles.viewSwitch}>
              <Link aria-current={!pausedView ? "page" : undefined} href="/want-to-know">Active <span>{activeCandidates.length}</span></Link>
              <Link aria-current={pausedView ? "page" : undefined} href="/want-to-know?status=paused">Paused <span>{pausedCandidates.length}</span></Link>
            </nav>
          </div>

          {visibleCandidates.length ? (
            <div className={styles.register}>
              {visibleCandidates.map((candidate) => (
                <article className={styles.row} key={candidate.id}>
                  <div className={styles.identity}>
                    <Link href={`/want-to-know/${candidate.id}`}>{candidate.full_name}</Link>
                    <p>{candidate.company || "Company not added"}</p>
                  </div>
                  <div className={styles.context}>
                    <div className={styles.metaLine}>
                      <span>{priorityLabel(candidate.relationship_priority)}</span>
                      <span>{stageLabel(candidate.stage)}</span>
                      <span>{paceLabel(candidate.engagement_target_per_month)}</span>
                      <span>{touchLabel(candidate.last_touch)}</span>
                      {programById.get(candidate.program_id ?? "")?.status === "paused" ? <span>Programme paused</span> : null}
                    </div>
                    <p>{candidate.engagement_focus || "No relationship focus has been written yet."}</p>
                  </div>
                  <div className={styles.rowActions}>
                    <Link className="button quiet small" href={`/want-to-know/${candidate.id}`}>Open profile</Link>
                    <form action={proposeWantToKnowGraduation}>
                      <input name="want_to_know_id" type="hidden" value={candidate.id} />
                      <input name="return_to" type="hidden" value={returnTo} />
                      <PendingButton className="button hot small" label="Add to Book" pendingLabel="Preparing review…" />
                    </form>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <h2>{selectedProgram ? `No one is in ${selectedProgram.name} yet.` : pausedView ? "Nothing is paused." : "No one has been selected yet."}</h2>
              <p>
                {pausedView
                  ? "Paused relationships stay here until you are ready to restore or archive them."
                  : "Add someone only when the purpose is clear. Attendance lists, dinner rosters, and incidental meetings never place a person here automatically."}
              </p>
              {!pausedView ? <div className={styles.emptyActions}>
                <WorkspaceDisclosure id="empty-add-person" label="Add the first person" tone="accent">
                  <form action={createManualWantToKnow} className={styles.form}>
                    <input name="return_to" type="hidden" value={returnTo} />
                    <label className={styles.field}><span className={styles.fieldLabel}>Name</span><input maxLength={300} name="full_name" required /></label>
                    <label className={styles.field}><span className={styles.fieldLabel}>Purpose</span><select defaultValue={selectedProgram?.id ?? ""} name="program_id" required><option value="">Choose purpose</option>{activePrograms.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}</select></label>
                    <input name="relationship_priority" type="hidden" value="standard" />
                    <input name="engagement_target_per_month" type="hidden" value="1" />
                    <PendingButton className="button hot" label="Add person" pendingLabel="Adding…" />
                  </form>
                </WorkspaceDisclosure>
              </div> : null}
            </div>
          )}
        </section>
      </main>
    </WantToKnowDisclosureProvider>
  );
}
