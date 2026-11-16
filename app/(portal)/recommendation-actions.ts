"use server";

import { revalidatePath } from "next/cache";
import { activityDayWindow } from "@/lib/activity-settings";
import { refillEngagementRecommendations } from "@/lib/automation/engagement-refill";
import { requireTenantActionContext } from "@/lib/server-action-context";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { redirectWithMessage } from "@/lib/server-action-redirect";
import { readEngagementFeedHealth } from "@/app/(portal)/engagement/feed-health";

async function recommendationRequest(kind: "engagement" | "networking") {
  const { admin, context } = await requireTenantActionContext(() =>
    redirectWithMessage(
      kind === "engagement" ? "/engagement" : "/networking",
      "Recommendation controls are not configured.",
    ),
  );
  const settings = normalizeTenantSettings(context.settings);
  const amount =
    kind === "engagement"
      ? settings.activity.engagement_more_batch
      : settings.activity.networking_more_batch;
  const activityDay = activityDayWindow(settings.activity.time_zone);

  return { admin, context, settings, amount, activityDay };
}

async function addRecommendationCapacity({
  admin,
  tenantId,
  userId,
  kind,
  amount,
  activityDate,
}: {
  admin: Awaited<ReturnType<typeof recommendationRequest>>["admin"];
  tenantId: string;
  userId: string;
  kind: "engagement" | "networking";
  amount: number;
  activityDate: string;
}) {
  const { error } = await admin.rpc("lbb_adjust_recommendation_day_limit", {
    p_tenant_id: tenantId,
    p_actor_user_id: userId,
    p_kind: kind,
    p_amount: amount,
    p_activity_date: activityDate,
  });

  if (error) {
    redirectWithMessage(
      kind === "engagement" ? "/engagement" : "/networking",
      "More recommendations could not be queued.",
    );
  }

  revalidatePath("/engagement");
  revalidatePath("/networking");
  revalidatePath("/dashboard");
}

async function engagementCapacityNeeded(
  request: Awaited<ReturnType<typeof recommendationRequest>>,
) {
  const [engaged, dismissed, override] = await Promise.all([
    request.admin
      .from("signals")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", request.context.tenantId)
      .eq("engaged_by", request.context.userId)
      .gte("engaged_at", request.activityDay.startIso),
    request.admin
      .from("signals")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", request.context.tenantId)
      .eq("dismissed_by", request.context.userId)
      .gte("dismissed_at", request.activityDay.startIso),
    request.admin
      .from("recommendation_day_overrides")
      .select("engagement_extra")
      .eq("tenant_id", request.context.tenantId)
      .eq("user_id", request.context.userId)
      .eq("activity_date", request.activityDay.date)
      .maybeSingle(),
  ]);
  if (engaged.error || dismissed.error || override.error) {
    throw new Error("Engagement progress could not be read.");
  }

  const resolved = (engaged.count ?? 0) + (dismissed.count ?? 0);
  const currentExtra =
    (override.data as { engagement_extra?: number } | null)
      ?.engagement_extra ?? 0;
  const currentLimit =
    request.settings.activity.engagement_daily_limit + currentExtra;
  return Math.max(0, resolved + request.amount - currentLimit);
}

function formatFeedUpdate(value: string, timeZone: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(new Date(parsed));
}

async function noAdditionalEngagementMessage(
  request: Awaited<ReturnType<typeof recommendationRequest>>,
) {
  const feedHealth = await readEngagementFeedHealth({
    client: request.admin,
    tenantId: request.context.tenantId,
    dayStart: request.activityDay.startIso,
  });

  if (feedHealth.loadError) {
    return "No additional recommendations are ready, and feed freshness could not be confirmed.";
  }
  if (feedHealth.receivedToday) {
    return "Today’s research reached the feed, but no additional posts passed the engagement checks.";
  }
  if (!feedHealth.latestReceivedAt) {
    return "No researched posts have reached the engagement feed yet.";
  }

  const lastUpdate = formatFeedUpdate(
    feedHealth.latestReceivedAt,
    request.settings.activity.time_zone,
  );
  return lastUpdate
    ? `Today’s research has not reached the engagement feed yet. The last feed update was ${lastUpdate}.`
    : "Today’s research has not reached the engagement feed yet.";
}

export async function requestMoreEngagementActivity() {
  const request = await recommendationRequest("engagement");
  let refill;
  try {
    refill = await refillEngagementRecommendations({
      admin: request.admin,
      tenantId: request.context.tenantId,
      settings: request.settings,
      targetPending: request.amount,
      ignoreCadence: true,
    });
  } catch {
    redirectWithMessage(
      "/engagement",
      "The next engagement batch could not be prepared. Please try again.",
    );
  }
  if (refill.pending <= 0) {
    let feedback = "No additional recommendations are ready right now.";
    try {
      feedback = await noAdditionalEngagementMessage(request);
    } catch {
      // The refill result remains valid when the freshness check is unavailable.
    }
    redirectWithMessage(
      "/engagement",
      feedback,
    );
  }
  let capacityNeeded: number;
  try {
    capacityNeeded = await engagementCapacityNeeded(request);
  } catch {
    redirectWithMessage(
      "/engagement",
      "Engagement progress could not be updated. Please try again.",
    );
  }
  if (capacityNeeded > 0) {
    await addRecommendationCapacity({
      admin: request.admin,
      tenantId: request.context.tenantId,
      userId: request.context.userId,
      kind: "engagement",
      amount: capacityNeeded,
      activityDate: request.activityDay.date,
    });
  }
  revalidatePath("/engagement");
  redirectWithMessage(
    "/engagement",
    `Your next ${Math.min(request.amount, refill.pending)} engagement recommendations are ready.`,
  );
}

export async function requestMoreNetworkingActivity() {
  const request = await recommendationRequest("networking");
  await addRecommendationCapacity({
    admin: request.admin,
    tenantId: request.context.tenantId,
    userId: request.context.userId,
    kind: "networking",
    amount: request.amount,
    activityDate: request.activityDay.date,
  });
  redirectWithMessage("/networking", "More introduction options are ready.");
}
