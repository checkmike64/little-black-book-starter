import { type KeepInTouchContact } from "@/lib/keep-in-touch";
import { hasAskRunDecision } from "@/lib/ask-run-decision";
import { commandOutputDismissal } from "@/lib/command-output-dismissal";
import { buildDataLoadHealth } from "@/lib/data-load-health";
import type { EngagementContactRow } from "@/lib/engagement-candidates";
import { sampleContacts } from "@/lib/sample-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant-context";

export type ContactRow = EngagementContactRow & {
  id: string;
  full_name: string;
  company_name: string | null;
  role_title: string[] | null;
  trust_level: string | null;
  relationship_strength: string | null;
  relationship_type: string[] | null;
  email: string | null;
  touch_cadence?: string | null;
  last_spoke: string | null;
  current_asks?: string | null;
  wants_help_with?: string | null;
  ideal_referral?: string | null;
  podcast_fit?: string | null;
  recent_activity?: string | null;
  top_3_tags?: string[] | null;
  personal_notes?: string | null;
  private_notes?: string | null;
};

export type InteractionRow = {
  id: string;
  occurred_at: string;
  interaction_type: string;
  title: string | null;
  summary: string | null;
  source: string | null;
  interaction_contacts?: Array<{
      contacts?: {
      id?: string | null;
      full_name: string | null;
      trust_level?: string | null;
      last_spoke?: string | null;
    } | null;
  }>;
};

export type CalendarAttendeeRow = {
  id: string;
  normalized_email: string;
  display_name: string | null;
  response_status: string | null;
  matched_contact_id: string | null;
  matched_want_to_know_id: string | null;
  metadata?: {
    relationship_hint?: string | null;
    source?: string | null;
  } | null;
  contacts?: {
    id: string;
    full_name: string;
    email?: string | null;
    trust_level: string | null;
    last_spoke: string | null;
  } | null;
  want_to_know?: {
    id: string;
    full_name: string;
    stage: string;
  } | null;
};

export type CalendarEventRow = {
  id: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  html_url: string | null;
  is_all_day: boolean;
  status?: string | null;
  provider?: string | null;
  metadata?: {
    briefing?: {
      whats_new?: string[];
      their_asks?: string[];
      our_notes?: string[];
      opportunities?: string[];
      recommended_follow_up?: string | null;
    };
    source?: string | null;
  } | null;
  calendar_attendees?: CalendarAttendeeRow[];
};

export type PendingCalendarAttendeeRow = CalendarAttendeeRow & {
  event_id: string;
  event_title: string | null;
  event_starts_at: string;
};

export type PromiseRow = {
  id: string;
  promise_text: string;
  direction: string;
  due_on: string | null;
  review_status: "pending_owner" | "accepted" | "declined";
  contacts?: {
    id?: string | null;
    full_name: string | null;
  } | null;
};

export type ClosedPromiseRow = PromiseRow & {
  status: string;
  completed_at: string | null;
};

export type IntroductionRow = {
  id: string;
  person_a: string | null;
  person_b: string | null;
  date_proposed: string | null;
  date_made: string | null;
  why_context: string | null;
  status: string;
  follow_up_on: string | null;
  person_a_contact?: { id: string | null; full_name: string | null } | null;
  person_b_contact?: { id: string | null; full_name: string | null } | null;
};

export type PendingChangeRow = {
  id: string;
  change_type: string;
  summary: string;
  risk_level: string | null;
  source: string | null;
  created_at: string;
};

export type JobRow = {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  run_after: string;
  created_at: string;
};

export type CommandJobRow = JobRow & {
  trackedAction?: {
    id: string;
    status: string;
  } | null;
};

type CommandActionLinkRow = {
  id: string;
  status: string;
  metadata: Record<string, unknown>;
};

export type RelationshipActionRow = {
  id: string;
  title: string;
  action_type: string;
  status: string;
  priority: string;
  due_on: string | null;
  metadata?: Record<string, unknown> | null;
  source?: string | null;
  contacts?: {
    id?: string | null;
    full_name: string | null;
  } | null;
};

