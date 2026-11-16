import { getTenantContext } from "@/lib/tenant-context";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { buildDataLoadHealth, type DataLoadHealth } from "@/lib/data-load-health";
import { qualityStats } from "@/lib/data-quality";
import {
  buildRelationshipMovement,
  type RelationshipMovementItem,
} from "@/lib/relationship-movement";
import { sampleContacts } from "@/lib/sample-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ScoreboardContactRow = {
  id: string;
  full_name: string;
  company_name: string | null;
  role_title: string[] | null;
  trust_level: string | null;
  relationship_strength: string | null;
  relationship_type: string[] | null;
  last_spoke: string | null;
  how_we_met: string | null;
  why_stay_in_touch: string | null;
  current_asks: string | null;
  wants_help_with: string | null;
  ideal_referral: string | null;
  podcast_fit: string | null;
  recent_activity: string | null;
  private_notes: string | null;
};

export type ScoreboardPromiseRow = {
  id: string;
  promise_text: string;
  direction: string;
  due_on: string | null;
  status: string;
  contacts?: {
    id: string;
    full_name: string | null;
  } | null;
};

type IntroductionRow = {
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

export type ScoreboardPendingChangeRow = {
  id: string;
  summary: string;
  risk_level: string;
  created_at: string;
  contacts?: {
    id: string;
    full_name: string | null;
  } | null;
};

export type ScoreboardRelationshipActionRow = {
  id: string;
  action_type: string;
  due_on: string | null;
  metadata: Record<string, unknown> | null;
  priority: string;
  source: string | null;
  status: string;
  title: string;
};

export type ScoreboardData = {
  setupMode: boolean;
  contactCount: number;
  warmCount: number;
  staleTrusted: ScoreboardContactRow[];
  introductions: number;
  madeIntroductions: number;
  openPromises: number;
  completedPromises: number;
  duePromises: ScoreboardPromiseRow[];
  movementQueue: RelationshipMovementItem[];
  pendingChanges: ScoreboardPendingChangeRow[];
  recentInteractions: number;
  relationshipActions: ScoreboardRelationshipActionRow[];
  quality: ReturnType<typeof qualityStats>;
  loadHealth: DataLoadHealth;
};

function daysSince(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 1000 / 60 / 60 / 24));
}

function isTrusted(contact: ScoreboardContactRow) {
  return /tier 1|tier 2|hot|warm|strong|trusted/i.test(
    [contact.trust_level, contact.relationship_strength].filter(Boolean).join(" "),
  );
}

function isWarm(contact: ScoreboardContactRow) {
  return /hot|warm|strong|tier 1|tier 2/i.test(
    [contact.relationship_strength, contact.trust_level].filter(Boolean).join(" "),
  );
}

