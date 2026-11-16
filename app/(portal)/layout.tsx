import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { AdminModeToggle } from "@/app/(portal)/admin-mode-toggle";
import { signOut } from "@/app/login/actions";
import { PortalNav } from "@/app/(portal)/portal-nav";
import { adminToolsCookieName, shouldUseAdminTools } from "@/lib/admin-mode";
import {
  getSupportEmail,
  isSetupModeAllowed,
  missingSupabaseEnvMessage,
} from "@/lib/env";
import { getEnabledModuleKeys } from "@/lib/modules";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { getTenantContext } from "@/lib/tenant-context";
import {
  activityDayWindow,
  effectiveDailyLimit,
} from "@/lib/activity-settings";
import { isOwnerActionableChange } from "@/lib/pending-change-types";
import { ownerChangedPeopleCount } from "@/lib/change-review-groups";
import { loadPendingChangeQueueRows } from "@/lib/pending-change-queue";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const cookieStore = await cookies();
  const setupMode = !supabase && isSetupModeAllowed();

  if (!supabase && !setupMode) {
    redirect(`/login?message=${encodeURIComponent(missingSupabaseEnvMessage())}`);
  }

  // Membership is authenticated in getTenantContext, while hidden install
  // settings are loaded with the server-held admin client. Never embed the
  // operator-only tenants table through the owner's Data API query.
  const tenantContext = supabase ? await getTenantContext() : null;
  if (supabase && !tenantContext) {
    // The healthy signed-in path performs one current-user lookup inside
    // getTenantContext. Only distinguish a missing membership from a missing
    // session when that context cannot be built.
    const {
      data: { user: authenticatedUser },
    } = await supabase.auth.getUser();
    redirect(authenticatedUser ? "/access-pending" : "/login");
  }
  const tenantSettings = tenantContext?.settings;
  const enabledModules = getEnabledModuleKeys(tenantSettings);
  const role = tenantContext?.role ?? null;
  const adminMode = shouldUseAdminTools({
    cookieValue: cookieStore.get(adminToolsCookieName)?.value,
    role,
    setupMode,
  });
  const now = new Date().toISOString();
  const normalizedSettings = normalizeTenantSettings(tenantSettings);
  const supportEmail = getSupportEmail();
  const activityDay = activityDayWindow(
    normalizedSettings.activity.time_zone,
  );
  const today = activityDay.date;
  const dayStart = activityDay.startIso;
  const [
    networkingAvailable,
    networkingResolved,
    engagementAvailable,
    engagementResolved,
    ownerPromises,
    pendingPromiseReviews,
    pendingChanges,
    dayOverride,
  ] =
    supabase && tenantContext?.tenantId
      ? await Promise.all([
          enabledModules.includes("networking")
            ? supabase
                .from("connections")
                .select("id", { count: "exact", head: true })
                .eq("tenant_id", tenantContext.tenantId)
                .eq("status", "suggested")
                .or("source.is.null,source.neq.source_project_duplicate")
                .or(`snoozed_until.is.null,snoozed_until.lte.${now}`)
            : Promise.resolve({ count: 0 }),
          enabledModules.includes("networking")
            ? supabase
                .from("connections")
                .select("id", { count: "exact", head: true })
                .eq("tenant_id", tenantContext.tenantId)
                .or(
                  `snoozed_at.gte.${dayStart},and(status.neq.suggested,updated_at.gte.${dayStart})`,
                )
            : Promise.resolve({ count: 0 }),
          enabledModules.includes("engagement")
            ? supabase
                .from("signals")
                .select("id", { count: "exact", head: true })
                .eq("tenant_id", tenantContext.tenantId)
                .not("source_url", "is", null)
                .is("dismissed_at", null)
                .is("engaged_at", null)
                .or(`expires_at.is.null,expires_at.gt.${now}`)
                .or(
                  "content_classification.is.null,content_classification.neq.NOISE",
                )
            : Promise.resolve({ count: 0 }),
          enabledModules.includes("engagement")
            ? supabase
                .from("signals")
                .select("id", { count: "exact", head: true })
                .eq("tenant_id", tenantContext.tenantId)
                .or(
                  `and(engaged_by.eq.${tenantContext.userId},engaged_at.gte.${dayStart}),and(dismissed_by.eq.${tenantContext.userId},dismissed_at.gte.${dayStart})`,
                )
            : Promise.resolve({ count: 0 }),
          enabledModules.includes("networking")
            ? supabase
                .from("promises")
                .select("id", { count: "exact", head: true })
                .eq("tenant_id", tenantContext.tenantId)
                .eq("status", "open")
                .eq("direction", "owner_owes_contact")
            : Promise.resolve({ count: 0 }),
          enabledModules.includes("networking")
            ? supabase
                .from("promises")
                .select("id", { count: "exact", head: true })
                .eq("tenant_id", tenantContext.tenantId)
                .eq("owner_user_id", tenantContext.userId)
                .eq("status", "pending_review")
                .eq("review_status", "pending_owner")
            : Promise.resolve({ count: 0 }),
          loadPendingChangeQueueRows(supabase, tenantContext.tenantId),
          supabase
            .from("recommendation_day_overrides")
            .select("engagement_extra, networking_extra")
            .eq("tenant_id", tenantContext.tenantId)
            .eq("user_id", tenantContext.userId)
            .eq("activity_date", today)
            .maybeSingle(),
        ])
      : [
          { count: 0 },
          { count: 0 },
          { count: 0 },
          { count: 0 },
          { count: 0 },
          { count: 0 },
          { data: [] },
          { data: null },
        ];
  const networkingExtra =
    (dayOverride.data as { networking_extra?: number } | null)
      ?.networking_extra ?? 0;
  const networkingRemaining = effectiveDailyLimit({
    base: normalizedSettings.activity.networking_daily_limit,
    extra: networkingExtra,
    resolved: networkingResolved.count ?? 0,
  });
  const networkingCount = Math.min(
    networkingAvailable.count ?? 0,
    networkingRemaining,
  );
  const engagementExtra =
    (dayOverride.data as { engagement_extra?: number } | null)
      ?.engagement_extra ?? 0;
  const engagementRemaining = effectiveDailyLimit({
    base: normalizedSettings.activity.engagement_daily_limit,
    extra: engagementExtra,
    resolved: engagementResolved.count ?? 0,
  });
  const engagementCount = Math.min(
    engagementAvailable.count ?? 0,
    engagementRemaining,
  );
  const promisesCount = (ownerPromises.count ?? 0) + (pendingPromiseReviews.count ?? 0);
  const changesCount = ownerChangedPeopleCount(
    (pendingChanges.data ?? []).filter(isOwnerActionableChange),
  );

  return (
    <div className="portal">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="side">
        <div className="wordmark">
          <div className="wordmark-title" aria-label="Little Black Book">
            Little Black Book
          </div>
        </div>
        <PortalNav
          adminMode={adminMode}
          enabledModules={enabledModules}
          role={role}
          setupMode={setupMode}
          networkingCount={networkingCount}
          engagementCount={engagementCount}
          promisesCount={promisesCount}
          changesCount={changesCount}
        />
        <details className="side-account">
          <summary>Account</summary>
          <div className="side-footer">
            <b>{tenantContext?.userEmail ?? "setup mode"}</b>
            <div className="side-footer-links">
              <Link href="/privacy">Privacy</Link>
              <Link href="/support">Get help</Link>
            </div>
            {supportEmail ? <span className="visually-hidden">Support from {supportEmail}</span> : null}
            {role === "operator" ? <AdminModeToggle adminMode={adminMode} /> : null}
            <form action={signOut}>
              <button className="button quiet" type="submit">Sign out</button>
            </form>
          </div>
        </details>
      </aside>
      <main className="main" id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
