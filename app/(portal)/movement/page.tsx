import {
  ArrowRight,
  CircleDot,
  Filter,
  Search,
} from "lucide-react";
import Link from "next/link";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DataLoadNotice } from "@/app/(portal)/data-load-notice";
import { markAskRunDecision } from "@/app/(portal)/ask/actions";
import { updateMovementRelationshipAction } from "@/app/(portal)/movement/actions";
import { RelationshipActionStatusControls } from "@/app/(portal)/movement/relationship-action-status-controls";
import { adminToolsCookieName, shouldUseAdminTools } from "@/lib/admin-mode";
import {
  buildAskDecisionQueue,
  type AskDecisionRun,
} from "@/lib/ask-decision-queue";
import {
  buildMovementCommand,
  movementCommandNextMoves,
} from "@/lib/movement-command-center";
import {
  buildMovementSourceMix,
  isAskCreatedAction,
  isClaudeCreatedAction,
} from "@/lib/movement-source-mix";
import {
  getMovementData,
  type RelationshipActionRow,
} from "@/lib/movement/data";
import {
  buildRelationshipActionPlan,
  relationshipActionPlanSummary,
  type RelationshipActionLane,
} from "@/lib/relationship-action-planning";
import {
  relationshipMovementSummary,
  buildRelationshipMovement,
} from "@/lib/relationship-movement";
import { getTenantContext } from "@/lib/tenant-context";
import { buildMovementViewBrief } from "@/lib/movement-view-brief";
import { MovementActionPanel } from "./movement-action-panel";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type MovementView =
  | "active"
  | "hot"
  | "high"
  | "needs_date"
  | "from_ask"
  | "from_claude"
  | "closed"
  | "all";

const movementViews: Array<{ label: string; value: MovementView }> = [
  { label: "Active", value: "active" },
  { label: "Hot", value: "hot" },
  { label: "High", value: "high" },
  { label: "Needs Date", value: "needs_date" },
  { label: "From Ask", value: "from_ask" },
  { label: "Suggested", value: "from_claude" },
  { label: "Closed", value: "closed" },
  { label: "All", value: "all" },
];

const relationshipActionTypeOptions = [
  ["follow_up", "Follow-up"],
  ["reconnect", "Reconnect"],
  ["promise", "Promise"],
  ["introduction", "Introduction"],
  ["referral", "Referral"],
  ["podcast", "Podcast"],
  ["owner_verification", "Owner verification"],
  ["claude_draft", "Draft help"],
  ["other", "Other"],
] as const;

const relationshipActionPriorityOptions = [
  ["low", "Low"],
  ["normal", "Normal"],
  ["high", "High"],
] as const;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanView(value: string | string[] | undefined): MovementView {
  const raw = firstParam(value);
  return movementViews.some((view) => view.value === raw)
    ? (raw as MovementView)
    : "active";
}