export type ClosedRelationshipActionRow = RelationshipActionRow & {
  completed_at: string | null;
};

type AskRunRow = {
  id: string;
  answer: Record<string, unknown> | null;
};

function commandFocus(job: CommandJobRow) {
  const focus = job.payload.command_focus;
  if (!focus || typeof focus !== "object" || Array.isArray(focus)) return null;
  return focus as Record<string, unknown>;
}

export function commandLabel(job: CommandJobRow) {
  const focus = commandFocus(job);
  return typeof focus?.label === "string" ? focus.label : "Relationship command";
}

export function commandIntent(job: CommandJobRow) {
  const focus = commandFocus(job);
  return typeof focus?.intent === "string"
    ? focus.intent.replaceAll("_", " ")
    : "command";
}

export function commandContactId(job: CommandJobRow) {
  return typeof job.payload.contact_id === "string" ? job.payload.contact_id : null;
}

export function commandDismissalLabel(job: CommandJobRow) {
  const dismissal = commandOutputDismissal(job.result);
  if (!dismissal) return null;
  return dismissal.reason ? `Dismissed · ${dismissal.reason}` : "Dismissed as no action needed.";
}

export function commandOutput(job: CommandJobRow) {
  if (typeof job.result.command_output === "string" && job.result.command_output.trim()) {
    return job.result.command_output.trim();
  }

  if (typeof job.result.summary === "string" && job.result.summary.trim()) {
    return job.result.summary.trim();
  }

  if (typeof job.result.last_error === "string" && job.result.last_error.trim()) {
    return job.result.last_error.trim();
  }

  if (job.status === "queued") return "Queued for Claude.";
  if (job.status === "running") return "Claude has claimed this command.";
  return "No command output has been recorded yet.";
}

export function completedToday(job: CommandJobRow) {
  const completedAt = job.result.completed_at;
  if (typeof completedAt !== "string") return false;
  const parsed = Date.parse(completedAt);
  if (!Number.isFinite(parsed)) return false;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  return parsed >= todayStart.getTime();
}

