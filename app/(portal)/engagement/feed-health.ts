import type { SupabaseClient } from "@supabase/supabase-js";
import { activityDayWindow } from "@/lib/activity-settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant-context";
import { normalizeTenantSettings } from "@/lib/tenant-settings";

type FeedTimestampRow = {
  created_at: string;
};

export type EngagementFeedHealth = {
  loadError: boolean;
  receivedToday: boolean;
  latestReceivedAt: string | null;
};

function newestTimestamp(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.localeCompare(a))[0] ?? null;
}

export async function readEngagementFeedHealth({
  client,
  tenantId,
  dayStart,
}: {
  client: SupabaseClient;
  tenantId: string;
  dayStart: string;
}): Promise<EngagementFeedHealth> {
  const [latestContent, latestSignal, contentToday, signalsToday] =
    await Promise.all([
      client
        .from("content_items")
        .select("created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from("signals")
        .select("created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from("content_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("created_at", dayStart),
      client
        .from("signals")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("created_at", dayStart),
    ]);

  if (
    latestContent.error ||
    latestSignal.error ||
    contentToday.error ||
    signalsToday.error
  ) {
    return {
      loadError: true,
      receivedToday: false,
      latestReceivedAt: null,
    };
  }

  return {
    loadError: false,
    receivedToday:
      (contentToday.count ?? 0) > 0 || (signalsToday.count ?? 0) > 0,
    latestReceivedAt: newestTimestamp([
      (latestContent.data as FeedTimestampRow | null)?.created_at,
      (latestSignal.data as FeedTimestampRow | null)?.created_at,
    ]),
  };
}

export async function getEngagementFeedHealth(): Promise<EngagementFeedHealth> {
  const [client, context] = await Promise.all([
    createSupabaseServerClient(),
    getTenantContext(),
  ]);

  if (!client || !context) {
    return {
      loadError: true,
      receivedToday: false,
      latestReceivedAt: null,
    };
  }

  const settings = normalizeTenantSettings(context.settings);
  const activityDay = activityDayWindow(settings.activity.time_zone);

  return readEngagementFeedHealth({
    client,
    tenantId: context.tenantId,
    dayStart: activityDay.startIso,
  });
}