export async function getScoreboardData(): Promise<ScoreboardData> {
  const supabase = await createSupabaseServerClient();
  const context = await getTenantContext();
  const settings = normalizeTenantSettings(context?.settings);
  if (!supabase) {
    const contacts = sampleContacts as unknown as ScoreboardContactRow[];
    return {
      setupMode: true,
      contactCount: contacts.length,
      warmCount: contacts.filter(isWarm).length,
      staleTrusted: contacts
        .filter((contact) => isTrusted(contact) && (daysSince(contact.last_spoke) ?? 0) > 45)
        .slice(0, 6),
      introductions: 0,
      madeIntroductions: 0,
      openPromises: 0,
      completedPromises: 0,
      duePromises: [],
      movementQueue: buildRelationshipMovement({
        contacts,
        promises: [],
        introductions: [],
      }),
      pendingChanges: [],
      recentInteractions: 0,
      relationshipActions: [],
      quality: qualityStats(contacts),
      loadHealth: buildDataLoadHealth("Scoreboard data", []),
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    contacts,
    introductions,
    madeIntroductions,
    openPromises,
    completedPromises,
    movementPromises,
    duePromises,
    activeIntroductions,
    pendingChanges,
    relationshipActions,
    recentInteractions,
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, full_name, company_name, role_title, trust_level, relationship_strength, relationship_type, touch_cadence, last_spoke, how_we_met, why_stay_in_touch, current_asks, wants_help_with, ideal_referral, podcast_fit, recent_activity, private_notes",
      )
      .is("archived_at", null)
      .limit(500),
    supabase.from("introductions").select("id", { count: "exact", head: true }),
    supabase
      .from("introductions")
      .select("id", { count: "exact", head: true })
      .not("date_made", "is", null),
    supabase
      .from("promises")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    supabase
      .from("promises")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed"),
    supabase
      .from("promises")
      .select("id, promise_text, direction, due_on, status, contacts(id, full_name)")
      .eq("status", "open")
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(100),
    supabase
      .from("promises")
      .select("id, promise_text, direction, due_on, status, contacts(id, full_name)")
      .eq("status", "open")
      .lte("due_on", today)
      .order("due_on", { ascending: true })
      .limit(8),
    supabase
      .from("introductions")
      .select(
        "id, person_a, person_b, date_proposed, date_made, why_context, status, follow_up_on, person_a_contact:contacts!introductions_person_a_fkey(id, full_name), person_b_contact:contacts!introductions_person_b_fkey(id, full_name)",
      )
      .not("status", "in", "(closed,stopped)")
      .order("follow_up_on", { ascending: true, nullsFirst: false })
      .limit(50),
    supabase
      .from("pending_changes")
      .select("id, summary, risk_level, created_at, contacts(id, full_name)")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("relationship_actions")
      .select("id, title, action_type, status, priority, due_on, source, metadata")
      .in("status", ["open", "deferred"])
      .order("priority", { ascending: false })
      .order("due_on", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(120),
    supabase
      .from("interactions")
      .select("id", { count: "exact", head: true })
      .gte("occurred_at", since),
  ]);

  const loadHealth = buildDataLoadHealth("Scoreboard data", [
    { key: "contacts", label: "contacts", error: contacts.error, blocksSurface: true },
    { key: "introductions", label: "introduction counts", error: introductions.error },
    {
      key: "made-introductions",
      label: "made introduction counts",
      error: madeIntroductions.error,
    },
    { key: "open-promises", label: "open promise counts", error: openPromises.error },
    {
      key: "completed-promises",
      label: "completed promise counts",
      error: completedPromises.error,
    },
    { key: "movement-promises", label: "movement promises", error: movementPromises.error },
    { key: "due-promises", label: "due promises", error: duePromises.error },
    {
      key: "active-introductions",
      label: "active introductions",
      error: activeIntroductions.error,
    },
    { key: "pending-changes", label: "pending changes", error: pendingChanges.error },
    {
      key: "relationship-actions",
      label: "relationship actions",
      error: relationshipActions.error,
    },
    {
      key: "recent-interactions",
      label: "recent interactions",
      error: recentInteractions.error,
    },
  ]);
  const contactRows = ((contacts.data ?? []) as unknown) as ScoreboardContactRow[];
  const staleTrusted = contactRows
    .filter((contact) => isTrusted(contact) && (daysSince(contact.last_spoke) ?? 9999) > 90)
    .sort((a, b) => (daysSince(b.last_spoke) ?? 9999) - (daysSince(a.last_spoke) ?? 9999))
    .slice(0, 8);

  return {
    setupMode: false,
    contactCount: contactRows.length,
    warmCount: contactRows.filter(isWarm).length,
    staleTrusted,
    introductions: introductions.count ?? 0,
    madeIntroductions: madeIntroductions.count ?? 0,
    openPromises: openPromises.count ?? 0,
    completedPromises: completedPromises.count ?? 0,
    duePromises: ((duePromises.data ?? []) as unknown) as ScoreboardPromiseRow[],
    movementQueue: buildRelationshipMovement({
      keepInTouchSettings: settings.keep_in_touch,
      timeZone: settings.activity.time_zone,
      contacts: contactRows,
      promises: ((movementPromises.data ?? []) as unknown) as ScoreboardPromiseRow[],
      introductions: ((activeIntroductions.data ?? []) as unknown) as IntroductionRow[],
    }),
    pendingChanges:
      ((pendingChanges.data ?? []) as unknown) as ScoreboardPendingChangeRow[],
    recentInteractions: recentInteractions.count ?? 0,
    relationshipActions:
      ((relationshipActions.data ?? []) as unknown) as ScoreboardRelationshipActionRow[],
    quality: qualityStats(contactRows),
    loadHealth,
  };
}
