import {
  activityDayWindow,
  effectiveDailyLimit,
} from "@/lib/activity-settings";
import {
  engagementCadenceAllows,
  type EngagementPacingIdentity,
} from "@/lib/engagement/pacing";
import {
  resolveEngagementLane,
  type EngagementLane,
} from "@/lib/engagement/lane";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant-context";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { engageableSocialPostPlatform } from "@/lib/engagement-source";
import {
  engagementRelationshipFit,
  wantToKnowEngagementFit,
} from "@/lib/engagement/relevance";

export type { EngagementLane } from "@/lib/engagement/lane";

export type EngagementSignalRow = {
  id: string;
  contact_id: string | null;
  want_to_know_id: string | null;
  signal_type: string;
  classification: string | null;
  content_classification: string | null;
  engagement_lane: EngagementLane | null;
  summary: string;
  why_now: string | null;
  recommended_action: string | null;
  priority_score: number;
  source: string | null;
  source_url: string;
  published_at: string;
  observed_at: string;
  expires_at: string | null;
  opened_at: string | null;
  payload: Record<string, unknown> | null;
  contacts?: {
    id: string;
    full_name: string | null;
    company_name: string | null;
    role_title: string[] | null;
    relationship_type: string[] | null;
    trust_level: string | null;
    relationship_strength: string | null;
    touch_cadence: string | null;
    last_spoke: string | null;
    engagement_target_per_month: number | null;
    why_stay_in_touch: string | null;
    current_asks: string | null;
    wants_help_with: string | null;
    what_they_want_more_of: string | null;
    ideal_referral: string | null;
    services_offered: string[] | null;
    could_refer_me_for: string[] | null;
    top_3_tags: string[] | null;
    keywords: string[] | null;
  } | null;
  want_to_know?: {
    id: string;
    full_name: string;
    company: string | null;
    lane: string | null;
    bucket: string | null;
    stage: string;
    engagement_target_per_month: number | null;
    engagement_focus: string | null;
    relationship_priority: "high" | "standard" | "watch";
    why: string | null;
    dossier: Record<string, unknown> | null;
    owner_selected_at: string | null;
  } | null;
};

type EngagedHistoryRow = {
  contact_id: string | null;
  want_to_know_id: string | null;
  engaged_at: string;
};

type DailyOverrideRow = {
  engagement_extra: number;
};

export type EngagementData = {
  setupMode: boolean;
  loadError: boolean;
  signals: EngagementSignalRow[];
  networkSignals: EngagementSignalRow[];
  wantToKnowSignals: EngagementSignalRow[];
  pendingCount: number;
  reserveCount: number;
  resolvedToday: number;
  dailyLimit: number;
  wantToKnowDailyLimit: number;
  moreBatch: number;
  progressCompleted: number;
  progressGoal: number;
  networkResolvedToday: number;
  wantToKnowResolvedToday: number;
};

function entityKey(row: {
  contact_id: string | null;
  want_to_know_id: string | null;
}) {
  if (row.contact_id) return `contact:${row.contact_id}`;
  if (row.want_to_know_id) return `want:${row.want_to_know_id}`;
  return null;
}

export function engagementLaneForSignal(
  signal: EngagementSignalRow,
): EngagementLane {
  return resolveEngagementLane({
    requestedLane: signal.engagement_lane,
    classification: signal.classification,
    isWantToKnow: Boolean(signal.want_to_know_id),
    contact: signal.contacts,
  });
}

function pacingIdentity(
  signal: EngagementSignalRow,
  wantToKnowDefault: number,
): EngagementPacingIdentity {
  if (signal.want_to_know) {
    return {
      engagement_target_per_month:
        signal.want_to_know.engagement_target_per_month,
      is_want_to_know: true,
      default_target_per_month: wantToKnowDefault,
    };
  }

  return {
    engagement_target_per_month:
      signal.contacts?.engagement_target_per_month,
    relationship_type: signal.contacts?.relationship_type,
    touch_cadence: signal.contacts?.touch_cadence,
    trust_level: signal.contacts?.trust_level,
  };
}

