import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { normalizedActiveMigrationSql } from "./migration-source.js";
import {
  normalizeContentScanSettings,
} from "../lib/automation/content-scan-settings.js";
import {
  buildApifyTaskInput,
  normalizeApifyDatasetItemResult,
  registeredSourceMatchesAuthor,
} from "../lib/integrations/apify.js";

describe("Apify content automation", () => {
  test("builds only the configured task input shape", () => {
    const client = readFileSync("lib/integrations/apify.ts", "utf8");
    assert.match(client, /connector\.input_field/);
    assert.match(client, /\? \[\{ url: sourceUrl \}\]/);
    assert.match(client, /: \[sourceUrl\]/);
  });

  test("normalizes useful public posts and rejects malformed output", () => {
    const client = readFileSync("lib/integrations/apify.ts", "utf8");
    assert.match(client, /normalizeExternalContentUrl/);
    assert.match(client, /author_profile_url/);
    assert.match(client, /"linkedinUrl"/);
    assert.match(client, /"postedAt"/);
    assert.match(client, /"datePublished"/);
    assert.match(client, /"time"/);
    assert.match(client, /Number\.isNaN\(parsed\)/);
    assert.match(client, /Math\.max\(0, Math\.round\(value\)\)/);
    assert.match(client, /if \(!content && !title\)/);
  });

  test("normalizes the nested LinkedIn actor output used in production", () => {
    const client = readFileSync("lib/integrations/apify.ts", "utf8");
    assert.match(client, /nestedRecord\(record, "postedAt"\)/);
    assert.match(client, /dateFromValue\(nested\.date\)/);
    assert.match(client, /dateFromValue\(nested\.timestamp\)/);
    assert.match(client, /nestedRecord\(record, "author"\)/);
    assert.match(client, /nestedCount\(record, "engagement"/);
    assert.match(client, /registeredSourceMatchesAuthor/);
    assert.match(client, /normalizedPath\(sourceParsed\)[\s\S]*normalizedPath\(authorParsed\)/);
  });

  test("reports the first parser rejection reason without storing raw content", () => {
    const client = readFileSync("lib/integrations/apify.ts", "utf8");
    const webhook = readFileSync(
      "app/api/integrations/apify/webhook/route.ts",
      "utf8",
    );
    assert.match(client, /"missing_or_invalid_post_url"/);
    assert.match(client, /"missing_or_invalid_published_date"/);
    assert.match(client, /"published_date_over_24h_in_future"/);
    assert.match(client, /"missing_content_and_title"/);
    assert.match(webhook, /rejection_reasons: rejectionReasons/);
    assert.doesNotMatch(webhook, /rejection_reasons: dataset/);
  });

  test("bounds operator settings and requires explicit task configuration", () => {
    const settings = normalizeContentScanSettings({
      enabled: true,
      cadence_days: 0,
      daily_run_limit: 500,
      concurrent_run_limit: 99,
      monthly_budget_usd: 999,
      connectors: [
        {
          platform: "linkedin",
          task_id: "safe-task_123",
          input_field: "profileUrls",
          max_items_per_run: 5000,
          max_charge_usd: 99,
        },
      ],
    });
    assert.equal(settings.cadence_days, 1);
    assert.equal(settings.daily_run_limit, 25);
    assert.equal(settings.concurrent_run_limit, 10);
    assert.equal(settings.monthly_budget_usd, 999);
    assert.equal(settings.connectors[0].max_items_per_run, 100);
    assert.equal(settings.connectors[0].max_charge_usd, 25);
  });

  test("sends the per-profile result limit inside the actor input", () => {
    const settings = normalizeContentScanSettings({
      connectors: [
        {
          platform: "instagram",
          task_id: "ig-task",
          max_items_per_run: 5,
        },
      ],
    });
    const connectorFor = (platform: string) =>
      settings.connectors.find((connector) => connector.platform === platform)!;
    assert.deepEqual(
      buildApifyTaskInput(connectorFor("instagram"), "https://www.instagram.com/example/"),
      { directUrls: ["https://www.instagram.com/example/"], resultsLimit: 5 },
    );
    assert.deepEqual(
      Object.fromEntries(
        settings.connectors.map((connector) => [connector.platform, connector.limit_field]),
      ),
      {
        linkedin: "maxPosts",
        instagram: "resultsLimit",
        facebook: "resultsLimit",
        x_twitter: "maxItems",
        youtube: "maxResults",
        website: "",
      },
    );
    assert.deepEqual(
      buildApifyTaskInput(connectorFor("website"), "https://example.com/"),
      { startUrls: [{ url: "https://example.com/" }] },
    );
  });

  test("keeps an operator's result limit field and rejects unsafe ones", () => {
    const settings = normalizeContentScanSettings({
      connectors: [
        { platform: "linkedin", limit_field: "postsLimit" },
        { platform: "instagram", limit_field: "results limit; drop" },
      ],
    });
    assert.equal(settings.connectors[0].limit_field, "postsLimit");
    assert.equal(settings.connectors[1].limit_field, "resultsLimit");
  });

  test("uses the input field required by the production LinkedIn posts actor", () => {
    const settings = normalizeContentScanSettings({});
    const linkedin = settings.connectors.find(
      (connector) => connector.platform === "linkedin",
    );
    assert.equal(linkedin?.input_field, "targetUrls");
  });

  test("registers configurable X and YouTube connectors", () => {
    const settings = normalizeContentScanSettings({});
    const x = settings.connectors.find(
      (connector) => connector.platform === "x_twitter",
    );
    const youtube = settings.connectors.find(
      (connector) => connector.platform === "youtube",
    );
    assert.deepEqual(
      [x?.input_field, x?.input_format],
      ["startUrls", "string_array"],
    );
    assert.deepEqual(
      [youtube?.input_field, youtube?.input_format],
      ["startUrls", "request_list"],
    );
  });

  test("normalizes the X and YouTube provider shapes used in production", () => {
    const x = normalizeApifyDatasetItemResult(
      {
        id: "1728108619189874825",
        url: "https://x.com/example/status/1728108619189874825",
        twitterUrl: "https://twitter.com/example/status/1728108619189874825",
        text: "A useful public post.",
        createdAt: "Fri Nov 24 17:49:36 +0000 2023",
        retweetCount: 11,
        replyCount: 7,
        likeCount: 23,
        author: {
          userName: "example",
          url: "https://x.com/example",
          twitterUrl: "https://twitter.com/example",
        },
      },
      "x_twitter",
    );
    assert.equal(x.rejection_reason, null);
    assert.equal(x.item?.author_profile_url, "https://x.com/example");
    assert.deepEqual(x.item?.metrics, { likes: 23, comments: 7, shares: 11 });
    assert.equal(
      registeredSourceMatchesAuthor(
        "https://twitter.com/example",
        x.item?.author_profile_url ?? "",
      ),
      true,
    );

    const youtube = normalizeApifyDatasetItemResult(
      {
        id: "kwWeUpLAG0I",
        title: "A useful video",
        date: "6 days ago",
        url: "https://www.youtube.com/watch?v=kwWeUpLAG0I",
        channelUrl: "https://www.youtube.com/channel/UCTgwcoeGGKmZ3zzCXN2qo_A",
        input: "https://www.youtube.com/@Example",
        viewCount: 402,
      },
      "youtube",
    );
    assert.equal(youtube.rejection_reason, null);
    assert.equal(youtube.item?.content_type, "video");
    assert.equal(
      youtube.item?.author_profile_url,
      "https://www.youtube.com/@Example",
    );
    assert.equal(
      registeredSourceMatchesAuthor(
        "https://youtube.com/@example/videos",
        youtube.item?.author_profile_url ?? "",
      ),
      true,
    );
  });

  test("keeps tenant isolation, replay control, and budgets in the database", () => {
    const migration = normalizedActiveMigrationSql;
    assert.match(migration, /foreign key \(tenant_id, source_id\)/);
    assert.match(migration, /content_scan_runs_one_active_source_idx/);
    assert.match(migration, /content_scan_runs_dispatch_idx/);
    assert.match(migration, /pg_advisory_xact_lock/);
    assert.match(migration, /p_monthly_budget_usd/);
    assert.match(
      migration,
      /content_scan_sources_platform_check[\s\S]*'x_twitter'::text[\s\S]*'youtube'::text/,
    );
    assert.match(
      migration,
      /revoke insert, update, delete, truncate, references, trigger on table[\s\S]*public\.content_scan_runs[\s\S]*from authenticated/,
    );
    assert.match(
      migration,
      /grant select on table[\s\S]*public\.content_scan_runs[\s\S]*to authenticated/,
    );
  });

  test("releases a failed webhook claim so Apify can retry delivery", () => {
    const webhook = readFileSync(
      "app/api/integrations/apify/webhook/route.ts",
      "utf8",
    );

    assert.match(
      webhook,
      /status: "running",\s+webhook_dispatch_id: null,/,
    );
    assert.match(webhook, /finished_at: null/);
  });

  test("authenticates callbacks before touching Supabase and never puts tokens in URLs", () => {
    const webhook = readFileSync(
      "app/api/integrations/apify/webhook/route.ts",
      "utf8",
    );
    const client = readFileSync("lib/integrations/apify.ts", "utf8");
    const proxy = readFileSync("proxy.ts", "utf8");
    assert.ok(
      webhook.indexOf("apifyWebhookAuthorized(request)") <
        webhook.indexOf("createSupabaseAdminClient()"),
    );
    assert.match(
      proxy,
      /pathname === "\/api\/integrations\/apify\/webhook"/,
    );
    assert.doesNotMatch(client, /[?&]token=/);
    assert.match(client, /Authorization: `Bearer \$\{token\}`/);
    assert.match(webhook, /x-apify-webhook-dispatch-id/);
    assert.match(webhook, /Scan task mismatch/);
    assert.match(webhook, /Scan dataset mismatch/);
  });

  test("launches scans before refilling the daily recommendation queue", () => {
    const daily = readFileSync("app/api/automation/daily/route.ts", "utf8");
    assert.ok(
      daily.indexOf("await reconcileApifyUsageForTenant") <
        daily.indexOf("await runContentScansForTenant"),
    );
    assert.ok(
      daily.indexOf("runContentScansForTenant") <
        daily.lastIndexOf("refillEngagementRecommendations"),
    );
    const refill = readFileSync(
      "lib/automation/engagement-refill.ts",
      "utf8",
    );
    assert.match(refill, /\.eq\("match_status", "matched"\)/);
  });

  test("filters disabled source types before applying the daily scan limit", () => {
    const scans = readFileSync("lib/automation/content-scans.ts", "utf8");
    assert.match(scans, /const configuredPlatforms = contentScanPlatforms\.filter/);
    assert.match(scans, /buildSourceQuery\(configuredPlatforms\)/);
    assert.ok(
      scans.indexOf("const configuredPlatforms = contentScanPlatforms.filter") <
        scans.indexOf("buildSourceQuery(configuredPlatforms)"),
    );
  });

  test("reports why a scan cycle did not launch work", () => {
    const scans = readFileSync("lib/automation/content-scans.ts", "utf8");
    assert.match(scans, /\? "no_connectors" as const/);
    assert.match(scans, /websiteResults\.length > 0[\s\S]{0,80}\? "started" as const/);
    assert.match(scans, /\? \("no_due_sources" as const\)/);
    assert.match(scans, /: \("no_runs_reserved" as const\)/);
  });

  test("does not turn a successful settings redirect into a scan failure", () => {
    const actions = readFileSync(
      "app/(portal)/settings/actions.ts",
      "utf8",
    );
    const start = actions.indexOf("export async function runContentScanNow(formData: FormData)");
    const end = actions.indexOf("export async function updateIntakeSettings", start);
    const action = actions.slice(start, end);
    const catchIndex = action.indexOf("} catch {");
    const statusIndex = action.indexOf('if (result.status === "disabled")');
    assert.notEqual(catchIndex, -1);
    assert.notEqual(statusIndex, -1);
    assert.ok(catchIndex < statusIndex);
  });

  test("can target one source per requested platform without running a broad batch", () => {
    const scans = readFileSync("lib/automation/content-scans.ts", "utf8");
    const actions = readFileSync(
      "app/(portal)/settings/actions.ts",
      "utf8",
    );
    const settings = readFileSync("app/(portal)/settings/page.tsx", "utf8");
    assert.match(scans, /priorityPlatforms\?: ContentScanPlatform\[\]/);
    assert.match(scans, /for \(const platform of configuredPlatforms\)/);
    assert.match(scans, /buildSourceQuery\(\[platform\]\)/);
    assert.match(scans, /targetedPlatformScan \? 1 : settings\.daily_run_limit/);
    assert.match(actions, /formData\s*\.getAll\("platform"\)/);
    assert.match(settings, /value="x_twitter"/);
    assert.match(settings, /value="youtube"/);
    assert.match(settings, /Check one X profile and one YouTube channel/);
  });

  test("lets exact Apify posts reach model review but requires real fallback relevance", () => {
    const refill = readFileSync(
      "lib/automation/engagement-refill.ts",
      "utf8",
    );
    assert.match(refill, /candidate\.provider === "apify"/);
    assert.match(refill, /candidate\.match_method === "registered_source"/);
    assert.match(refill, /if \(!fit\.eligible && !exactRegisteredSocialSource\) return false/);
    assert.match(refill, /!modelAdjudicated &&/);
    assert.match(refill, /engagementRelationshipFit\(\{/);
    assert.match(refill, /Date\.now\(\) - 30 \* 86_400_000/);
    assert.match(refill, /outreach_focus: settings\.onboarding\.outreach_focus/);
    assert.match(refill, /lbb_record_engagement_signal_v3/);
    const serializedPromotion = normalizedActiveMigrationSql;
    assert.match(serializedPromotion, /pg_advisory_xact_lock/);
    assert.match(serializedPromotion, /entity_duplicate/);
    assert.match(serializedPromotion, /dismissed_at is null/);
    assert.match(serializedPromotion, /engaged_at is null/);
  });
});
