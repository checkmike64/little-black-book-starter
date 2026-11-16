import {
  buildClientInstallManifest,
  formatClientInstallManifest,
} from "@/lib/client-install-manifest";
import { buildInstallBrief } from "@/lib/install-brief";
import { featureModules } from "@/lib/modules";
import { requireOperatorAccess } from "@/lib/operator-access";
import { getSettingsData, type SetupStatus } from "@/lib/settings/data";
import {
  runContentScanNow,
  updateInstallSettings,
} from "@/app/(portal)/settings/actions";
import { contentScanPlatforms } from "@/lib/automation/content-scan-settings";
import { managedProviders } from "@/lib/provider-plans";

const contentScanPlatformLabels = {
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  x_twitter: "X",
  youtube: "YouTube",
  website: "Website",
} as const;

function statusClass(tone: SetupStatus["tone"]) {
  if (tone === "ok") return "status-ok";
  if (tone === "warn") return "status-warn";
  return "status-neutral";
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperatorAccess();
  const params = searchParams ? await searchParams : {};
  const message = Array.isArray(params.message) ? params.message[0] : params.message;
  const { statuses, settings, settingsVersion, tenantName, role, scanHealth, providerHealth } =
    await getSettingsData();
  const installBrief = buildInstallBrief({ tenantName, settings });
  const installManifest = buildClientInstallManifest({ tenantName, settings });
  const manifestText = formatClientInstallManifest(installManifest);

  return (
    <>
      <div className="crumb">Settings</div>
      <h1 className="portal-title">Settings</h1>
      <p className="lede">
        Install configuration, module toggles, quotas, write rules, retention, and
        operator access controls.
      </p>
      {message ? <div className="notice">{message}</div> : null}
      <div className="grid two">
        <div className="card">
          <h2>Required setup</h2>
          <ul className="security-list">
            {statuses.map((status) => (
              <li key={status.label}>
                <span>{status.label}</span>
                <span className={statusClass(status.tone)}>{status.value}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h2>Data boundary</h2>
          <p className="muted">
            Contact data, meeting observations, and content scans live in this
            client&apos;s isolated Supabase project. Source accounts stay outside the
            app, and LLMs receive only the narrow context required for a structured
            recommendation.
          </p>
        </div>
        <section className="ask-brief" aria-label="Install brief">
          <label className="field">
            <span>Claude install brief</span>
            <textarea readOnly value={installBrief} />
          </label>
          <p className="source-note">
            This reflects saved settings only. Update Intake to change the client
            operating profile.
          </p>
        </section>
        <section className="ask-brief" aria-label="Client install manifest">
          <label className="field">
            <span>Client install manifest</span>
            <textarea readOnly value={manifestText} />
          </label>
          <p className="source-note">
            Compact operator summary for confirming module visibility, buckets,
            write posture, and missing setup before handoff.
          </p>
        </section>
        <div className="card">
          <h2>Install model</h2>
          <ul className="security-list">
            <li>
              <span>One Supabase project per client</span>
              <span className="status-ok">Required</span>
            </li>
            <li>
              <span>Executive owner plus managed operator</span>
              <span className="status-ok">Required</span>
            </li>
            <li>
              <span>Full transcript for intake; detailed notes stored by default</span>
              <span className="status-ok">Required</span>
            </li>
          </ul>
        </div>
        <div className="card">
          <h2>Modules · {tenantName}</h2>
          <form action={updateInstallSettings} className="settings-form">
          <section className="card" aria-labelledby="keep-in-touch-settings">
            <h2 id="keep-in-touch-settings">Keep in touch</h2>
            <p className="muted">Choose how often to contact each tier. Today shows people who are due, even without social posts. A contact’s explicit touch cadence overrides these defaults; dormant and ad hoc contacts have no recurring reminder.</p>
            <div className="grid three">
              {([1, 2, 3] as const).map(tier => (
                <label className="field" key={tier}>
                  <span>Tier {tier} interval (days)</span>
                  <input type="number" name={`tier_${tier}_days`} min="1" max="3650" step="1" required defaultValue={settings.keep_in_touch[`tier_${tier}_days`]} />
                </label>
              ))}
            </div>
          </section>

            <input name="settings_version" type="hidden" value={settingsVersion} />
            <div className="mini-list">
              <div className="mini-item dense">
                <b>Operator-led deployment</b>
                <span>
                  Intake, setup, deployment, export, and Ops remain hidden from
                  the executive owner. They see the finished Book, enabled modules,
                  and pending changes that need review.
                </span>
              </div>
            </div>

            <div className="toggle-list">
              <label className="toggle-row">
                <input
                  defaultChecked={settings.automation.llm_ranking_enabled}
                  name="llm_ranking_enabled"
                  type="checkbox"
                />
                <span>
                  <b>Use the configured LLM to rank recommendations</b>
                  <small>
                    Sends a bounded candidate summary to the configured provider.
                    Leave off for deterministic in-app ranking only.
                  </small>
                </span>
              </label>
              {featureModules.map((module) => (
                <label className="toggle-row" key={module.key}>
                  <input
                    defaultChecked={settings.modules[module.key]}
                    name={`module_${module.key}`}
                    type="checkbox"
                  />
                  <span>
                    <b>{module.label}</b>
                    <small>{module.description}</small>
                  </span>
                </label>
              ))}
            </div>

            <details className="mini-item dense" open>
              <summary>Managed provider plans</summary>
              <p className="source-note">
                These services use managed operator accounts. The client never receives
                provider credentials or manages provider billing.
              </p>
              <div className="mini-list">
                {managedProviders.map((provider) => {
                  const plan = settings.providers[provider];
                  const usage = providerHealth.usage[provider];
                  const configured =
                    provider === "apify"
                      ? providerHealth.apifyConfigured
                      : providerHealth.outscraperConfigured;
                  return (
                    <div className="mini-item dense" key={provider}>
                      <label className="toggle-row compact">
                        <input
                          defaultChecked={plan.enabled}
                          name={`provider_${provider}_enabled`}
                          type="checkbox"
                        />
                        <span>
                          <b>{provider === "apify" ? "Apify" : "Outscraper"}</b>
                          <small>
                            {configured
                              ? "Managed credential connected"
                              : "Managed credential still required"}
                          </small>
                        </span>
                      </label>
                      <div className="form-grid three">
                        <label className="field">
                          <span>Monthly provider cost limit</span>
                          <input
                            defaultValue={plan.monthly_cost_limit_usd}
                            min={0}
                            name={`provider_${provider}_monthly_cost_limit`}
                            step="0.01"
                            type="number"
                          />
                        </label>
                        <label className="field">
                          <span>Usage markup</span>
                          <input
                            defaultValue={plan.markup_percent}
                            max={500}
                            min={0}
                            name={`provider_${provider}_markup_percent`}
                            step="0.01"
                            type="number"
                          />
                        </label>
                        <label className="field">
                          <span>Included monthly usage</span>
                          <input
                            defaultValue={plan.included_usage_usd}
                            min={0}
                            name={`provider_${provider}_included_usage`}
                            step="0.01"
                            type="number"
                          />
                        </label>
                      </div>
                      <p className="source-note">
                        This month: {money(usage.providerCostCents)} provider cost ·{" "}
                        {money(usage.clientChargeCents)} client usage after the
                        included allowance · {usage.finalized} finalized
                        {usage.estimated > 0
                          ? ` · ${usage.estimated} awaiting final cost`
                          : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            </details>

            <label className="toggle-row compact">
              <input
                defaultChecked={settings.automation.enrichment.enabled}
                name="enrichment_enabled"
                type="checkbox"
              />
              <span>
                <b>Automatic profile research</b>
                <small>
                  Researches new people and missing profile details, then sends
                  what it finds to Changes for approval.
                </small>
              </span>
            </label>

            <div className="form-grid three">
              <label className="field">
                <span>People researched per day</span>
                <input
                  defaultValue={settings.automation.enrichment.daily_limit}
                  max={200}
                  min={0}
                  name="enrichment_daily_limit"
                  type="number"
                />
              </label>
              <label className="field">
                <span>Catch up until (max 7 days ahead)</span>
                <input
                  defaultValue={settings.automation.enrichment.catchup_until?.slice(0, 10) ?? ""}
                  name="enrichment_catchup_until"
                  type="date"
                />
              </label>
              <label className="field">
                <span>People per day while catching up</span>
                <input
                  defaultValue={settings.automation.enrichment.catchup_daily_limit}
                  max={500}
                  min={0}
                  name="enrichment_catchup_daily_limit"
                  type="number"
                />
              </label>
            </div>

            <div className="mini-list">
              <div className="mini-item dense">
                <b>Content monitoring</b>
                <span>
                  {scanHealth.configured
                    ? scanHealth.latestScan
                      ? `${scanHealth.sourceCount} sources ready. Last check: ${scanHealth.latestScan.status.replace("_", " ")}.`
                      : `${scanHealth.sourceCount} sources ready. No checks have completed yet.`
                    : "Connect the install's scoped Apify credential once, then saved public sources can be checked automatically."}
                </span>
              </div>
            </div>

            <label className="toggle-row compact">
              <input
                defaultChecked={settings.automation.content_scans.enabled}
                name="content_scans_enabled"
                type="checkbox"
              />
              <span>
                <b>Automatic content monitoring</b>
                <small>
                  Checks saved public profiles and websites in the background.
                </small>
              </span>
            </label>

            <div className="form-grid three">
              <label className="field">
                <span>Check each source every</span>
                <select
                  defaultValue={settings.automation.content_scans.cadence_days}
                  name="content_scan_cadence_days"
                >
                  <option value="1">Day</option>
                  <option value="5">5 days</option>
                  <option value="7">Week</option>
                  <option value="14">2 weeks</option>
                </select>
              </label>
              <label className="field">
                <span>People checked per day</span>
                <input
                  defaultValue={settings.automation.content_scans.daily_run_limit}
                  max={25}
                  min={1}
                  name="content_scan_daily_limit"
                  type="number"
                />
              </label>
              <label className="field">
                <span>Checks running at once</span>
                <input
                  defaultValue={
                    settings.automation.content_scans.concurrent_run_limit
                  }
                  max={10}
                  min={1}
                  name="content_scan_concurrent_limit"
                  type="number"
                />
              </label>
            </div>

            <details className="mini-item dense">
              <summary>Advanced scan task setup</summary>
              <p className="source-note">
                One reusable Apify task per source type. Credentials remain in
                Vercel and are never stored here.
              </p>
              <div className="mini-list">
                {contentScanPlatforms.map((platform) => {
                  const connector =
                    settings.automation.content_scans.connectors.find(
                      (candidate) => candidate.platform === platform,
                    )!;
                  return (
                    <div className="mini-item dense" key={platform}>
                      <label className="toggle-row compact">
                        <input
                          defaultChecked={connector.enabled}
                          name={`scan_${platform}_enabled`}
                          type="checkbox"
                        />
                        <span>
                          <b>
                            {contentScanPlatformLabels[platform]}
                          </b>
                          <small>Use this source when a saved URL exists.</small>
                        </span>
                      </label>
                      <div className="form-grid three">
                        <label className="field">
                          <span>Apify task ID</span>
                          <input
                            defaultValue={connector.task_id}
                            name={`scan_${platform}_task_id`}
                            type="text"
                          />
                        </label>
                        <label className="field">
                          <span>Profile list field</span>
                          <input
                            defaultValue={connector.input_field}
                            name={`scan_${platform}_input_field`}
                            type="text"
                          />
                        </label>
                        <label className="field">
                          <span>Profile list shape</span>
                          <select
                            defaultValue={connector.input_format}
                            name={`scan_${platform}_input_format`}
                          >
                            <option value="string_array">URL list</option>
                            <option value="request_list">Request list</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>Result limit field</span>
                          <input
                            defaultValue={connector.limit_field}
                            name={`scan_${platform}_limit_field`}
                            type="text"
                          />
                        </label>
                        <label className="field">
                          <span>Maximum items per check</span>
                          <input
                            defaultValue={connector.max_items_per_run}
                            max={100}
                            min={1}
                            name={`scan_${platform}_max_items`}
                            type="number"
                          />
                        </label>
                        <label className="field">
                          <span>Maximum cost per check</span>
                          <input
                            defaultValue={connector.max_charge_usd}
                            max={25}
                            min={0.01}
                            name={`scan_${platform}_max_charge`}
                            step="0.01"
                            type="number"
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>

            <div className="form-grid three">
              <label className="field">
                <span>Minimum engagements ready</span>
                <input
                  defaultValue={settings.activity.engagement_daily_floor}
                  max={10}
                  min={0}
                  name="engagement_daily_floor"
                  type="number"
                />
              </label>
              <label className="field">
                <span>Monthly enrichments</span>
                <input
                  defaultValue={settings.quotas.enrichment_monthly}
                  min={0}
                  name="enrichment_monthly"
                  type="number"
                />
              </label>
              <label className="field">
                <span>Monthly pulse posts</span>
                <input
                  defaultValue={settings.quotas.pulse_posts_monthly}
                  min={0}
                  name="pulse_posts_monthly"
                  type="number"
                />
              </label>
              <label className="field">
                <span>Daily Claude writes</span>
                <input
                  defaultValue={settings.quotas.claude_writes_daily}
                  min={0}
                  name="claude_writes_daily"
                  type="number"
                />
              </label>
            </div>

            <div className="mini-list">
              <div className="mini-item dense">
                <b>Daily recommendation budget</b>
                <span>
                  The executive sees a small daily set. Additional qualified
                  recommendations remain available on demand.
                </span>
              </div>
            </div>

            <div className="form-grid three">
              <label className="field">
                <span>In-network engagements per day</span>
                <input
                  defaultValue={settings.activity.engagement_daily_limit}
                  max={25}
                  min={0}
                  name="engagement_daily_limit"
                  type="number"
                />
              </label>
              <label className="field">
                <span>Want to Know engagements per day</span>
                <input
                  defaultValue={settings.activity.want_to_know_daily_limit}
                  max={25}
                  min={0}
                  name="want_to_know_daily_limit"
                  type="number"
                />
              </label>
              <label className="field">
                <span>Introductions per day</span>
                <input
                  defaultValue={settings.activity.networking_daily_limit}
                  max={15}
                  min={0}
                  name="networking_daily_limit"
                  type="number"
                />
              </label>
              <label className="field">
                <span>Prospect engagements per month</span>
                <input
                  defaultValue={settings.activity.want_to_know_engagements_monthly}
                  max={8}
                  min={0}
                  name="want_to_know_engagements_monthly"
                  type="number"
                />
              </label>
              <label className="field">
                <span>Extra engagement batch</span>
                <input
                  defaultValue={settings.activity.engagement_more_batch}
                  max={25}
                  min={1}
                  name="engagement_more_batch"
                  type="number"
                />
              </label>
              <label className="field">
                <span>Extra introduction batch</span>
                <input
                  defaultValue={settings.activity.networking_more_batch}
                  max={15}
                  min={1}
                  name="networking_more_batch"
                  type="number"
                />
              </label>
              <label className="field">
                <span>Daily reset timezone</span>
                <input
                  defaultValue={settings.activity.time_zone}
                  list="activity-time-zones"
                  name="activity_time_zone"
                  placeholder="America/Mexico_City"
                  type="text"
                />
                <datalist id="activity-time-zones">
                  <option value="America/Mexico_City" />
                  <option value="America/New_York" />
                  <option value="America/Chicago" />
                  <option value="America/Denver" />
                  <option value="America/Los_Angeles" />
                  <option value="Europe/London" />
                </datalist>
              </label>
            </div>

            <label className="toggle-row compact">
              <input
                defaultChecked={settings.write_rules.mechanical_writes}
                name="mechanical_writes"
                type="checkbox"
              />
              <span>
                <b>Allow mechanical Claude writes</b>
                <small>Observed interactions, promises, and safe last-spoke updates.</small>
              </span>
            </label>

            <label className="field">
              <span>Transcript storage</span>
              <select
                defaultValue={settings.write_rules.transcript_storage}
                name="transcript_storage"
              >
                <option value="intake_full_then_notes">
                  Full intake transcript, then detailed notes
                </option>
                <option value="detailed_notes">Detailed notes only</option>
              </select>
            </label>

            <label className="field">
              <span>Launch notes</span>
              <textarea
                defaultValue={settings.delivery.launch_notes}
                name="launch_notes"
                placeholder="Operator-only notes for what must be configured before the owner sees this install."
                rows={4}
              />
            </label>

            <div className="actions">
              <button className="button hot" disabled={!role} type="submit">
                Save install settings
              </button>
            </div>
          </form>
          <form action={runContentScanNow}>
            <button
              className="button ghost"
              disabled={
                !scanHealth.configured ||
                !settings.automation.content_scans.enabled
              }
              type="submit"
            >
              Run broad content check (up to daily limit)
            </button>
          </form>
          <form action={runContentScanNow}>
            <input name="platform" type="hidden" value="x_twitter" />
            <input name="platform" type="hidden" value="youtube" />
            <button
              className="button ghost"
              disabled={
                !scanHealth.configured ||
                !settings.automation.content_scans.enabled
              }
              type="submit"
            >
              Check one X profile and one YouTube channel
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
