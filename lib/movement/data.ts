import { buildDataLoadHealth } from "@/lib/data-load-health";
import {
  type MovementContact,
  type MovementIntroduction,
  type MovementPromise,
} from "@/lib/relationship-movement";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type RelationshipActionRow = {
  id: string;
  contact_id: string | null;
  title: string;
  action_type: string;
  status: string;
  priority: string;
  due_on: string | null;
  notes: string | null;
  source: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
  contacts?: {
    id: string | null;
    full_name: string | null;
    company_name: string | null;
  } | null;
};

type RelationshipActionQueryRow = Omit<RelationshipActionRow, "contacts"> & {
  contacts?:
    | {
        id: string | null;
        full_name: string | null;
        company_name: string | null;
      }
    | Array<{
        id: string | null;
        full_name: string | null;
        company_name: string | null;
      }>
    | null;
};

export type AskRunRow = {
  id: string;
  mode: string;
  query: string | null;
  title: string | null;
  answer: Record<string, unknown> | null;
  shortlist?: Array<Record<string, unknown>> | null;
  context_hits?: Array<Record<string, unknown>> | null;
  created_at: string;
};

export type MovementPromiseRow = MovementPromise & {
  status?: string | null;
};

export type MovementIntroductionRow = MovementIntroduction;

function normalizeAction(row: RelationshipActionQueryRow): RelationshipActionRow {
  const contacts = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;

  return {
    ...row,
    contacts: contacts ?? null,
  };
}

export async function getMovementData({
  includeClosedActions,
  tenantId,
}: {
  includeClosedActions: boolean;
  tenantId: string;
}) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const relationshipActionSelect =
    "id, contact_id, title, action_type, status, priority, due_on, notes, source, metadata, created_at, completed_at, contacts(id, full_name, company_name)";
  const closedActionsPromise = includeClosedActions
    ? supabase
        .from("relationship_actions")
        .select(relationshipActionSelect)
        .eq("tenant_id", tenantId)
        .in("status", ["done", "skipped"])
        .order("completed_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(80)
    : Promise.resolve({ data: [], error: null });

  const [
    activeActionsResult,
    closedActionsResult,
    askRunsResult,
    contactsResult,
    promisesResult,
    introductionsResult,
  ] = await Promise.all([
    supabase
      .from("relationship_actions")
      .select(relationshipActionSelect)
      .eq("tenant_id", tenantId)
      .in("status", ["open", "deferred"])
      .order("due_on", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(250),
    closedActionsPromise,
    supabase
      .from("ask_runs")
      .select("id, mode, query, title, answer, shortlist, context_hits, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("contacts")
      .select(
        "id, full_name, company_name, trust_level, relationship_strength, relationship_type, touch_cadence, last_spoke, current_asks, wants_help_with, ideal_referral, podcast_fit, recent_activity",
      )
      .eq("tenant_id", tenantId)
      .is("archived_at", null)
      .limit(500),
    supabase
      .from("promises")
      .select("id, promise_text, direction, due_on, status, contacts(id, full_name)")
      .eq("tenant_id", tenantId)
      .eq("status", "open")
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(100),
    supabase
      .from("introductions")
      .select(
        "id, person_a, person_b, date_proposed, date_made, why_context, status, follow_up_on, person_a_contact:contacts!introductions_person_a_fkey(id, full_name), person_b_contact:contacts!introductions_person_b_fkey(id, full_name)",
      )
      .eq("tenant_id", tenantId)
      .not("status", "in", "(closed,stopped)")
      .order("follow_up_on", { ascending: true, nullsFirst: false })
      .limit(100),
  ]);

  const actionRows = [
    ...(((activeActionsResult.data ?? []) as unknown) as RelationshipActionQueryRow[]),
    ...(((closedActionsResult.data ?? []) as unknown) as RelationshipActionQueryRow[]),
  ];

  return {
    actions: actionRows.map(normalizeAction),
    askRuns: ((askRunsResult.data ?? []) as unknown) as AskRunRow[],
    contacts: ((contactsResult.data ?? []) as unknown) as MovementContact[],
    introductions: ((introductionsResult.data ?? []) as unknown) as MovementIntroductionRow[],
    loadHealth: buildDataLoadHealth("Movement data", [
      {
        key: "relationship-actions",
        label: "relationship actions",
        error: activeActionsResult.error,
        blocksSurface: true,
      },
      {
        key: "closed-relationship-actions",
        label: "closed relationship actions",
        error: closedActionsResult.error,
      },
      { key: "ask-decisions", label: "Ask decisions", error: askRunsResult.error },
      {
        key: "relationship-contacts",
        label: "relationship contacts",
        error: contactsResult.error,
      },
      { key: "promises", label: "promises", error: promisesResult.error },
      { key: "introductions", label: "introductions", error: introductionsResult.error },
    ]),
    promises: ((promisesResult.data ?? []) as unknown) as MovementPromiseRow[],
  };
}
