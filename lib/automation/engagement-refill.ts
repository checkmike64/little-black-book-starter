import type { AdminClient } from "@/lib/server-action-context";
import { engagementCadenceAllows } from "@/lib/engagement/pacing";
import {
  engagementRelationshipFit,
  fallbackRelationshipRationale,
  wantToKnowEngagementFit,
} from "@/lib/engagement/relevance";
import {
  engageableSocialPostPlatform,
  normalizeExternalContentUrl,
} from "@/lib/engagement-source";
import { resolveEngagementLane } from "@/lib/engagement/lane";
import {
  llmAutomationConfigured,
  rankEngagementCandidates,
  type EngagementRecommendationDraft,
} from "@/lib/automation/llm";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { createAiGenerationLedger } from "@/lib/ai/ledger";

type ContentCandidate = {
  id: string;
  contact_id: string | null;
  want_to_know_id: string | null;
  target_name: string | null;
  platform: string | null;
  provider: string | null;
  match_method: string | null;
  source_url: string;
  content: string | null;
  classification: string | null;
  relevance: string | null;
  published_at: string;
  metrics: Record<string, unknown> | null;
  contacts?: {
    id: string;
    full_name: string | null;
    relationship_type: string[] | null;
    trust_level: string | null;
    relationship_strength: string | null;
    touch_cadence: string | null;
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
    engagement_target_per_month: number | null;
    bucket: string | null;
    lane: string | null;
    why: string | null;
    engagement_focus: string | null;
    relationship_priority: "high" | "standard" | "watch";
    dossier: Record<string, unknown> | null;
    owner_selected_at: string | null;
  } | null;
};

type EngagedHistory = {
  contact_id: string | null;
  want_to_know_id: string | null;
  engaged_at: string;
};

type PendingSignal = {
  id: string;
  contact_id: string | null;
  want_to_know_id: string | null;
  source_url: string | null;
  content_classification: string | null;
  summary: string;
  why_now: string | null;
  payload: Record<string, unknown> | null;
  contacts?: ContentCandidate["contacts"];
  want_to_know?: ContentCandidate["want_to_know"];
};

function entityKey(row: {
  contact_id: string | null;
  want_to_know_id: string | null;
}) {
  return row.contact_id
    ? `contact:${row.contact_id}`
    : row.want_to_know_id
      ? `want:${row.want_to_know_id}`
      : null;
}

