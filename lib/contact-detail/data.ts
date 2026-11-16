import { commandOutputDismissal } from "@/lib/command-output-dismissal";
import { buildDataLoadHealth } from "@/lib/data-load-health";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Contact = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  company_description: string | null;
  role_title: string[] | null;
  one_line_summary: string | null;
  trust_level: string | null;
  touch_cadence: string | null;
  engagement_target_per_month: number | null;
  relationship_strength: string | null;
  relationship_strength_reason: string | null;
  relationship_strength_override: boolean;
  relationship_type: string[] | null;
  last_spoke: string | null;
  how_we_met: string | null;
  why_stay_in_touch: string | null;
  location: string[] | null;
  linkedin: string | null;
  instagram: string | null;
  facebook: string | null;
  x_twitter: string | null;
  youtube: string | null;
  podcast_url: string | null;
  website: string | null;
  current_asks: string | null;
  wants_help_with: string | null;
  what_they_want_more_of: string | null;
  services_offered: string[] | null;
  ideal_referral: string | null;
  do_not_refer_for: string | null;
  could_refer_me_for: string[] | null;
  referral_intro_blurb: string | null;
  podcast_fit: string | null;
  primary_category: string[] | null;
  top_3_tags: string[] | null;
  keywords: string[] | null;
  recent_activity: string | null;
  personal_notes: string | null;
  private_notes: string | null;
};

export type PromiseRow = {
  id: string;
  interaction_id: string | null;
  promise_text: string;
  direction: string;
  status: string;
  due_on: string | null;
  completed_at: string | null;
  created_at: string;
  source: string | null;
  evidence: Record<string, unknown>;
};

export type InteractionContactRow = {
  interactions: {
    id: string;
    occurred_at: string;
    interaction_type: string;
    title: string | null;
    summary: string | null;
    source: string;
    source_ref: string | null;
    metadata: Record<string, unknown>;
  } | null;
};

