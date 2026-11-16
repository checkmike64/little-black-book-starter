import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  activityDayWindow,
  effectiveDailyLimit,
} from "@/lib/activity-settings";
import { getTenantContext } from "@/lib/tenant-context";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { scoreNetworkingPair } from "@/lib/networking/matching";

export type NetworkingContactOption = {
  id: string;
  full_name: string;
  company_name: string | null;
};

export type NetworkingConnectionContact = NetworkingContactOption & {
  company_description: string | null;
  role_title: string[] | null;
  one_line_summary: string | null;
  trust_level: string | null;
  relationship_strength: string | null;
  relationship_type: string[] | null;
  last_spoke: string | null;
  how_we_met: string | null;
  why_stay_in_touch: string | null;
  touch_cadence: string | null;
  current_asks: string | null;
  wants_help_with: string | null;
  what_they_want_more_of: string | null;
  ideal_referral: string | null;
  services_offered: string[] | null;
  could_refer_me_for: string[] | null;
  primary_category: string[] | null;
  top_3_tags: string[] | null;
  keywords: string[] | null;
  podcast_fit: string | null;
  podcast_url: string | null;
  do_not_refer_for: string | null;
  recent_activity: string | null;
  email: string | null;
};

export type NetworkingIntroductionRow = {
  id: string;
  person_a: string | null;
  person_b: string | null;
  date_proposed: string | null;
  date_made: string | null;
  why_context: string | null;
  status: string;
  outcome: string | null;
  follow_up_on: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  draft_generated_at: string | null;
  draft_evidence: Record<string, unknown>;
  person_a_contact?: { id: string; full_name: string | null } | null;
  person_b_contact?: { id: string; full_name: string | null } | null;
};

export type IntroductionFeedbackRow = {
  id: string;
  introduction_id: string;
  contact_id: string;
  status: "scheduled" | "draft_ready" | "sent" | "responded" | "skipped";
  due_at: string;
  recipient_email: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  sent_at: string | null;
  usefulness_rating: number | null;
  fit_rating: number | null;
  response_text: string | null;
  response_reasoning: string | null;
  response_received_at: string | null;
  contacts?: { id: string; full_name: string | null } | null;
  introductions?: {
    person_a: string | null;
    person_b: string | null;
    person_a_contact?: { id: string; full_name: string | null } | null;
    person_b_contact?: { id: string; full_name: string | null } | null;
  } | null;
};

export type NetworkingRelationshipContext = {
  id: string;
  name: string;
  context_type: string;
  connection_prior: "strong" | "moderate" | "weak" | "none";
  description: string | null;
  member_ids: string[];
};

type RelationshipContextRow = Omit<NetworkingRelationshipContext, "member_ids"> & {
  confirmed_memberships?: Array<{ contact_id: string }>;
};

const networkingContactOptionSelect = "id, full_name, company_name";

const networkingConnectionContactSelect =
  "id, full_name, company_name, company_description, role_title, one_line_summary, trust_level, relationship_strength, relationship_type, touch_cadence, last_spoke, how_we_met, why_stay_in_touch, current_asks, wants_help_with, what_they_want_more_of, ideal_referral, services_offered, could_refer_me_for, primary_category, top_3_tags, keywords, podcast_fit, podcast_url, do_not_refer_for, recent_activity, email";

const recommendationContactBatchSize = 100;

function chunkContactIds(contactIds: string[]) {
  return Array.from(
    { length: Math.ceil(contactIds.length / recommendationContactBatchSize) },
    (_, index) =>
      contactIds.slice(
        index * recommendationContactBatchSize,
        (index + 1) * recommendationContactBatchSize,
      ),
  );
}

export type NetworkingConnectionRow = {
  id: string;
  contact_a: string;
  contact_b: string;
  source: string | null;
  evidence: Record<string, unknown>;
  confidence: number | null;
  status: "suggested" | "already_connected" | "dismissed";
  owner_note: string | null;
  confirmed_at: string | null;
  snoozed_until: string | null;
  created_at: string;
  shared_contexts: NetworkingRelationshipContext[];
  contact_a_record?: NetworkingConnectionContact | null;
  contact_b_record?: NetworkingConnectionContact | null;
};