export function selectDailyEngagementSignals(
  signals: EngagementSignalRow[],
  limit: number,
) {
  if (limit <= 0) return [];

  const lanes: EngagementLane[] = ["active", "partners", "rescue"];
  const selected: EngagementSignalRow[] = [];
  const selectedIds = new Set<string>();

  if (limit >= lanes.length) {
    for (const lane of lanes) {
      const first = signals.find(
        (signal) => signal.engagement_lane === lane,
      );
      if (first) {
        selected.push(first);
        selectedIds.add(first.id);
      }
    }
  }

  for (const signal of signals) {
    if (selected.length >= limit) break;
    if (!selectedIds.has(signal.id)) {
      selected.push(signal);
      selectedIds.add(signal.id);
    }
  }

  return selected;
}

export async function getEngagementData(): Promise<EngagementData> {
  const supabase = await createSupabaseServerClient();
  const context = await getTenantContext();
  if (!supabase || !context) {
    return {
      setupMode: true,
      loadError: false,
      signals: [],
      networkSignals: [],
      wantToKnowSignals: [],
      pendingCount: 0,
      reserveCount: 0,
      resolvedToday: 0,
      dailyLimit: 0,
      wantToKnowDailyLimit: 0,
      moreBatch: 0,
      progressCompleted: 0,
      progressGoal: 0,
      networkResolvedToday: 0,
      wantToKnowResolvedToday: 0,
    };
  }

  const settings = normalizeTenantSettings(context.settings);
  const now = new Date().toISOString();
  const activityDay = activityDayWindow(settings.activity.time_zone);
  const today = activityDay.date;
  const dayStart = activityDay.startIso;

  const [pending, history, overrides, resolvedTodayRows] =
    await Promise.all([
      supabase
        .from("signals")
        .select(
          "id, contact_id, want_to_know_id, signal_type, classification, content_classification, engagement_lane, summary, why_now, recommended_action, priority_score, source, source_url, published_at, observed_at, expires_at, opened_at, payload, contacts(id, full_name, company_name, role_title, relationship_type, trust_level, relationship_strength, touch_cadence, last_spoke, engagement_target_per_month, why_stay_in_touch, current_asks, wants_help_with, what_they_want_more_of, ideal_referral, services_offered, could_refer_me_for, top_3_tags, keywords), want_to_know(id, full_name, company, lane, bucket, stage, engagement_target_per_month, engagement_focus, relationship_priority, why, dossier, owner_selected_at)",
        )
        .not("source_url", "is", null)
        .eq("tenant_id", context.tenantId)
        .is("dismissed_at", null)
        .is("engaged_at", null)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order("priority_score", { ascending: false })
        .order("published_at", { ascending: false })
        .limit(250),
      supabase
        .from("signals")
        .select("contact_id, want_to_know_id, engaged_at")
        .eq("tenant_id", context.tenantId)
        .not("engaged_at", "is", null)
        .order("engaged_at", { ascending: false })
        .limit(500),
      supabase
        .from("recommendation_day_overrides")
        .select("engagement_extra")
        .eq("tenant_id", context.tenantId)
        .eq("user_id", context.userId)
        .eq("activity_date", today)
        .maybeSingle(),
      supabase
        .from("signals")
        .select("contact_id,want_to_know_id")
        .eq("tenant_id", context.tenantId)
        .or(
          `and(engaged_by.eq.${context.userId},engaged_at.gte.${dayStart}),and(dismissed_by.eq.${context.userId},dismissed_at.gte.${dayStart})`,
        ),
    ]);

  if (
    pending.error ||
    history.error ||
    overrides.error ||
    resolvedTodayRows.error
  ) {
    return {
      setupMode: false,
      loadError: true,
      signals: [],
      networkSignals: [],
      wantToKnowSignals: [],
      pendingCount: 0,
      reserveCount: 0,
      resolvedToday: 0,
      dailyLimit: settings.activity.engagement_daily_limit,
      wantToKnowDailyLimit: settings.activity.want_to_know_daily_limit,
      moreBatch: settings.activity.engagement_more_batch,
      progressCompleted: 0,
      progressGoal:
        settings.activity.engagement_daily_limit +
        settings.activity.want_to_know_daily_limit,
      networkResolvedToday: 0,
      wantToKnowResolvedToday: 0,
    };
  }

  const historyRows =
    ((history.data ?? []) as unknown as EngagedHistoryRow[]);
  const extra =
    ((overrides.data ?? null) as DailyOverrideRow | null)?.engagement_extra ??
    0;
  const lastEngagedByEntity = new Map<string, string>();
  for (const row of historyRows) {
    const key = entityKey(row);
    if (key && !lastEngagedByEntity.has(key)) {
      lastEngagedByEntity.set(key, row.engaged_at);
    }
  }

  const seenEntities = new Set<string>();
  const eligible = ((pending.data ?? []) as unknown as EngagementSignalRow[])
    .filter((signal) => {
      if (/noise/i.test(signal.content_classification ?? "")) return false;
      if (!engageableSocialPostPlatform(signal.source_url)) return false;
      const key = entityKey(signal);
      if (!key) return false;
      if (!signal.contacts && !signal.want_to_know) return false;
      if (signal.want_to_know && !signal.want_to_know.owner_selected_at) return false;
      if (seenEntities.has(key)) return false;
      const fit = signal.want_to_know
        ? wantToKnowEngagementFit({
            content: signal.summary,
            relevance: signal.why_now,
            classification: signal.content_classification,
            context: signal.want_to_know,
          })
        : engagementRelationshipFit({
            content: signal.summary,
            relevance: signal.why_now,
            classification: signal.content_classification,
            context: signal.contacts,
          });
      if (!fit.eligible) return false;
      if (
        signal.payload?.owner_requested_batch !== true &&
        !engagementCadenceAllows({
          identity: pacingIdentity(
            signal,
            settings.activity.want_to_know_engagements_monthly,
          ),
          lastEngagedAt: lastEngagedByEntity.get(key) ?? null,
        })
      ) {
        return false;
      }
      seenEntities.add(key);
      return true;
    })
    .map((signal) => ({
      ...signal,
      engagement_lane: engagementLaneForSignal(signal),
    }));

  const resolvedRows = resolvedTodayRows.data ?? [];
  const networkResolvedToday = resolvedRows.filter((row) => row.contact_id).length;
  const wantToKnowResolvedToday = resolvedRows.filter((row) => row.want_to_know_id).length;
  const resolvedToday = networkResolvedToday + wantToKnowResolvedToday;
  const dailyLimit = settings.activity.engagement_daily_limit + extra;
  const networkRemaining = effectiveDailyLimit({
    base: settings.activity.engagement_daily_limit,
    extra,
    resolved: networkResolvedToday,
  });
  const wantToKnowRemaining = effectiveDailyLimit({
    base: settings.activity.want_to_know_daily_limit,
    extra: 0,
    resolved: wantToKnowResolvedToday,
  });
  const networkEligible = eligible.filter((signal) => Boolean(signal.contact_id));
  const wantToKnowEligible = eligible.filter((signal) => Boolean(signal.want_to_know_id));
  const networkSignals = selectDailyEngagementSignals(networkEligible, networkRemaining);
  const wantToKnowSignals = wantToKnowEligible.slice(0, wantToKnowRemaining);
  const signals = [...networkSignals, ...wantToKnowSignals];
  const activeRequestedBatch = signals.some(
    (signal) => signal.payload?.owner_requested_batch === true,
  );
  const progressGoal = activeRequestedBatch
    ? settings.activity.engagement_more_batch
    : dailyLimit + settings.activity.want_to_know_daily_limit;
  const progressCompleted = activeRequestedBatch
    ? Math.max(
        0,
        resolvedToday - Math.max(0, dailyLimit - settings.activity.engagement_more_batch),
      )
    : resolvedToday;

  return {
    setupMode: false,
    loadError: false,
    signals,
    networkSignals,
    wantToKnowSignals,
    pendingCount: signals.length,
    reserveCount:
      Math.max(0, networkEligible.length - networkSignals.length) +
      Math.max(0, wantToKnowEligible.length - wantToKnowSignals.length),
    resolvedToday,
    dailyLimit,
    wantToKnowDailyLimit: settings.activity.want_to_know_daily_limit,
    moreBatch: settings.activity.engagement_more_batch,
    progressCompleted,
    progressGoal,
    networkResolvedToday,
    wantToKnowResolvedToday,
  };
}