export type TranscriptRow = {
  id: string;
  interaction_id: string | null;
  title: string | null;
  source: string | null;
  source_ref: string | null;
  distilled_summary: string | null;
  action_items: Array<{
    text?: string;
    assignee?: string | null;
    assignee_email?: string | null;
    contact_id?: string | null;
    owner_assigned?: boolean;
  }>;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type CalendarEventRow = {
  id: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  status: string | null;
  html_url: string | null;
  external_event_id: string;
};

export type IntroductionRow = {
  id: string;
  person_a: string | null;
  person_b: string | null;
  date_proposed: string | null;
  date_made: string | null;
  why_context: string | null;
  status: string;
  outcome: string | null;
  follow_up_on: string | null;
  person_a_contact?: { full_name: string | null } | null;
  person_b_contact?: { full_name: string | null } | null;
};

export type ProvenanceRow = {
  id: string;
  field_name: string;
  source_type: string;
  source_ref: string | null;
  summary: string | null;
  confidence: number | null;
  created_at: string;
};

export type ActiveEnrichmentJob = {
  id: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
  run_after: string;
};

export type CommandJobRow = {
  id: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  trackedAction?: {
    id: string;
    status: string;
  } | null;
};

export type ContactPendingChange = {
  id: string;
  change_type: string;
  summary: string;
  risk_level: string | null;
  source: string | null;
  created_at: string;
  replaces_pending_change_id: string | null;
  replaced_by_pending_change_id: string | null;
  superseded_at: string | null;
};

export type RelationshipActionRow = {
  id: string;
  title: string;
  action_type: string;
  status: string;
  priority: string;
  due_on: string | null;
  notes: string | null;
  source: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ContactRelationshipContext = {
  id: string;
  name: string;
  context_type: string;
  connection_prior: string;
  role_note: string | null;
};

export type AvailableRelationshipContext = {
  id: string;
  name: string;
  context_type: string;
};

type ContactRelationshipContextRow = {
  role_note: string | null;
  relationship_contexts:
    | Omit<ContactRelationshipContext, "role_note">
    | Array<Omit<ContactRelationshipContext, "role_note">>
    | null;
};

type CommandActionLinkRow = {
  id: string;
  status: string;
  metadata: Record<string, unknown>;
};

function activeJobForContact(jobs: ActiveEnrichmentJob[], contactId: string) {
  return jobs.find((job) => job.payload.contact_id === contactId) ?? null;
}

export function commandFocusFromJob(job: CommandJobRow) {
  const focus = job.payload.command_focus;
  return focus && typeof focus === "object" && !Array.isArray(focus)
    ? (focus as Record<string, unknown>)
    : null;
}

export function commandLabel(job: CommandJobRow) {
  const focus = commandFocusFromJob(job);
  return typeof focus?.label === "string" ? focus.label : "Relationship command";
}

export function commandIntent(job: CommandJobRow) {
  const focus = commandFocusFromJob(job);
  return typeof focus?.intent === "string"
    ? focus.intent.replaceAll("_", " ")
    : "command";
}

export function commandOutput(job: CommandJobRow) {
  const output = job.result.command_output;
  const summary = job.result.summary;
  const followUp = job.result.follow_up_needed;

  if (typeof output === "string" && output.trim()) return output.trim();
  if (typeof summary === "string" && summary.trim()) return summary.trim();
  if (typeof followUp === "string" && followUp.trim()) return followUp.trim();
  if (job.status === "succeeded") return "Completed without a saved command output.";
  if (job.status === "failed") {
    const error = job.result.last_error ?? job.result.error;
    return typeof error === "string" && error.trim()
      ? error.trim()
      : "Blocked before command output was returned.";
  }
  return "Waiting for Claude return.";
}

export function hasCommandOutput(job: CommandJobRow) {
  return (
    (typeof job.result.command_output === "string" &&
      job.result.command_output.trim().length > 0) ||
    (typeof job.result.summary === "string" && job.result.summary.trim().length > 0)
  );
}

export function commandDismissalLabel(job: CommandJobRow) {
  const dismissal = commandOutputDismissal(job.result);
  if (!dismissal) return null;
  return dismissal.reason ? `Dismissed · ${dismissal.reason}` : "Dismissed as no action needed.";
}

export function commandJobTone(job: CommandJobRow) {
  if (job.status === "succeeded") return "pill cool";
  if (job.status === "failed") return "pill warn";
  if (job.status === "running") return "pill hot";
  return "pill gold";
}

export async function getContactData(id: string) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      contact: null,
      promises: [] as PromiseRow[],
      interactions: [] as InteractionContactRow[],
      transcripts: [] as TranscriptRow[],
      calendarEvents: [] as CalendarEventRow[],
      introductions: [] as IntroductionRow[],
      provenance: [] as ProvenanceRow[],
      pendingChanges: [] as ContactPendingChange[],
      relationshipActions: [] as RelationshipActionRow[],
      activeRelationshipActions: [] as RelationshipActionRow[],
      relationshipContexts: [] as ContactRelationshipContext[],
      availableRelationshipContexts: [] as AvailableRelationshipContext[],
      commandJobs: [] as CommandJobRow[],
      latestEnrichmentJob: null as CommandJobRow | null,
      activeEnrichmentJob: null as ActiveEnrichmentJob | null,
      loadHealth: buildDataLoadHealth("Contact profile", [
        {
          key: "contacts",
          label: "contact profile",
          error: "private data connection missing",
          blocksSurface: true,
        },
      ]),
      error: "The private data connection is not configured.",
    };
  }

  const [
    contactResult,
    promisesResult,
    interactionLinksResult,
    introsA,
    introsB,
    provenanceResult,
    pendingChangesResult,
    relationshipActionsResult,
    activeRelationshipActionsResult,
    relationshipContextsResult,
    commandJobsResult,
    commandActionLinksResult,
    activeJobsResult,
    calendarAttendeesResult,
    availableRelationshipContextsResult,
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, full_name, email, phone, company_name, company_description, role_title, one_line_summary, trust_level, touch_cadence, engagement_target_per_month, relationship_strength, relationship_strength_reason, relationship_strength_override, relationship_type, last_spoke, how_we_met, why_stay_in_touch, location, linkedin, instagram, facebook, x_twitter, youtube, podcast_url, website, current_asks, wants_help_with, what_they_want_more_of, services_offered, ideal_referral, do_not_refer_for, could_refer_me_for, referral_intro_blurb, podcast_fit, primary_category, top_3_tags, keywords, recent_activity, personal_notes, private_notes",
      )
      .eq("id", id)
      .is("archived_at", null)
      .single(),
    supabase
      .from("promises")
      .select("id, interaction_id, promise_text, direction, status, due_on, completed_at, created_at, source, evidence")
      .eq("contact_id", id)
      .order("status")
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(20),
    supabase
      .from("interaction_contacts")
      .select("interaction_id")
      .eq("contact_id", id)
      .limit(200),
    supabase
      .from("introductions")
      .select(
        "id, person_a, person_b, date_proposed, date_made, why_context, status, outcome, follow_up_on, person_a_contact:contacts!introductions_person_a_fkey(full_name), person_b_contact:contacts!introductions_person_b_fkey(full_name)",
      )
      .eq("person_a", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("introductions")
      .select(
        "id, person_a, person_b, date_proposed, date_made, why_context, status, outcome, follow_up_on, person_a_contact:contacts!introductions_person_a_fkey(full_name), person_b_contact:contacts!introductions_person_b_fkey(full_name)",
      )
      .eq("person_b", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("field_provenance")
      .select("id, field_name, source_type, source_ref, summary, confidence, created_at")
      .eq("table_name", "contacts")
      .eq("record_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("pending_changes")
      .select(
        "id, change_type, summary, risk_level, source, created_at, replaces_pending_change_id, replaced_by_pending_change_id, superseded_at",
      )
      .eq("contact_id", id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("relationship_actions")
      .select("id, title, action_type, status, priority, due_on, notes, source, metadata, created_at")
      .eq("contact_id", id)
      .order("priority", { ascending: false })
      .order("due_on", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("relationship_actions")
      .select("id, title, action_type, status, priority, due_on, notes, source, metadata, created_at")
      .eq("contact_id", id)
      .in("status", ["open", "deferred"])
      .order("priority", { ascending: false })
      .order("due_on", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("relationship_context_memberships")
      .select(
        "role_note, relationship_contexts!inner(id, name, context_type, connection_prior)",
      )
      .eq("contact_id", id)
      .eq("verification_state", "confirmed")
      .order("updated_at", { ascending: false })
      .limit(25),
    supabase
      .from("jobs")
      .select("id, status, payload, result, created_at, updated_at")
      .eq("job_type", "contact_enrichment")
      .contains("payload", { contact_id: id })
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("relationship_actions")
      .select("id, status, metadata")
      .eq("contact_id", id)
      .eq("source", "claude_command_output")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("jobs")
      .select("id, status, payload, created_at, run_after")
      .eq("job_type", "contact_enrichment")
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("calendar_attendees")
      .select("event_id")
      .eq("matched_contact_id", id)
      .limit(50),
    supabase
      .from("relationship_contexts")
      .select("id, name, context_type")
      .is("archived_at", null)
      .order("name")
      .limit(250),
  ]);

  const interactionIds = Array.from(
    new Set(
      (interactionLinksResult.data ?? [])
        .map((row) => row.interaction_id)
        .filter((interactionId): interactionId is string => Boolean(interactionId)),
    ),
  );
  const calendarEventIds = Array.from(
    new Set(
      (calendarAttendeesResult.data ?? [])
        .map((row) => row.event_id)
        .filter((eventId): eventId is string => Boolean(eventId)),
    ),
  );
  const [interactionsResult, transcriptsResult, calendarEventsResult] =
    await Promise.all([
      interactionIds.length > 0
        ? supabase
            .from("interactions")
            .select("id, occurred_at, interaction_type, title, summary, source, source_ref, metadata")
            .in("id", interactionIds)
            .order("occurred_at", { ascending: false })
            .limit(100)
        : Promise.resolve({
            data: [] as NonNullable<InteractionContactRow["interactions"]>[],
            error: null,
          }),
      interactionIds.length > 0
        ? supabase
            .from("transcripts")
            .select(
              "id, interaction_id, title, source, source_ref, distilled_summary, action_items, metadata, created_at",
            )
            .in("interaction_id", interactionIds)
            .eq("processing_status", "ready")
            .order("created_at", { ascending: false })
            .limit(100)
        : Promise.resolve({ data: [] as TranscriptRow[], error: null }),
      calendarEventIds.length > 0
        ? supabase
            .from("calendar_events")
            .select("id, title, starts_at, ends_at, status, html_url, external_event_id")
            .in("id", calendarEventIds)
            .order("starts_at", { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] as CalendarEventRow[], error: null }),
    ]);

  const coreLoadHealth = buildDataLoadHealth("Contact profile", [
    {
      key: "contacts",
      label: "contact profile",
      error: contactResult.error || (!contactResult.data ? "missing contact" : null),
      blocksSurface: true,
    },
  ]);

  if (contactResult.error || !contactResult.data) {
    return {
      contact: null,
      promises: [],
      interactions: [],
      transcripts: [],
      calendarEvents: [],
      introductions: [],
      provenance: [],
      pendingChanges: [],
      relationshipActions: [],
      activeRelationshipActions: [],
      relationshipContexts: [],
      availableRelationshipContexts: [],
      commandJobs: [],
      activeEnrichmentJob: null,
      latestEnrichmentJob: null,
      loadHealth: coreLoadHealth,
      error: "That contact is not visible in this private book.",
    };
  }

  const loadHealth = buildDataLoadHealth("Contact profile", [
    { key: "contacts", label: "contact profile", error: contactResult.error, blocksSurface: true },
    { key: "promises", label: "promises", error: promisesResult.error },
    {
      key: "interaction_links",
      label: "interaction links",
      error: interactionLinksResult.error,
    },
    { key: "interactions", label: "interactions", error: interactionsResult.error },
    { key: "transcripts", label: "distilled transcripts", error: transcriptsResult.error },
    {
      key: "calendar_attendees",
      label: "meeting matches",
      error: calendarAttendeesResult.error,
    },
    {
      key: "calendar_events",
      label: "meeting events",
      error: calendarEventsResult.error,
    },
    { key: "introductions_a", label: "introductions sent", error: introsA.error },
    { key: "introductions_b", label: "introductions received", error: introsB.error },
    { key: "provenance", label: "field provenance", error: provenanceResult.error },
    { key: "pending_changes", label: "pending changes", error: pendingChangesResult.error },
    { key: "relationship_actions", label: "relationship actions", error: relationshipActionsResult.error },
    { key: "active_relationship_actions", label: "active relationship actions", error: activeRelationshipActionsResult.error },
    { key: "relationship_contexts", label: "shared groups and events", error: relationshipContextsResult.error },
    {
      key: "available_relationship_contexts",
      label: "available shared groups and events",
      error: availableRelationshipContextsResult.error,
    },
    { key: "command_jobs", label: "Claude command jobs", error: commandJobsResult.error },
    {
      key: "command_action_links",
      label: "Claude command action links",
      error: commandActionLinksResult.error,
    },
    { key: "active_jobs", label: "active enrichment jobs", error: activeJobsResult.error },
  ]);

  const activeJobs = ((activeJobsResult.data ?? []) as unknown) as ActiveEnrichmentJob[];
  const relationshipContexts = (((relationshipContextsResult.data ?? []) as unknown) as ContactRelationshipContextRow[])
    .flatMap((row) => {
      const contexts = Array.isArray(row.relationship_contexts)
        ? row.relationship_contexts
        : row.relationship_contexts
          ? [row.relationship_contexts]
          : [];
      return contexts.map((relationshipContext) => ({
        ...relationshipContext,
        role_note: row.role_note,
      }));
    });
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

  return {
    contact: contactResult.data as Contact,
    promises: (promisesResult.data ?? []) as PromiseRow[],
    interactions: (((interactionsResult.data ?? []) as unknown) as NonNullable<
      InteractionContactRow["interactions"]
    >[]).map((interaction) => ({ interactions: interaction })),
    transcripts: ((transcriptsResult.data ?? []) as unknown) as TranscriptRow[],
    calendarEvents: ((calendarEventsResult.data ?? []) as unknown) as CalendarEventRow[],
    introductions: ([...(introsA.data ?? []), ...(introsB.data ?? [])] as unknown) as IntroductionRow[],
    provenance: ((provenanceResult.data ?? []) as unknown) as ProvenanceRow[],
    pendingChanges: ((pendingChangesResult.data ?? []) as unknown) as ContactPendingChange[],
    relationshipActions: ((relationshipActionsResult.data ?? []) as unknown) as RelationshipActionRow[],
    activeRelationshipActions: ((activeRelationshipActionsResult.data ?? []) as unknown) as RelationshipActionRow[],
    relationshipContexts,
    availableRelationshipContexts: ((availableRelationshipContextsResult.data ?? []) as unknown) as AvailableRelationshipContext[],
    commandJobs: (((commandJobsResult.data ?? []) as unknown) as CommandJobRow[])
      .filter((job) => Boolean(commandFocusFromJob(job)))
      .map((job) => ({
        ...job,
        trackedAction: commandActionsByJobId.get(job.id) ?? null,
      }))
      .slice(0, 8),
    latestEnrichmentJob:
      ((((commandJobsResult.data ?? []) as unknown) as CommandJobRow[])[0] ?? null),
    activeEnrichmentJob: activeJobForContact(activeJobs, id),
    loadHealth,
    error: null,
  };
}