export async function getNetworkingData() {
  const supabase = await createSupabaseServerClient();
  const context = await getTenantContext();
  if (!supabase || !context) {
    return {
      setupMode: true,
      loadError: false,
      contacts: [] as NetworkingContactOption[],
      introductions: [] as NetworkingIntroductionRow[],
      connections: [] as NetworkingConnectionRow[],
      relationshipContexts: [] as NetworkingRelationshipContext[],
      connectionCount: 0,
      reserveCount: 0,
      resolvedToday: 0,
      dailyLimit: 0,
      moreBatch: 0,
      feedbackRequests: [] as IntroductionFeedbackRow[],
      inboxConnected: false,
      asOf: null as string | null,
    };
  }

  const settings = normalizeTenantSettings(context.settings);
  const now = new Date().toISOString();
  const activityDay = activityDayWindow(settings.activity.time_zone);
  const today = activityDay.date;
  const dayStart = activityDay.startIso;
  const [
    contacts,
    introductions,
    connections,
    overrides,
    resolvedTodayResult,
    relationshipContextsResult,
    feedbackResult,
    inboxResult,
  ] =
    await Promise.all([
      // These rows are serialized into manual-introduction and group-editing
      // controls. Keep the option payload to the only fields those controls use;
      // recommendation scoring loads its exact full profiles below.
      supabase
        .from("contacts")
        .select(networkingContactOptionSelect)
        .eq("tenant_id", context.tenantId)
        .is("archived_at", null)
        .order("full_name")
        .limit(1000),
      supabase
        .from("introductions")
        .select(
          "id, person_a, person_b, date_proposed, date_made, why_context, status, outcome, follow_up_on, draft_subject, draft_body, draft_generated_at, draft_evidence, person_a_contact:contacts!introductions_person_a_fkey(id, full_name), person_b_contact:contacts!introductions_person_b_fkey(id, full_name)",
        )
        .eq("tenant_id", context.tenantId)
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("connections")
        .select(
          "id, contact_a, contact_b, source, evidence, confidence, status, owner_note, confirmed_at, snoozed_until, created_at",
          { count: "exact" },
        )
        .eq("tenant_id", context.tenantId)
        .eq("status", "suggested")
        .or(`snoozed_until.is.null,snoozed_until.lte.${now}`)
        .order("created_at", { ascending: false })
        .limit(250),
      supabase
        .from("recommendation_day_overrides")
        .select("networking_extra")
        .eq("tenant_id", context.tenantId)
        .eq("user_id", context.userId)
        .eq("activity_date", today)
        .maybeSingle(),
      supabase
        .from("connections")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId)
        .or(
          `snoozed_at.gte.${dayStart},and(status.neq.suggested,updated_at.gte.${dayStart})`,
        ),
      supabase
        .from("relationship_contexts")
        // The parent tenant filter plus the composite context-membership foreign
        // key keeps the embed tenant-bound. Inferred memberships never affected
        // shared-context suppression or owner group editing, so exclude them at
        // the database boundary and return only the contact IDs those flows use.
        .select(
          "id, name, context_type, connection_prior, description, confirmed_memberships:relationship_context_memberships(contact_id)",
        )
        .eq("tenant_id", context.tenantId)
        .is("archived_at", null)
        .eq("confirmed_memberships.verification_state", "confirmed")
        .order("name")
        .limit(250),
      supabase
        .from("introduction_feedback_requests")
        .select(
          "id, introduction_id, contact_id, status, due_at, recipient_email, draft_subject, draft_body, sent_at, usefulness_rating, fit_rating, response_text, response_reasoning, response_received_at, contacts(id, full_name), introductions(person_a, person_b, person_a_contact:contacts!introductions_person_a_fkey(id, full_name), person_b_contact:contacts!introductions_person_b_fkey(id, full_name))",
        )
        .eq("tenant_id", context.tenantId)
        .in("status", ["scheduled", "draft_ready", "sent"])
        .order("due_at", { ascending: true })
        .limit(30),
      supabase
        .from("integration_connections")
        .select("id")
        .eq("tenant_id", context.tenantId)
        .eq("user_id", context.userId)
        .eq("provider", "google_gmail")
        .eq("status", "active")
        .maybeSingle(),
    ]);

  if (
    contacts.error ||
    introductions.error ||
    connections.error ||
    overrides.error ||
    resolvedTodayResult.error ||
    relationshipContextsResult.error
    || feedbackResult.error
    || inboxResult.error
  ) {
    return {
      setupMode: false,
      loadError: true,
      contacts: [] as NetworkingContactOption[],
      introductions: [] as NetworkingIntroductionRow[],
      connections: [] as NetworkingConnectionRow[],
      relationshipContexts: [] as NetworkingRelationshipContext[],
      connectionCount: 0,
      reserveCount: 0,
      resolvedToday: 0,
      dailyLimit: settings.activity.networking_daily_limit,
      moreBatch: settings.activity.networking_more_batch,
      feedbackRequests: [] as IntroductionFeedbackRow[],
      inboxConnected: false,
      asOf: null as string | null,
    };
  }

  const contactOptions = (contacts.data ?? []) as NetworkingContactOption[];
  const recommendationContactIds = [
    ...new Set(
      (((connections.data ?? []) as unknown) as NetworkingConnectionRow[])
        .flatMap((connection) => [connection.contact_a, connection.contact_b]),
    ),
  ];
  // Always reload every recommendation participant with the complete matching
  // profile. Bound each ID list so a full 250-pair reservoir cannot create an
  // oversized PostgREST URL.
  const recommendationContactResults = await Promise.all(
    chunkContactIds(recommendationContactIds).map((contactIdBatch) =>
      supabase
        .from("contacts")
        .select(networkingConnectionContactSelect)
        .eq("tenant_id", context.tenantId)
        .is("archived_at", null)
        .in("id", contactIdBatch)
        .limit(recommendationContactBatchSize),
    ),
  );

  if (recommendationContactResults.some((result) => result.error)) {
    return {
      setupMode: false,
      loadError: true,
      contacts: [] as NetworkingContactOption[],
      introductions: [] as NetworkingIntroductionRow[],
      connections: [] as NetworkingConnectionRow[],
      relationshipContexts: [] as NetworkingRelationshipContext[],
      connectionCount: 0,
      reserveCount: 0,
      resolvedToday: 0,
      dailyLimit: settings.activity.networking_daily_limit,
      moreBatch: settings.activity.networking_more_batch,
      feedbackRequests: [] as IntroductionFeedbackRow[],
      inboxConnected: false,
      asOf: null as string | null,
    };
  }

  const contactsById = new Map(
    recommendationContactResults
      .flatMap((result) => (result.data ?? []) as NetworkingConnectionContact[])
      .map((contact) => [contact.id, contact]),
  );
  const contextRows = (relationshipContextsResult.data ?? []) as RelationshipContextRow[];
  const confirmedContextIdsByContact = new Map<string, Set<string>>();
  const relationshipContexts = contextRows.map((relationshipContext) => {
    const { confirmed_memberships: memberships = [], ...contextFields } =
      relationshipContext;
    const memberIds = memberships.map((membership) => membership.contact_id);
    for (const contactId of memberIds) {
      const contactContexts = confirmedContextIdsByContact.get(contactId) ?? new Set();
      contactContexts.add(relationshipContext.id);
      confirmedContextIdsByContact.set(contactId, contactContexts);
    }
    return {
      ...contextFields,
      member_ids: memberIds,
    };
  });
  const contextsById = new Map(
    relationshipContexts.map((relationshipContext) => [
      relationshipContext.id,
      relationshipContext,
    ]),
  );

  function sharedContexts(contactA: string, contactB: string) {
    const aContexts = confirmedContextIdsByContact.get(contactA) ?? new Set<string>();
    const bContexts = confirmedContextIdsByContact.get(contactB) ?? new Set<string>();
    return [...aContexts]
      .filter((contextId) => bContexts.has(contextId))
      .map((contextId) => contextsById.get(contextId))
      .filter(
        (relationshipContext): relationshipContext is NetworkingRelationshipContext =>
          Boolean(relationshipContext),
      )
      .sort((a, b) => {
        const rank = { strong: 3, moderate: 2, weak: 1, none: 0 };
        return rank[b.connection_prior] - rank[a.connection_prior] ||
          a.name.localeCompare(b.name);
      });
  }

  const scoreContact = (contact: NetworkingConnectionContact | null | undefined) => {
    const trust = contact?.trust_level ?? "";
    const strength = contact?.relationship_strength ?? "";
    const relationship = contact?.relationship_type?.join(" ") ?? "";
    if (/do not refer/i.test(trust)) return -120;
    return (
      (/tier 1|deep trust/i.test(trust)
        ? 30
        : /tier 2|working trust/i.test(trust)
          ? 18
          : 8) +
      (/hot/i.test(strength)
        ? 14
        : /warm/i.test(strength)
          ? 10
          : /cooling|cold/i.test(strength)
            ? 4
            : 6) +
      (/referral|partner|connector/i.test(relationship) ? 8 : 0)
    );
  };
  const normalizedSignals = (contact: NetworkingConnectionContact | null | undefined) =>
    new Set(
      [
        ...(contact?.primary_category ?? []),
        ...(contact?.top_3_tags ?? []),
        ...(contact?.keywords ?? []),
        ...(contact?.services_offered ?? []),
        ...(contact?.could_refer_me_for ?? []),
      ]
        .map((value) => value.toLowerCase().trim())
        .filter((value) => value.length >= 3),
    );
  const networkFitScore = (connection: NetworkingConnectionRow) => {
    const aSignals = normalizedSignals(connection.contact_a_record);
    const bSignals = normalizedSignals(connection.contact_b_record);
    const shared = [...aSignals].filter((signal) => bSignals.has(signal)).length;
    return Math.min(shared * 3, 12);
  };
  const recommendationScore = (connection: NetworkingConnectionRow) => {
    const evidenceScore =
      typeof connection.evidence.score === "number"
        ? connection.evidence.score
        : 0;
    if (
      connection.source === "network_intelligence_v2" ||
      connection.source === "network_intelligence_v1" ||
      connection.source === "claude_intelligence_v1"
    ) {
      return evidenceScore * 3 + (connection.confidence ?? 0) * 30;
    }
    return evidenceScore + (connection.confidence ?? 0) * 10;
  };
  const rankedConnections =
    (((connections.data ?? []) as unknown) as NetworkingConnectionRow[])
      .filter(
        (connection) =>
          !(
            connection.source === "source_project_duplicate" &&
            "test_duplicate_source_project" in connection.evidence
          ),
      )
      // Load any recommendation person beyond the option-list cap explicitly.
      // Missing records are archived or invalid and must not be recommended.
      .filter(
        (connection) =>
          contactsById.has(connection.contact_a) &&
          contactsById.has(connection.contact_b),
      )
      .map((connection) => ({
        ...connection,
        contact_a_record: contactsById.get(connection.contact_a),
        contact_b_record: contactsById.get(connection.contact_b),
        shared_contexts: sharedContexts(connection.contact_a, connection.contact_b),
      }))
      .map((connection): NetworkingConnectionRow | null => {
        if (
          connection.source !== "network_fit_v2" ||
          connection.evidence.match_type !== "podcast"
        ) {
          return connection;
        }
        const contactA = contactsById.get(connection.contact_a);
        const contactB = contactsById.get(connection.contact_b);
        if (!contactA || !contactB) return null;
        const currentMatch = scoreNetworkingPair(contactA, contactB, {
          relationshipRules: settings.onboarding.relationship_rules,
        });
        if (currentMatch?.evidence.match_type !== "podcast") return null;
        return {
          ...connection,
          confidence: currentMatch.confidence,
          evidence: {
            ...connection.evidence,
            summary: currentMatch.evidence.summary,
            direction: currentMatch.direction,
            matched_terms: currentMatch.matchedTerms,
            confidence_basis: currentMatch.evidence.confidence_basis,
            policy_checks: currentMatch.evidence.policy_checks,
            score: currentMatch.score,
            revalidated_with: "podcast_topic_fit_v1",
          },
        };
      })
      .filter(
        (connection): connection is NetworkingConnectionRow => Boolean(connection),
      )
      .filter(
        (connection) =>
          !connection.shared_contexts.some((relationshipContext) =>
            ["strong", "moderate"].includes(relationshipContext.connection_prior),
          ),
      )
      .sort((a, b) => {
        const contextScore = (connection: NetworkingConnectionRow) =>
          connection.shared_contexts.length > 0 ? -8 : 0;
        const scoreA =
          recommendationScore(a) +
          contextScore(a) +
          networkFitScore(a) +
          scoreContact(a.contact_a_record) +
          scoreContact(a.contact_b_record) +
          (a.confidence ?? 0) * 4;
        const scoreB =
          recommendationScore(b) +
          contextScore(b) +
          networkFitScore(b) +
          scoreContact(b.contact_a_record) +
          scoreContact(b.contact_b_record) +
          (b.confidence ?? 0) * 4;
        return scoreB - scoreA || b.created_at.localeCompare(a.created_at);
      });
  const resolvedToday = resolvedTodayResult.count ?? 0;
  const extra =
    (overrides.data as { networking_extra?: number } | null)
      ?.networking_extra ?? 0;
  const dailyLimit = settings.activity.networking_daily_limit + extra;
  const remaining = effectiveDailyLimit({
    base: settings.activity.networking_daily_limit,
    extra,
    resolved: resolvedToday,
  });
  const dailyConnections: NetworkingConnectionRow[] = [];
  const selectedContacts = new Set<string>();
  const selectedConnectionIds = new Set<string>();
  const matchTypes = [
    ...new Set(
      rankedConnections.map((connection) =>
        typeof connection.evidence.match_type === "string"
          ? connection.evidence.match_type
          : "other",
      ),
    ),
  ];
  for (const matchType of matchTypes) {
    if (dailyConnections.length >= remaining) break;
    const connection = rankedConnections.find(
      (candidate) =>
        !selectedConnectionIds.has(candidate.id) &&
        (typeof candidate.evidence.match_type === "string"
          ? candidate.evidence.match_type
          : "other") === matchType &&
        !selectedContacts.has(candidate.contact_a) &&
        !selectedContacts.has(candidate.contact_b),
    );
    if (!connection) continue;
    dailyConnections.push(connection);
    selectedConnectionIds.add(connection.id);
    selectedContacts.add(connection.contact_a);
    selectedContacts.add(connection.contact_b);
  }
  for (const connection of rankedConnections) {
    if (dailyConnections.length >= remaining) break;
    if (selectedConnectionIds.has(connection.id)) continue;
    if (
      selectedContacts.has(connection.contact_a) ||
      selectedContacts.has(connection.contact_b)
    ) {
      continue;
    }
    dailyConnections.push(connection);
    selectedConnectionIds.add(connection.id);
    selectedContacts.add(connection.contact_a);
    selectedContacts.add(connection.contact_b);
  }
  for (const connection of rankedConnections) {
    if (dailyConnections.length >= remaining) break;
    if (selectedConnectionIds.has(connection.id)) continue;
    dailyConnections.push(connection);
    selectedConnectionIds.add(connection.id);
  }

  return {
    setupMode: false,
    loadError: false,
    contacts: contactOptions,
    introductions:
      ((introductions.data ?? []) as unknown) as NetworkingIntroductionRow[],
    connections: dailyConnections,
    relationshipContexts,
    connectionCount: dailyConnections.length,
    reserveCount: Math.max(0, rankedConnections.length - dailyConnections.length),
    resolvedToday,
    dailyLimit,
    moreBatch: settings.activity.networking_more_batch,
    feedbackRequests: ((feedbackResult.data ?? []) as unknown) as IntroductionFeedbackRow[],
    inboxConnected: Boolean(inboxResult.data),
    asOf: now as string | null,
  };
}