export async function getDashboardData() {
  const supabase = await createSupabaseServerClient();
  const context = await getTenantContext();
  if (!supabase || !context) {
    return {
      contacts: sampleContacts,
      todayContacts: sampleContacts,
      recentInteractions: [] as InteractionRow[],
      upcomingMeetings: [] as InteractionRow[],
      calendarEvents: [] as CalendarEventRow[],
      pendingCalendarAttendees: [] as PendingCalendarAttendeeRow[],
      openPromises: [] as PromiseRow[],
      introductions: [] as IntroductionRow[],
      pendingRows: [] as PendingChangeRow[],
      relationshipActions: [] as RelationshipActionRow[],
      closeoutInteractions: [] as InteractionRow[],
      closedPromises: [] as ClosedPromiseRow[],
      closedRelationshipActions: [] as ClosedRelationshipActionRow[],
      activeJobs: [] as JobRow[],
      recentCommandJobs: [] as CommandJobRow[],
      priorityCommandJobs: [] as CommandJobRow[],
      contactCount: sampleContacts.length,
      pendingChangeCount: 0,
      duePromiseCount: 0,
      openPromiseCount: 0,
      recentInteractionCount: 0,
      queuedJobCount: 0,
      askRunUndecidedCount: 0,
      setupMode: true,
      error: null,
      loadHealth: buildDataLoadHealth("Today data", []),
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();
  const calendarStart = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const calendarEnd = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const [
    contactsResult,
    contactCountResult,
    pendingChangeCountResult,
    duePromiseCountResult,
    openPromiseCountResult,
    recentInteractionCountResult,
    recentInteractionsResult,
    upcomingMeetingsResult,
    openPromisesResult,
    introductionsResult,
    pendingRowsResult,
    relationshipActionsResult,
    closeoutInteractionsResult,
    closedPromisesResult,
    closedRelationshipActionsResult,
    activeJobsResult,
    recentJobsResult,
    commandActionLinksResult,
    queuedJobCountResult,
    askRunsResult,
    calendarEventsResult,
    calendarPreferencesResult,
    scheduledTodayContactsResult,
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, full_name, company_name, role_title, trust_level, relationship_strength, relationship_type, email, touch_cadence, last_spoke, current_asks, wants_help_with, ideal_referral, podcast_fit, recent_activity, top_3_tags, personal_notes, private_notes",
      )
      .order("last_spoke", { ascending: true, nullsFirst: false })
      .limit(80),
    supabase.from("contacts").select("id", { count: "exact", head: true }),
    supabase
      .from("pending_changes")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("promises")
      .select("id", { count: "exact", head: true })
      .eq("status", "open")
      .lte("due_on", today),
    supabase
      .from("promises")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    supabase.from("interactions").select("id", { count: "exact", head: true }),
    supabase
      .from("interactions")
      .select(
        "id, occurred_at, interaction_type, title, summary, source, interaction_contacts(contact_id, contacts(full_name))",
      )
      .order("occurred_at", { ascending: false })
      .limit(4),
    supabase
      .from("interactions")
      .select(
        "id, occurred_at, interaction_type, title, summary, source, interaction_contacts(contact_id, contacts(id, full_name, trust_level, last_spoke))",
      )
      .eq("interaction_type", "meeting")
      .gte("occurred_at", new Date().toISOString())
      .order("occurred_at", { ascending: true })
      .limit(4),
    supabase
      .from("promises")
      .select("id, promise_text, direction, due_on, contacts(id, full_name)")
      .eq("status", "open")
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(5),
    supabase
      .from("introductions")
      .select(
        "id, person_a, person_b, date_proposed, date_made, why_context, status, follow_up_on, person_a_contact:contacts!introductions_person_a_fkey(id, full_name), person_b_contact:contacts!introductions_person_b_fkey(id, full_name)",
      )
      .not("status", "in", "(closed,stopped)")
      .order("follow_up_on", { ascending: true, nullsFirst: false })
      .limit(12),
    supabase
      .from("pending_changes")
      .select("id, change_type, summary, risk_level, source, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("relationship_actions")
      .select(
        "id, title, action_type, status, priority, due_on, source, metadata, contacts(id, full_name)",
      )
      .in("status", ["open", "deferred"])
      .order("priority", { ascending: false })
      .order("due_on", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("interactions")
      .select(
        "id, occurred_at, interaction_type, title, summary, source, interaction_contacts(contact_id, contacts(full_name))",
      )
      .gte("occurred_at", todayStartIso)
      .order("occurred_at", { ascending: false })
      .limit(10),
    supabase
      .from("promises")
      .select("id, promise_text, direction, status, due_on, completed_at, contacts(id, full_name)")
      .in("status", ["completed", "skipped", "stopped"])
      .gte("completed_at", todayStartIso)
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(10),
    supabase
      .from("relationship_actions")
      .select(
        "id, title, action_type, status, priority, due_on, source, metadata, completed_at, contacts(id, full_name)",
      )
      .in("status", ["done", "skipped"])
      .gte("completed_at", todayStartIso)
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(10),
    supabase
      .from("jobs")
      .select("id, job_type, status, attempts, payload, result, run_after, created_at")
      .in("status", ["queued", "running", "failed"])
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("jobs")
      .select("id, job_type, status, attempts, payload, result, run_after, created_at")
      .order("created_at", { ascending: false })
      .limit(24),
    supabase
      .from("relationship_actions")
      .select("id, status, metadata")
      .eq("source", "claude_command_output")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "running"]),
    supabase
      .from("ask_runs")
      .select("id, answer")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("calendar_events")
      .select(
        "id, provider, title, starts_at, ends_at, status, html_url, is_all_day, metadata, calendar_attendees(id, normalized_email, display_name, response_status, matched_contact_id, matched_want_to_know_id, metadata, contacts:contacts!calendar_attendees_tenant_contact_fkey(id, full_name, email, trust_level, last_spoke), want_to_know:want_to_know!calendar_attendees_tenant_want_fkey(id, full_name, stage))",
      )
      .eq("tenant_id", context.tenantId)
      .eq("owner_user_id", context.userId)
      .eq("provider", "claude_calendar")
      .gte("starts_at", calendarStart)
      .lte("starts_at", calendarEnd)
      .neq("status", "cancelled")
      .order("starts_at", { ascending: true }),
    supabase
      .from("calendar_attendee_preferences")
      .select("normalized_email, decision")
      .eq("tenant_id", context.tenantId)
      .eq("user_id", context.userId),
    supabase
      .from("relationship_actions")
      .select("contact_id")
      .eq("tenant_id", context.tenantId)
      .eq("source", "today_schedule")
      .in("status", ["open", "deferred"])
      .gt("due_on", today),
  ]);

  if (contactsResult.error || !contactsResult.data) {
    return {
      contacts: [],
      todayContacts: [],
      recentInteractions: [],
      upcomingMeetings: [],
      calendarEvents: [],
      pendingCalendarAttendees: [],
      openPromises: [],
      introductions: [],
      pendingRows: [],
      relationshipActions: [],
      closeoutInteractions: [],
      closedPromises: [],
      closedRelationshipActions: [],
      activeJobs: [],
      recentCommandJobs: [],
      priorityCommandJobs: [],
      contactCount: 0,
      pendingChangeCount: 0,
      duePromiseCount: 0,
      openPromiseCount: 0,
      recentInteractionCount: 0,
      queuedJobCount: 0,
      askRunUndecidedCount: 0,
      setupMode: false,
      error: "The private database connection is configured, but contacts could not be loaded.",
      loadHealth: buildDataLoadHealth("Today data", [
        {
          key: "contacts",
          label: "contacts",
          error: contactsResult.error ?? new Error("No contact data returned."),
          blocksSurface: true,
        },
      ]),
    };
  }

  const loadHealth = buildDataLoadHealth("Today data", [
    { key: "contact-count", label: "contact count", error: contactCountResult.error },
    {
      key: "pending-change-count",
      label: "pending change count",
      error: pendingChangeCountResult.error,
    },
    { key: "due-promise-count", label: "due promise count", error: duePromiseCountResult.error },
    { key: "open-promise-count", label: "open promise count", error: openPromiseCountResult.error },
    {
      key: "recent-interaction-count",
      label: "interaction count",
      error: recentInteractionCountResult.error,
    },
    { key: "recent-interactions", label: "recent interactions", error: recentInteractionsResult.error },
    { key: "upcoming-meetings", label: "upcoming meetings", error: upcomingMeetingsResult.error },
    { key: "open-promises", label: "open promises", error: openPromisesResult.error },
    { key: "introductions", label: "introductions", error: introductionsResult.error },
    { key: "pending-changes", label: "pending changes", error: pendingRowsResult.error },
    {
      key: "relationship-actions",
      label: "relationship actions",
      error: relationshipActionsResult.error,
    },
    {
      key: "closeout-interactions",
      label: "daily closeout interactions",
      error: closeoutInteractionsResult.error,
    },
    { key: "closed-promises", label: "closed promises", error: closedPromisesResult.error },
    {
      key: "closed-relationship-actions",
      label: "closed relationship actions",
      error: closedRelationshipActionsResult.error,
    },
    { key: "active-jobs", label: "active jobs", error: activeJobsResult.error },
    { key: "recent-jobs", label: "recent jobs", error: recentJobsResult.error },
    {
      key: "command-action-links",
      label: "command action links",
      error: commandActionLinksResult.error,
    },
    { key: "queued-job-count", label: "queued job count", error: queuedJobCountResult.error },
    { key: "ask-runs", label: "Ask decisions", error: askRunsResult.error },
    {
      key: "calendar-events",
      label: "meeting events",
      error: calendarEventsResult.error,
    },
    {
      key: "calendar-preferences",
      label: "meeting preferences",
      error: calendarPreferencesResult.error,
    },
    {
      key: "scheduled-today-contacts",
      label: "scheduled Today contacts",
      error: scheduledTodayContactsResult.error,
    },
  ]);
  const askRuns = ((askRunsResult.data ?? []) as unknown) as AskRunRow[];

  const commandActionsByJobId = new Map<string, { id: string; status: string }>();
  (((commandActionLinksResult.data ?? []) as unknown) as CommandActionLinkRow[]).forEach(
    (action) => {
      const jobId = action.metadata.job_id;
      if (typeof jobId === "string") {
        commandActionsByJobId.set(jobId, {
          id: action.id,
          status: action.status,
        });
      }
    },
  );

  const commandJobs = (((recentJobsResult.data ?? []) as unknown) as JobRow[])
    .filter((job) => Boolean(commandFocus(job)))
    .map((job) => ({
      ...job,
      trackedAction: commandActionsByJobId.get(job.id) ?? null,
    }));
  const calendarEvents =
    ((calendarEventsResult.data ?? []) as unknown) as CalendarEventRow[];
  const handledEmails = new Set(
    (calendarPreferencesResult.data ?? []).map((row) =>
      String(row.normalized_email).toLowerCase(),
    ),
  );
  const pendingByEmail = new Map<string, PendingCalendarAttendeeRow>();
  for (const event of calendarEvents) {
    for (const attendee of event.calendar_attendees ?? []) {
      const email = attendee.normalized_email.toLowerCase();
      if (
        attendee.matched_contact_id ||
        attendee.matched_want_to_know_id ||
        handledEmails.has(email) ||
        pendingByEmail.has(email)
      ) {
        continue;
      }
      pendingByEmail.set(email, {
        ...attendee,
        event_id: event.id,
        event_title: event.title,
        event_starts_at: event.starts_at,
      });
    }
  }
  const pendingCalendarAttendees = [...pendingByEmail.values()];
  const scheduledContactIds = new Set(
    (scheduledTodayContactsResult.data ?? [])
      .map((row) => row.contact_id)
      .filter((value): value is string => Boolean(value)),
  );
  const todayContacts = (contactsResult.data as ContactRow[]).filter(
    (contact) => !scheduledContactIds.has(contact.id),
  );

  return {
    contacts: contactsResult.data as ContactRow[],
    todayContacts,
    recentInteractions: ((recentInteractionsResult.data ?? []) as unknown) as InteractionRow[],
    upcomingMeetings: ((upcomingMeetingsResult.data ?? []) as unknown) as InteractionRow[],
    calendarEvents,
    pendingCalendarAttendees,
    openPromises: ((openPromisesResult.data ?? []) as unknown) as PromiseRow[],
    introductions: ((introductionsResult.data ?? []) as unknown) as IntroductionRow[],
    pendingRows: ((pendingRowsResult.data ?? []) as unknown) as PendingChangeRow[],
    relationshipActions: ((relationshipActionsResult.data ?? []) as unknown) as RelationshipActionRow[],
    closeoutInteractions: ((closeoutInteractionsResult.data ?? []) as unknown) as InteractionRow[],
    closedPromises: ((closedPromisesResult.data ?? []) as unknown) as ClosedPromiseRow[],
    closedRelationshipActions: ((closedRelationshipActionsResult.data ?? []) as unknown) as ClosedRelationshipActionRow[],
    activeJobs: ((activeJobsResult.data ?? []) as unknown) as JobRow[],
    recentCommandJobs: commandJobs.slice(0, 4),
    priorityCommandJobs: commandJobs.slice(0, 12),
    contactCount: contactCountResult.count ?? contactsResult.data.length,
    pendingChangeCount: pendingChangeCountResult.count ?? 0,
    duePromiseCount: duePromiseCountResult.count ?? 0,
    openPromiseCount: openPromiseCountResult.count ?? 0,
    recentInteractionCount: recentInteractionCountResult.count ?? 0,
    queuedJobCount: queuedJobCountResult.count ?? 0,
    askRunUndecidedCount: askRuns.filter((run) => !hasAskRunDecision(run.answer)).length,
    setupMode: false,
    error: null,
    loadHealth,
  };
}