function formatDate(value: string | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function humanize(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "unknown";
}

function laneLabel(lane: RelationshipActionLane) {
  switch (lane) {
    case "overdue":
      return "Overdue";
    case "due_today":
      return "Today";
    case "due_soon":
      return "Next 7 Days";
    case "scheduled":
      return "Scheduled";
    case "unscheduled":
      return "No Date";
    case "closed":
      return "Closed";
  }
}

function laneTone(lane: RelationshipActionLane) {
  if (lane === "overdue" || lane === "due_today") return "hot";
  if (lane === "due_soon" || lane === "unscheduled") return "gold";
  if (lane === "closed") return "cool";
  return "";
}

function priorityPill(priority: string, lane: RelationshipActionLane) {
  if (lane === "overdue" || priority === "high") return "pill warn";
  if (lane === "due_today" || lane === "due_soon") return "pill hot";
  if (priority === "normal") return "pill gold";
  return "pill cool";
}

function matchesView(
  item: ReturnType<typeof buildRelationshipActionPlan<RelationshipActionRow>>[number],
  view: MovementView,
) {
  if (view === "all") return true;
  if (view === "closed") return item.lane === "closed";
  if (view === "active") return item.lane !== "closed";
  if (view === "hot") return item.lane === "overdue" || item.lane === "due_today";
  if (view === "high") return item.action.priority === "high" && item.lane !== "closed";
  if (view === "from_ask") return isAskCreatedAction(item.action) && item.lane !== "closed";
  if (view === "from_claude") return isClaudeCreatedAction(item.action) && item.lane !== "closed";
  return item.lane === "unscheduled";
}

function matchesQuery(action: RelationshipActionRow, query: string) {
  if (!query) return true;
  const haystack = [
    action.title,
    action.notes,
    action.source,
    action.action_type,
    action.priority,
    action.status,
    action.contacts?.full_name,
    action.contacts?.company_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function actionSourceCue(action: RelationshipActionRow, showOperatorTools: boolean) {
  const sourceJobId =
    typeof action.metadata?.job_id === "string" ? action.metadata.job_id : null;
  const commandLabel =
    typeof action.metadata?.command_label === "string"
      ? action.metadata.command_label
      : null;
  const sourceAskRunId =
    typeof action.metadata?.ask_run_id === "string" ? action.metadata.ask_run_id : null;
  const sourceAskMode =
    typeof action.metadata?.mode === "string" ? action.metadata.mode : "search";
  const sourceAskQuery =
    typeof action.metadata?.query === "string" ? action.metadata.query : "";

  if (sourceAskRunId) {
    return {
      label: "From Ask",
      tone: "gold",
      detail: `Saved from Ask decision · ${humanize(sourceAskMode)}`,
      href: `/ask?run=${encodeURIComponent(sourceAskRunId)}&mode=${encodeURIComponent(
        sourceAskMode,
      )}${sourceAskQuery ? `&q=${encodeURIComponent(sourceAskQuery)}` : ""}`,
    };
  }

  if (sourceJobId || commandLabel || isClaudeCreatedAction(action)) {
    return {
      label: "Suggested",
      tone: "hot",
      detail: commandLabel
        ? `Prepared move: ${commandLabel}`
        : sourceJobId && showOperatorTools
          ? `Prepared relationship move · job ${sourceJobId.slice(0, 8)}`
          : "Prepared relationship move",
      href: sourceJobId && showOperatorTools ? `/ops/jobs/${sourceJobId}` : null,
    };
  }

  if (action.source === "dashboard_priority" || action.source === "dashboard_weekly_engagement") {
    return {
      label: "From Today",
      tone: "cool",
      detail: "Captured from an operating recommendation.",
      href: "/dashboard",
    };
  }

  return {
    label: action.source ? humanize(action.source) : "Manual",
    tone: "cool",
    detail: "Tracked directly in the movement queue.",
    href: null,
  };
}

function ActionCard({
  item,
  returnTo,
  showOperatorTools,
}: {
  item: ReturnType<typeof buildRelationshipActionPlan<RelationshipActionRow>>[number];
  returnTo: string;
  showOperatorTools: boolean;
}) {
  const action = item.action;
  const contactName = action.contacts?.full_name ?? "No contact linked";
  const contactHref = action.contacts?.id ? `/contacts/${action.contacts.id}` : null;
  const contactId = action.contact_id;
  const sourceCue = actionSourceCue(action, showOperatorTools);
  const sourceJobId =
    typeof action.metadata?.job_id === "string" ? action.metadata.job_id : null;
  const sourceAskRunId =
    typeof action.metadata?.ask_run_id === "string" ? action.metadata.ask_run_id : null;

  return (
    <article className="movement-card">
      <div className="movement-card-main">
        <div>
          <div className="record-header">
            <span className={`pill ${laneTone(item.lane)}`}>{laneLabel(item.lane)}</span>
            <span className={priorityPill(action.priority, item.lane)}>
              {action.priority}
            </span>
            <span className="pill cool">{humanize(action.action_type)}</span>
            <span className={`pill ${sourceCue.tone}`}>{sourceCue.label}</span>
          </div>
          <h3>{action.title}</h3>
          <p>
            {contactName}
            {action.contacts?.company_name ? ` · ${action.contacts.company_name}` : ""}
          </p>
          {action.notes ? <p className="muted">{action.notes}</p> : null}
          <span className="source-note">
            {item.urgencyLabel} · saved {formatDate(action.created_at)}
          </span>
          <span className="source-note">{sourceCue.detail}</span>
        </div>
        <div className="movement-score" aria-label={`Priority score ${item.score}`}>
          {item.score}
        </div>
      </div>
      <form action={updateMovementRelationshipAction} className="movement-quick-edit">
        <input name="action_id" type="hidden" value={action.id} />
        <input name="return_to" type="hidden" value={returnTo} />
        <label className="field compact">
          <span>Status</span>
          <select defaultValue={action.status} name="status">
            <option value="open">Open</option>
            <option value="deferred">Deferred</option>
            <option value="done">Done</option>
            <option value="skipped">Skipped</option>
          </select>
        </label>
        <label className="field compact">
          <span>Priority</span>
          <select defaultValue={action.priority} name="priority">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className="field compact">
          <span>Due</span>
          <input defaultValue={action.due_on ?? ""} name="due_on" type="date" />
        </label>
        <label className="field compact">
          <span>Reason</span>
          <input
            name="status_note"
            placeholder="Required if deferred or skipped"
          />
        </label>
        <button className="button small" type="submit">
          Save
        </button>
      </form>
      <div className="review-actions">
        {contactHref ? (
          <Link className="button small ghost" href={contactHref}>
            Open profile
            <ArrowRight aria-hidden="true" size={14} />
          </Link>
        ) : null}
        <Link
          className="button small ghost"
          href={`/ask?mode=search&q=${encodeURIComponent(`${action.title} ${contactName}`)}`}
        >
          <Search aria-hidden="true" size={14} />
          Ask context
        </Link>
        {sourceJobId && showOperatorTools ? (
          <Link className="button small ghost" href={`/ops/jobs/${sourceJobId}`}>
            Source job
            <ArrowRight aria-hidden="true" size={14} />
          </Link>
        ) : null}
        {sourceCue.href && sourceAskRunId ? (
          <Link className="button small ghost" href={sourceCue.href}>
            Source Ask
            <ArrowRight aria-hidden="true" size={14} />
          </Link>
        ) : null}
        {contactId ? (
          <RelationshipActionStatusControls
            actionId={action.id}
            contactId={contactId}
            currentStatus={action.status}
            returnTo={returnTo}
          />
        ) : null}
      </div>
    </article>
  );
}

function AskDecisionCard({
  item,
  returnTo,
}: {
  item: ReturnType<typeof buildAskDecisionQueue>[number];
  returnTo: string;
}) {
  return (
    <article className="movement-card">
      <div className="movement-card-main">
        <div>
          <div className="record-header">
            <span className="pill gold">Ask decision</span>
            <span className="pill cool">{humanize(item.mode)}</span>
            <span className={item.suggestedPriority === "high" ? "pill warn" : "pill cool"}>
              {item.suggestedPriority}
            </span>
            <span className="pill cool">{humanize(item.suggestedActionType)}</span>
            {item.suggestedContactName ? (
              <span className="pill cool">{item.suggestedContactName}</span>
            ) : null}
          </div>
          <h3>{item.title}</h3>
          <p>{item.detail}</p>
          <span className="source-note">{item.reason}</span>
        </div>
        <div
          className="movement-score"
          aria-label={`Ask decision score ${Math.round(item.score)}`}
        >
          {Math.round(item.score)}
        </div>
      </div>
      <div className="ask-decision-movement-actions">
        <form action={markAskRunDecision} className="movement-action-form">
          <input name="ask_run_id" type="hidden" value={item.id} />
          <input name="decision_status" type="hidden" value="follow_up_needed" />
          <input name="create_relationship_action" type="hidden" value="true" />
          <input name="return_to" type="hidden" value={returnTo} />
          <input
            name="relationship_action_title"
            type="hidden"
            value={item.suggestedActionTitle}
          />
          <input
            name="relationship_action_notes"
            type="hidden"
            value={item.suggestedNote}
          />
          {item.suggestedContactId ? (
            <input name="contact_id" type="hidden" value={item.suggestedContactId} />
          ) : null}
          <label className="movement-note-field">
            <span>Move note</span>
            <input
              defaultValue={item.suggestedNote}
              name="decision_note"
              type="text"
            />
          </label>
          <div className="ask-decision-action-fields">
            <label className="field compact">
              <span>Type</span>
              <select
                defaultValue={item.suggestedActionType}
                name="relationship_action_type"
              >
                {relationshipActionTypeOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field compact">
              <span>Priority</span>
              <select
                defaultValue={item.suggestedPriority}
                name="relationship_action_priority"
              >
                {relationshipActionPriorityOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field compact">
              <span>Due</span>
              <input
                defaultValue={item.suggestedDueOn ?? ""}
                name="relationship_action_due_on"
                type="date"
              />
            </label>
          </div>
          <span className="source-note">Suggested due: {item.suggestedDueLabel}</span>
          <div className="movement-actions">
            <button className="button hot" type="submit">
              Save move
            </button>
            <Link className="button ghost" href={item.href}>
              Open Ask
            </Link>
          </div>
        </form>
        <form action={markAskRunDecision} className="movement-actions">
          <input name="ask_run_id" type="hidden" value={item.id} />
          <input name="decision_status" type="hidden" value="verified_no_action" />
          <input
            name="decision_note"
            type="hidden"
            value="Reviewed from Movement; no action needed."
          />
          <input name="return_to" type="hidden" value={returnTo} />
          <button className="button quiet" type="submit">
            No action
          </button>
        </form>
      </div>
    </article>
  );
}

export default async function MovementPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const message = firstParam(params.message);
  const view = cleanView(params.view);
  const query = String(firstParam(params.q) ?? "").trim().toLowerCase().slice(0, 120);
  const context = await getTenantContext();

  if (!context) {
    return <div className="empty-state">Sign in to see relationship movement.</div>;
  }

  const cookieStore = await cookies();
  const adminMode = shouldUseAdminTools({
    cookieValue: cookieStore.get(adminToolsCookieName)?.value,
    role: context.role,
  });
  if (!adminMode) {
    redirect("/dashboard");
  }
  const shouldLoadClosedActions = view === "closed" || view === "all";
  const movementData = await getMovementData({
    includeClosedActions: shouldLoadClosedActions,
    tenantId: context.tenantId,
  });

  if (!movementData) {
    return <div className="empty-state">Sign in to see relationship movement.</div>;
  }

  const { actions, askRuns, contacts, introductions, loadHealth, promises } =
    movementData;
  const askDecisionQueue = buildAskDecisionQueue(askRuns as AskDecisionRun[]);
  const undecidedAskRuns = askDecisionQueue.length;
  const plan = buildRelationshipActionPlan(actions);
  const openPlan = plan.filter((item) => item.lane !== "closed");
  const filteredPlan = plan.filter(
    (item) => matchesView(item, view) && matchesQuery(item.action, query),
  );
  const summary = relationshipActionPlanSummary(actions);
  const sourceMix = buildMovementSourceMix(actions);
  const askCreatedActionCount = sourceMix.ask;
  const claudeCreatedActionCount = sourceMix.claude;
  const ownerVerificationActionCount = sourceMix.ownerVerification;
  const promiseActionCount = openPlan.filter(
    (item) => item.action.action_type === "promise",
  ).length;
  const manualActionCount = sourceMix.manual;
  const operatingMix = [
    {
      label: "Ask-created moves",
      value: askCreatedActionCount,
      href: "/movement?view=from_ask",
      detail: "Saved Ask decisions that became tracked movement.",
      tone: askCreatedActionCount > 0 ? "gold" : "cool",
    },
    {
      label: "Suggested moves",
      value: claudeCreatedActionCount,
      href: "/movement?view=from_claude",
      detail: "Relationship command output captured as action.",
      tone: claudeCreatedActionCount > 0 ? "hot" : "cool",
    },
    {
      label: "Owner verification work",
      value: ownerVerificationActionCount,
      href: "/movement?view=high",
      detail: "Judgment work that should stay deliberate.",
      tone: ownerVerificationActionCount > 0 ? "gold" : "cool",
    },
    {
      label: "Promise actions",
      value: promiseActionCount,
      href: "/movement?view=active",
      detail: "Trust-preserving commitments in action form.",
      tone: promiseActionCount > 0 ? "hot" : "cool",
    },
  ] as const;
  const leadingMix =
    operatingMix.find((item) => item.value > 0) ??
    sourceMix.primary;
  const keepInTouchSettings = normalizeTenantSettings(context.settings);
  const movementQueue = buildRelationshipMovement({
    keepInTouchSettings: keepInTouchSettings.keep_in_touch,
    timeZone: keepInTouchSettings.activity.time_zone,
    contacts,
    promises,
    introductions,
  });
  const movementSummary = relationshipMovementSummary(movementQueue);
  const movementCommand = buildMovementCommand({
    actionPlan: plan,
    movementQueue,
    movementSummary,
    undecidedAskRuns,
  });
  const nextMoves = movementCommandNextMoves(movementCommand);
  const primaryMovementItem = movementQueue.find(
    (item) =>
      movementCommand.title === item.title || movementCommand.title.endsWith(`: ${item.title}`),
  );
  const returnTo = `/movement?view=${view}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const viewBrief = buildMovementViewBrief({
    filteredCount: filteredPlan.length,
    query,
    sourceMix,
    summary,
    undecidedAskRuns,
    view,
  });

  return (
    <div className="page-shell">
      {message ? <div className="notice">{message}</div> : null}
      <DataLoadNotice health={loadHealth} />
      <div className="page-header">
        <div>
          <p className="eyebrow">Relationship Movement</p>
          <h1>Next Moves</h1>
          <p>
            A single operating queue for follow-ups, promises, introductions,
            referrals, verification work, outreach moves, and relationship prep.
          </p>
        </div>
        <Link className="button" href="/contacts">
          Open book
          <ArrowRight aria-hidden="true" size={16} />
        </Link>
      </div>

      <section
        className="today-command-center movement-command-center"
        aria-label="Movement command center"
      >
        <div className="today-command-primary">
          <div className="section-label">1 · Do this now</div>
          <span className={`pill ${movementCommand.tone}`}>
            {humanize(movementCommand.posture)}
          </span>
          <h2>{movementCommand.title}</h2>
          <p>{movementCommand.detail}</p>
          <p className="source-note">{movementCommand.guardrail}</p>
          <div className="review-actions">
            <Link
              className={`button ${movementCommand.tone === "hot" ? "hot" : "ghost"}`}
              href={movementCommand.primary.href}
            >
              {movementCommand.primary.label}
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
          {primaryMovementItem ? (
            <div className="movement-command-action">
              <MovementActionPanel item={primaryMovementItem} returnTo={returnTo} />
            </div>
          ) : null}
          {nextMoves.length > 0 ? (
            <div className="movement-next-queue">
              <div className="section-label">Then</div>
              <ol>
                {nextMoves.map((move, index) => (
                  <li key={`${move.href}:${move.label}`}>
                    <span className={`pill ${move.tone}`}>{index + 2}</span>
                    <Link href={move.href}>{move.label}</Link>
                    <span>{move.meta}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
        <div className="today-command-side">
          <div className="today-command-panel">
            <span className={`pill ${viewBrief.tone}`}>Current Lane</span>
            <h3>{viewBrief.title}</h3>
            <p>{viewBrief.detail}</p>
            <div className="priority-metrics compact" aria-label="Current lane counts">
              {viewBrief.metrics.map((metric) => (
                <div key={metric.label}>
                  <span>{metric.label}</span>
                  <b>{metric.value}</b>
                </div>
              ))}
            </div>
            <div className="review-actions">
              <Link className="button small hot" href={viewBrief.actionHref}>
                {viewBrief.actionLabel}
                <ArrowRight aria-hidden="true" size={14} />
              </Link>
              {view !== "active" || query ? (
                <Link className="button small ghost" href={viewBrief.resetHref}>
                  Reset lane
                </Link>
              ) : null}
            </div>
          </div>
          <div className="today-command-panel">
            <span className={`pill ${leadingMix.tone}`}>Follow-up mix</span>
            <h3>Most open items: {leadingMix.label}</h3>
            <p>
              {leadingMix.detail} Open the list to finish, schedule, or dismiss them.
            </p>
            <div className="intent-stack">
              <div>
                <span>Added by you</span>
                <b>{manualActionCount}</b>
              </div>
              <div>
                <span>Suggested</span>
                <p>
                  {askCreatedActionCount + claudeCreatedActionCount} suggestion
                  {askCreatedActionCount + claudeCreatedActionCount === 1 ? " is" : "s are"} waiting.
                </p>
              </div>
            </div>
            <div className="review-actions">
              <Link className="button small ghost" href={leadingMix.href}>
                Open follow-ups
                <ArrowRight aria-hidden="true" size={14} />
              </Link>
            </div>
          </div>
        </div>
        <div className="today-command-footer movement-command-footer">
          <div className="priority-metrics" aria-label="Follow-up totals">
            <div>
              <span>Open</span>
              <b>{summary.open}</b>
            </div>
            <div>
              <span>Hot</span>
              <b>{summary.overdue + summary.dueToday}</b>
            </div>
            <div>
              <span>Next Week</span>
              <b>{summary.dueSoon}</b>
            </div>
            <div>
              <span>Needs Date</span>
              <b>{summary.unscheduled}</b>
            </div>
          </div>
          <div className="priority-list" aria-label="Movement source lanes">
            {movementCommand.signals.map((signal) => (
              <div className="priority-item" key={signal.label}>
                <span className={`pill ${signal.tone}`}>{signal.label}</span>
                <b>{signal.value}</b>
                <span className="source-note">Current movement pressure</span>
              </div>
            ))}
            {operatingMix.map((item) => (
              <Link className="priority-item link-quiet" href={item.href} key={item.label}>
                <span className={`pill ${item.tone}`}>{item.label}</span>
                <b>{item.value}</b>
                <span>{item.detail}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <form action="/movement" className="card movement-filters">
        <div className="section-label">
          <Filter aria-hidden="true" size={15} />
          Filter tracked queue
        </div>
        <div className="movement-filter-controls">
          <label className="field compact">
            <span>View</span>
            <select defaultValue={view} name="view">
              {movementViews.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field compact">
            <span>Search</span>
            <input
              defaultValue={query}
              name="q"
              placeholder="Person, company, action, source"
              type="search"
            />
          </label>
          <button className="button small" type="submit">
            Apply
          </button>
          <Link className="button small ghost" href="/movement">
            Reset
          </Link>
        </div>
        <p className="source-note">
          Showing {filteredPlan.length} of {plan.length} relationship actions.
        </p>
      </form>

      {undecidedAskRuns > 0 ? (
        <section className="notice movement-notice">
          {undecidedAskRuns} saved Ask run{undecidedAskRuns === 1 ? "" : "s"} still need
          a follow-up or no-action decision before this queue is clean.
          <Link className="button small ghost" href="/ask?saved=needs_decision">
            Review Ask runs
          </Link>
        </section>
      ) : null}

      {askDecisionQueue.length > 0 ? (
        <section className="card support-card movement-lane">
          <div className="section-header">
            <div>
              <div className="section-label">
                <CircleDot aria-hidden="true" size={15} />
                Ask Decisions
              </div>
              <p>
                {askDecisionQueue.length} saved answer
                {askDecisionQueue.length === 1 ? "" : "s"} waiting to become a move or
                no action.
              </p>
            </div>
            <span className="pill gold">owner decision</span>
          </div>
          <div className="movement-card-list">
            {askDecisionQueue.slice(0, 8).map((item) => (
              <AskDecisionCard item={item} key={item.id} returnTo={returnTo} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="card support-card movement-lane" aria-label="Ranked tracked queue">
        <div className="section-header">
          <div>
            <div className="section-label">
              <CircleDot aria-hidden="true" size={15} />
              Ranked tracked queue
            </div>
            <p>
              {filteredPlan.length} action{filteredPlan.length === 1 ? "" : "s"} in this view,
              ordered by urgency and value.
            </p>
          </div>
          <span className="pill cool">{view === "closed" ? "history" : "working queue"}</span>
        </div>
        {filteredPlan.length > 0 ? (
          <div className="movement-card-list">
            {filteredPlan.slice(0, 50).map((item) => (
              <ActionCard
                item={item}
                key={item.action.id}
                returnTo={returnTo}
                showOperatorTools={adminMode}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            No tracked actions match this view. Reset the lane or use the command center&apos;s
            next relationship move.
          </div>
        )}
      </section>
    </div>
  );
}