function metric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function concise(value: string | null, fallback: string, max = 300) {
  const text = (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[—–-]\s*/, "")
    .trim();
  if (!text) return fallback;
  if (text.length <= max) return text;
  const clipped = text.slice(0, max + 1);
  const space = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, space > max * 0.7 ? space : max).trim()}…`;
}

function candidateFit(candidate: ContentCandidate | PendingSignal) {
  return candidate.want_to_know
    ? wantToKnowEngagementFit({
        content: "content" in candidate ? candidate.content : candidate.summary,
        relevance: "relevance" in candidate ? candidate.relevance : candidate.why_now,
        classification:
          "classification" in candidate
            ? candidate.classification
            : candidate.content_classification,
        metrics: "metrics" in candidate ? candidate.metrics : null,
        context: candidate.want_to_know,
      })
    : engagementRelationshipFit({
        content: "content" in candidate ? candidate.content : candidate.summary,
        relevance: "relevance" in candidate ? candidate.relevance : candidate.why_now,
        classification:
          "classification" in candidate
            ? candidate.classification
            : candidate.content_classification,
        metrics: "metrics" in candidate ? candidate.metrics : null,
        context: candidate.contacts,
      });
}

function candidateScore(candidate: ContentCandidate) {
  const ageDays = Math.max(
    0,
    (Date.now() - Date.parse(candidate.published_at)) / 86_400_000,
  );
  const likes = metric(candidate.metrics?.likes);
  const comments = metric(candidate.metrics?.comments);
  const fit = candidateFit(candidate);
  const relationshipPriority = candidate.want_to_know?.relationship_priority;
  return Math.round(
    Math.max(
      0,
      Math.min(
        100,
        58 - ageDays * 2 + Math.log10(likes + 1) * 5 +
          Math.log10(comments + 1) * 8 + fit.score +
          (relationshipPriority === "high" ? 14 : relationshipPriority === "watch" ? -10 : 0),
      ),
    ),
  );
}

function fallbackDraft(candidate: ContentCandidate): EngagementRecommendationDraft {
  const name =
    candidate.contacts?.full_name ??
    candidate.want_to_know?.full_name ??
    candidate.target_name ??
    "this person";
  const fit = candidateFit(candidate);
  const categoryReason =
    "categoryReason" in fit && typeof fit.categoryReason === "string"
      ? fit.categoryReason
      : null;
  return {
    id: candidate.id,
    summary: concise(
      candidate.content,
      `A recent ${candidate.platform ?? "social"} update from ${name}.`,
    ),
    why_now: concise(
      categoryReason ?? fallbackRelationshipRationale({
        content: candidate.content,
        relevance: candidate.relevance,
        classification: candidate.classification,
        metrics: candidate.metrics,
        context: candidate.contacts,
      }),
      `This is a recent social post from ${name}, whose profile is on your saved engagement list.`,
      260,
    ),
    recommended_action: fit.helpOpportunity
      ? "support"
      : fit.meaningfulMoment || fit.coachingOpportunity
        ? "comment"
        : metric(candidate.metrics?.comments) > 5
          ? "comment"
          : "like",
    priority_score: candidateScore(candidate),
  };
}

export async function refillEngagementRecommendations({
  admin,
  tenantId,
  settings: rawSettings,
  useLlm = true,
  targetPending,
  ignoreCadence = false,
}: {
  admin: AdminClient;
  tenantId: string;
  settings: unknown;
  useLlm?: boolean;
  targetPending?: number;
  ignoreCadence?: boolean;
}) {
  const settings = normalizeTenantSettings(rawSettings);
  const floor = targetPending ?? (
    Math.min(
      settings.activity.engagement_daily_floor,
      settings.activity.engagement_daily_limit,
    ) + settings.activity.want_to_know_daily_limit
  );
  if (floor <= 0) return { promoted: 0, pending: 0, needed: 0 };

  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [pending, candidates, history, existingUrls] = await Promise.all([
    admin
      .from("signals")
      .select(
        "id, contact_id, want_to_know_id, source_url, content_classification, summary, why_now, payload, contacts(id, full_name, relationship_type, trust_level, relationship_strength, touch_cadence, engagement_target_per_month, why_stay_in_touch, current_asks, wants_help_with, what_they_want_more_of, ideal_referral, services_offered, could_refer_me_for, top_3_tags, keywords), want_to_know(id, full_name, engagement_target_per_month, bucket, lane, why, engagement_focus, relationship_priority, dossier, owner_selected_at)",
      )
      .eq("tenant_id", tenantId)
      .is("dismissed_at", null)
      .is("engaged_at", null)
      .or(`expires_at.is.null,expires_at.gt.${now}`),
    admin
      .from("content_items")
      .select(
        "id, contact_id, want_to_know_id, target_name, platform, provider, match_method, source_url, content, classification, relevance, published_at, metrics, contacts:contacts!content_items_tenant_contact_fkey(id, full_name, relationship_type, trust_level, relationship_strength, touch_cadence, engagement_target_per_month, why_stay_in_touch, current_asks, wants_help_with, what_they_want_more_of, ideal_referral, services_offered, could_refer_me_for, top_3_tags, keywords), want_to_know:want_to_know!content_items_tenant_want_fkey(id, full_name, engagement_target_per_month, bucket, lane, why, engagement_focus, relationship_priority, dossier, owner_selected_at)",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "available")
      .eq("match_status", "matched")
      .gte("published_at", cutoff)
      .lte("published_at", now)
      .order("published_at", { ascending: false })
      .limit(200),
    admin
      .from("signals")
      .select("contact_id, want_to_know_id, engaged_at")
      .eq("tenant_id", tenantId)
      .not("engaged_at", "is", null)
      .order("engaged_at", { ascending: false })
      .limit(500),
    admin
      .from("signals")
      .select("source_url")
      .eq("tenant_id", tenantId)
      .not("source_url", "is", null)
      .limit(1000),
  ]);

  if (pending.error || candidates.error || history.error || existingUrls.error) {
    throw new Error("The engagement reservoir could not be reviewed.");
  }

  const lastEngaged = new Map<string, string>();
  for (const row of (history.data ?? []) as EngagedHistory[]) {
    const key = entityKey(row);
    if (key && !lastEngaged.has(key)) lastEngaged.set(key, row.engaged_at);
  }
  const visiblePendingEntities = new Set<string>();
  const onDemandPending: PendingSignal[] = [];
  for (const signal of (pending.data ?? []) as unknown as PendingSignal[]) {
    const key = entityKey(signal);
    if (
      !key ||
      visiblePendingEntities.has(key) ||
      !(
        signal.source_url &&
        engageableSocialPostPlatform(signal.source_url)
      ) ||
      /noise/i.test(signal.content_classification ?? "")
    ) {
      continue;
    }
    if (signal.want_to_know && !signal.want_to_know.owner_selected_at) continue;
    const fit = candidateFit(signal);
    if (!fit.eligible) continue;
    const identity = signal.want_to_know
      ? {
          engagement_target_per_month:
            signal.want_to_know.engagement_target_per_month,
          is_want_to_know: true,
          default_target_per_month:
            settings.activity.want_to_know_engagements_monthly,
        }
      : {
          engagement_target_per_month:
            signal.contacts?.engagement_target_per_month,
          relationship_type: signal.contacts?.relationship_type,
          touch_cadence: signal.contacts?.touch_cadence,
          trust_level: signal.contacts?.trust_level,
        };
    if (
      ignoreCadence ||
      engagementCadenceAllows({
        identity,
        lastEngagedAt: lastEngaged.get(key) ?? null,
      })
    ) {
      visiblePendingEntities.add(key);
      if (ignoreCadence) onDemandPending.push(signal);
    }
  }
  if (ignoreCadence) {
    const requestedAt = new Date().toISOString();
    for (const signal of onDemandPending.slice(0, floor)) {
      await admin
        .from("signals")
        .update({
          payload: {
            ...(signal.payload ?? {}),
            owner_requested_batch: true,
            owner_requested_at: requestedAt,
          },
        })
        .eq("tenant_id", tenantId)
        .eq("id", signal.id);
    }
  }
  const pendingCount = visiblePendingEntities.size;
  const needed = Math.max(0, floor - pendingCount);
  if (needed === 0) return { promoted: 0, pending: pendingCount, needed: 0 };

  const existing = new Set(
    (existingUrls.data ?? [])
      .map((row) => normalizeExternalContentUrl(row.source_url))
      .filter((value): value is string => Boolean(value)),
  );
  const seenEntities = new Set<string>();
  const eligible = ((candidates.data ?? []) as unknown as ContentCandidate[])
    .filter((candidate) => {
      if (/noise/i.test(candidate.classification ?? "")) return false;
      const url = normalizeExternalContentUrl(candidate.source_url);
      const key = entityKey(candidate);
      if (
        !url ||
        !engageableSocialPostPlatform(url) ||
        existing.has(url) ||
        !key
      ) {
        return false;
      }
      if (!candidate.contacts && !candidate.want_to_know) return false;
      if (candidate.want_to_know && !candidate.want_to_know.owner_selected_at) return false;
      const fit = candidateFit(candidate);
      const exactRegisteredSocialSource =
        candidate.provider === "apify" &&
        candidate.match_method === "registered_source";
      if (!fit.eligible && !exactRegisteredSocialSource) return false;
      const identity = candidate.want_to_know
        ? {
            engagement_target_per_month:
              candidate.want_to_know.engagement_target_per_month,
            is_want_to_know: true,
            default_target_per_month:
              settings.activity.want_to_know_engagements_monthly,
          }
        : {
            engagement_target_per_month:
              candidate.contacts?.engagement_target_per_month,
            relationship_type: candidate.contacts?.relationship_type,
            touch_cadence: candidate.contacts?.touch_cadence,
            trust_level: candidate.contacts?.trust_level,
          };
      if (
        !ignoreCadence &&
        !engagementCadenceAllows({
          identity,
          lastEngagedAt: lastEngaged.get(key) ?? null,
        })
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => candidateScore(b) - candidateScore(a))
    .filter((candidate) => {
      const key = entityKey(candidate);
      if (!key || seenEntities.has(key)) return false;
      seenEntities.add(key);
      return true;
    })
    .slice(0, Math.max(needed * 4, 12));

  let llmDrafts: EngagementRecommendationDraft[] = [];
  let modelAdjudicated = false;
  const shouldUseModel =
    useLlm &&
    settings.automation.llm_ranking_enabled &&
    llmAutomationConfigured() &&
    eligible.length > 0;
  if (shouldUseModel) {
    try {
      llmDrafts = await rankEngagementCandidates(
        eligible.map((candidate) => ({
          id: candidate.id,
          name:
            candidate.contacts?.full_name ??
            candidate.want_to_know?.full_name ??
            candidate.target_name ??
            "Private contact",
          platform: candidate.platform,
          published_at: candidate.published_at,
          content: candidate.content ?? "",
          relevance: candidate.relevance,
          classification: candidate.classification,
          likes: metric(candidate.metrics?.likes),
          comments: metric(candidate.metrics?.comments),
        })),
        {
          network_thesis: settings.onboarding.network_thesis,
          referral_lanes: settings.onboarding.referral_lanes,
          outreach_focus: settings.onboarding.outreach_focus,
        },
        {
          tenantId,
          tags: ["trigger:automation"],
          ledger: createAiGenerationLedger(admin),
        },
      );
      await admin.from("audit_log").insert({
        tenant_id: tenantId,
        actor_type: "system",
        action: "automation.llm_ranking_used",
        table_name: "content_items",
        metadata: {
          router: "vercel_ai_gateway",
          candidate_ids: eligible.map((candidate) => candidate.id),
          selected_ids: llmDrafts.map((draft) => draft.id),
        },
      });
      modelAdjudicated = true;
    } catch {
      llmDrafts = [];
    }
  }
  const llmById = new Map(llmDrafts.map((draft) => [draft.id, draft]));
  const selected = eligible
    .flatMap((candidate) => {
      const modelDraft = llmById.get(candidate.id);
      if (modelAdjudicated && !modelDraft) return [];
      if (
        !modelAdjudicated &&
        !candidateFit(candidate).eligible
      ) {
        return [];
      }
      return [{
        candidate,
        draft: modelDraft ?? fallbackDraft(candidate),
      }];
    })
    .sort((a, b) => b.draft.priority_score - a.draft.priority_score);

  let promoted = 0;
  for (const { candidate, draft } of selected) {
    if (promoted >= needed) break;
    const lane = resolveEngagementLane({
      requestedLane: null,
      classification: candidate.classification,
      isWantToKnow: Boolean(candidate.want_to_know_id),
      contact: candidate.contacts ?? null,
    });
    const { data, error } = await admin.rpc(
      "lbb_record_engagement_signal_v3",
      {
        p_tenant_id: tenantId,
        p_contact_id: candidate.contact_id,
        p_want_to_know_id: candidate.want_to_know_id,
        p_idempotency_key: `content:${candidate.id}`,
        p_signal_type: "social_post",
        p_classification: candidate.classification ?? "CONTINUITY",
        p_summary: draft.summary,
        p_why_now: draft.why_now,
        p_source: candidate.platform ?? "social",
        p_source_url: candidate.source_url,
        p_published_at: candidate.published_at,
        p_engagement_lane: lane,
        p_content_classification: candidate.classification ?? "CONTINUITY",
        p_recommended_action: draft.recommended_action,
        p_priority_score: draft.priority_score,
        p_exceptional_reason: null,
      },
    );
    if (error) continue;
    const signalId =
      data && typeof data === "object" && "id" in data
        ? String(data.id)
        : null;
    await admin
      .from("content_items")
      .update({
        status: "promoted",
        promoted_signal_id: signalId,
      })
      .eq("tenant_id", tenantId)
      .eq("id", candidate.id);
    if (ignoreCadence && signalId) {
      await admin
        .from("signals")
        .update({
          payload: {
            idempotency_key: `content:${candidate.id}`,
            owner_requested_batch: true,
            owner_requested_at: new Date().toISOString(),
          },
        })
        .eq("tenant_id", tenantId)
        .eq("id", signalId);
    }
    promoted += 1;
  }

  return { promoted, pending: pendingCount + promoted, needed };
}