export async function getTodayData() {
  const supabase = await createSupabaseServerClient();
  const context = await getTenantContext();
  const empty = {
    keepInTouchContacts: [] as KeepInTouchContact[],
    keepInTouchError: false,
    calendarEvents: [] as CalendarEventRow[],
    pendingCalendarAttendees: [] as PendingCalendarAttendeeRow[],
    recentInteractions: [] as InteractionRow[],
    setupMode: true,
    error: null as string | null,
    loadHealth: buildDataLoadHealth("Today", []),
  };
  if (!supabase || !context) return empty;

  const keepInTouchContacts: KeepInTouchContact[] = [];
  let keepInTouchError = false;
  for (let offset = 0; ; offset += 1000) {
    const result = await supabase.from("contacts")
      .select("id, full_name, trust_level, touch_cadence, last_spoke")
      .eq("tenant_id", context.tenantId).is("archived_at", null)
      .order("id").range(offset, offset + 999);
    if (result.error) { keepInTouchError = true; break; }
    keepInTouchContacts.push(...(result.data ?? []));
    if (!result.data || result.data.length < 1000) break;
  }

  const now = new Date();
  const calendarStart = new Date(
    now.getTime() - 72 * 60 * 60 * 1000,
  ).toISOString();
  const calendarEnd = new Date(
    now.getTime() + 48 * 60 * 60 * 1000,
  ).toISOString();

  const [
    eventsResult,
    preferencesResult,
    recentInteractionsResult,
  ] = await Promise.all([
    supabase
      .from("calendar_events")
      .select(
        "id, provider, title, starts_at, ends_at, status, html_url, is_all_day, metadata, calendar_attendees(id, normalized_email, display_name, response_status, matched_contact_id, matched_want_to_know_id, metadata, contacts:contacts!calendar_attendees_tenant_contact_fkey(id, full_name, email, trust_level, last_spoke), want_to_know:want_to_know!calendar_attendees_tenant_want_fkey(id, full_name, stage))",
      )
      .eq("tenant_id", context.tenantId)
      .eq("owner_user_id", context.userId)
      .eq("provider", "claude_calendar")
      .gte("starts_at", calendarStart)
      .lte("starts_at", calendarEnd)
      .neq("status", "cancelled")
      .order("starts_at", { ascending: true }),
    supabase
      .from("calendar_attendee_preferences")
      .select("normalized_email")
      .eq("tenant_id", context.tenantId)
      .eq("user_id", context.userId),
    supabase
      .from("interactions")
      .select(
        "id, occurred_at, interaction_type, title, summary, source, interaction_contacts(contact_id, contacts(id, full_name))",
      )
      .eq("tenant_id", context.tenantId)
      .order("occurred_at", { ascending: false })
      .limit(5),
  ]);

  const calendarEvents =
    ((eventsResult.data ?? []) as unknown) as CalendarEventRow[];
  const handledEmails = new Set(
    (preferencesResult.data ?? []).map((row) =>
      String(row.normalized_email).toLowerCase(),
    ),
  );
  const pendingByEmail = new Map<string, PendingCalendarAttendeeRow>();
  for (const event of calendarEvents) {
    for (const attendee of event.calendar_attendees ?? []) {
      const email = attendee.normalized_email.toLowerCase();
      if (
        attendee.matched_contact_id ||
        attendee.matched_want_to_know_id ||
        handledEmails.has(email) ||
        pendingByEmail.has(email)
      ) {
        continue;
      }
      pendingByEmail.set(email, {
        ...attendee,
        event_id: event.id,
        event_title: event.title,
        event_starts_at: event.starts_at,
      });
    }
  }

  const loadHealth = buildDataLoadHealth("Today", [
    {
      key: "calendar-events",
      label: "meeting context",
      error: eventsResult.error,
    },
    {
      key: "calendar-preferences",
      label: "meeting decisions",
      error: preferencesResult.error,
    },
    {
      key: "recent-interactions",
      label: "recent activity",
      error: recentInteractionsResult.error,
    },
  ]);

  return {
    keepInTouchContacts,
    keepInTouchError,
    calendarEvents,
    pendingCalendarAttendees: [...pendingByEmail.values()],
    recentInteractions: ((recentInteractionsResult.data ?? []) as unknown) as InteractionRow[],
    setupMode: false,
    error: loadHealth.isBlocked ? "Today could not be loaded completely." : null,
    loadHealth,
  };
}
