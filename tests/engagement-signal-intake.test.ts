import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { normalizedActiveMigrationSql } from "./migration-source.js";
import {
  contentPlatformLabel,
  engageableSocialPostPlatform,
  normalizeExternalContentUrl,
} from "../lib/engagement-source.js";

describe("engagement signal intake", () => {
  test("accepts public content URLs and removes tracking noise", () => {
    assert.equal(
      normalizeExternalContentUrl(
        "https://www.linkedin.com/posts/example?utm_source=email&keep=yes#reply",
      ),
      "https://www.linkedin.com/posts/example?keep=yes",
    );
    assert.equal(
      contentPlatformLabel("https://www.linkedin.com/posts/example"),
      "LinkedIn",
    );
  });

  test("rejects unsafe and local content URLs", () => {
    assert.equal(normalizeExternalContentUrl("javascript:alert(1)"), null);
    assert.equal(normalizeExternalContentUrl("http://localhost/post"), null);
    assert.equal(normalizeExternalContentUrl("http://127.0.0.1/post"), null);
    assert.equal(normalizeExternalContentUrl("https://example.com/post"), null);
    assert.equal(
      normalizeExternalContentUrl("https://user:pass@example.com/post"),
      null,
    );
  });

  test("accepts individual social posts and rejects non-engageable content", () => {
    const accepted = [
      ["https://www.linkedin.com/posts/samplecreator_activity-123", "LinkedIn"],
      ["https://www.facebook.com/joseph/posts/123", "Facebook"],
      ["https://www.instagram.com/p/ABC123/", "Instagram"],
      ["https://x.com/joseph/status/123456", "X"],
      ["https://www.threads.net/@joseph/post/ABC123", "Threads"],
      ["https://www.tiktok.com/@joseph/video/123456", "TikTok"],
      ["https://www.youtube.com/watch?v=ABC123", "YouTube"],
    ] as const;

    for (const [url, platform] of accepted) {
      assert.equal(engageableSocialPostPlatform(url), platform);
    }

    const rejected = [
      "https://podcasts.apple.com/us/podcast/the-joseph-graham-show/id1572564061",
      "https://open.spotify.com/episode/abc123",
      "https://samplecreator.com/podcast/episode-1",
      "https://www.linkedin.com/in/joseph-graham",
      "https://www.facebook.com/joseph",
      "https://www.youtube.com/@samplecreator",
      "https://bsky.app/profile/joseph.test/post/abc123",
      "https://www.reddit.com/r/example/comments/abc123/a_post/",
    ];

    for (const url of rejected) {
      assert.equal(engageableSocialPostPlatform(url), null);
    }
  });

  test("keeps the Claude route narrow, tenant-scoped, and idempotent", () => {
    const route = readFileSync(
      join(process.cwd(), "app/api/claude/signals/route.ts"),
      "utf8",
    );
    const migration = normalizedActiveMigrationSql;

    assert.match(route, /authenticateClaudeRequest/);
    assert.match(route, /tenantIdFrom/);
    assert.match(route, /\.eq\("tenant_id", tenantId\)/);
    assert.match(route, /normalizeExternalContentUrl/);
    assert.match(route, /engageableSocialPostPlatform/);
    assert.match(route, /signal_type must be social_post/);
    assert.match(route, /podcast pages, Bluesky, and Reddit are research evidence only/);
    assert.match(route, /lbb_record_engagement_signal_v2/);
    assert.match(route, /want_to_know_id/);
    assert.match(route, /why_now/);
    assert.match(route, /p_published_at: publishedAt \|\| observedAt/);
    assert.match(route, /published_at must be a valid ISO date or timestamp/);
    assert.match(route, /run_id is required/);
    assert.match(route, /engagement\.signal_delivery_succeeded/);
    assert.match(route, /engagement\.signal_delivery_failed/);
    assert.match(route, /engagement_signal_delivered/);
    assert.match(route, /engagement_signal_failed/);
    assert.match(route, /heartbeat: heartbeatRecorded \? "recorded" : "degraded"/);
    assert.match(migration, /signals_tenant_source_url_key/);
    assert.match(migration, /on conflict \(tenant_id, source_url\)/);
    assert.match(migration, /Contact does not belong to this tenant/);
    assert.match(migration, /engagement\.signal_recorded/);
    assert.match(migration, /grant execute[\s\S]*to service_role/);
    assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/);
    const recencyMigration = normalizedActiveMigrationSql;
    assert.match(recencyMigration, /post_age > interval '30 days'/);
    assert.match(recencyMigration, /expiry_interval interval := interval '30 days'/);
    assert.doesNotMatch(recencyMigration, /Older posts require/);
    assert.match(recencyMigration, /num_nonnulls\(p_contact_id, p_want_to_know_id\) <> 1/);
    assert.match(recencyMigration, /lbb_record_engagement_signal_v2/);
    assert.match(recencyMigration, /revoke all[\s\S]*from public, anon, authenticated/);
  });

  test("separates full content delivery from exceptional signal picks", () => {
    const contentRoute = readFileSync(
      join(process.cwd(), "app/api/claude/content/route.ts"),
      "utf8",
    );
    const instructions = readFileSync(
      join(process.cwd(), "lib/claude-setup-package.ts"),
      "utf8",
    );
    const handoff = readFileSync(
      join(process.cwd(), "docs/CLAUDE_INTELLIGENCE_HANDOFF.md"),
      "utf8",
    );
    const engagementPulse = readFileSync(
      join(process.cwd(), "docs/claude-engagement-pulse-instructions.md"),
      "utf8",
    );

    assert.match(contentRoute, /run_id is required/);
    assert.match(contentRoute, /content\.batch_ingested/);
    assert.match(contentRoute, /content\.batch_failed/);
    assert.match(contentRoute, /content_batch_ingested/);
    assert.match(contentRoute, /content_batch_failed/);
    assert.match(contentRoute, /invalid_source_url/);
    assert.match(contentRoute, /invalid_published_at/);
    assert.match(contentRoute, /contact_not_in_tenant/);
    assert.match(contentRoute, /rejections: rejections\.slice\(0, 25\)/);
    assert.match(
      contentRoute,
      /heartbeat: heartbeatRecorded \? "recorded" : "degraded"/,
    );
    assert.match(instructions, /send every retrieved post/i);
    assert.match(instructions, /exceptional final picks/i);
    assert.match(instructions, /one individual, publicly engageable post/i);
    assert.match(instructions, /Apple Podcasts link/i);
    assert.match(instructions, /Never probe validation with example\.com/i);
    assert.match(instructions, /heartbeat=recorded/);
    assert.match(handoff, /Every daily run must POST every retrieved post/i);
    assert.match(handoff, /only the exceptional final engagement picks/i);
    assert.match(handoff, /podcast pages or episodes/i);
    assert.match(handoff, /YOUR-PRODUCTION-LITTLE-BLACK-BOOK/);
    assert.match(handoff, /never fall back to direct Supabase reads or writes/i);
    assert.match(
      engagementPulse,
      /only for a specific, publicly engageable social-media\s+post/i,
    );
    assert.match(engagementPulse, /signal_type` must be `social_post/);
    assert.match(engagementPulse, /Apple Podcasts link/);
    assert.doesNotMatch(engagementPulse, /- Newsletter edition/);
    assert.doesNotMatch(engagementPulse, /- Podcast episode/);
  });

  test("provides bounded tenant-safe research context without private fields", () => {
    const route = readFileSync(
      join(process.cwd(), "app/api/claude/research-context/route.ts"),
      "utf8",
    );
    const shared = readFileSync(
      join(process.cwd(), "app/api/claude/_shared.ts"),
      "utf8",
    );

    assert.match(route, /authenticateClaudeRequest/);
    assert.match(route, /tenantIdFrom/);
    assert.match(route, /\.eq\("tenant_id", tenantId\)/);
    assert.match(route, /\.is\("archived_at", null\)/);
    assert.match(route, /\.neq\("stage", "graduated"\)/);
    assert.match(route, /Math\.min\(parsed, max\)/);
    assert.match(route, /normalizeExternalContentUrl/);
    assert.match(route, /research_context\.read/);
    assert.match(route, /research_context_read/);
    assert.match(route, /last_engaged_at/);
    assert.match(route, /\.not\("engaged_at", "is", null\)/);
    assert.match(route, /privateJson/);
    assert.match(shared, /"Cache-Control": "no-store"/);
    assert.doesNotMatch(route, /\.select\("\*"\)/);
    assert.doesNotMatch(route, /\bemail\b/);
    assert.doesNotMatch(route, /\bphone\b/);
    assert.doesNotMatch(route, /private_notes/);
    assert.doesNotMatch(route, /transcript/);
  });

  test("keeps Claude enrichment job packets least-privileged", () => {
    const route = readFileSync(
      join(process.cwd(), "app/api/claude/jobs/route.ts"),
      "utf8",
    );

    assert.doesNotMatch(route, /"phone"/);
    assert.doesNotMatch(route, /"birthday"/);
    assert.doesNotMatch(route, /"spouse_partner"/);
    assert.doesNotMatch(route, /"children"/);
    assert.doesNotMatch(route, /"personal_notes"/);
    assert.doesNotMatch(route, /"private_notes"/);
    assert.doesNotMatch(route, /source, evidence, created_at/);
    assert.doesNotMatch(route, /source, payload, created_at/);
    assert.doesNotMatch(route, /confidence, metadata, created_at/);
    assert.doesNotMatch(route, /source_ref, metadata, created_at/);
    assert.match(route, /"linkedin"/);
    assert.match(route, /"current_asks"/);
    assert.match(route, /const safePayload = claudeJobPayload\(job\.payload\)/);
    assert.doesNotMatch(route, /payload: job\.payload/);
    assert.match(route, /blocked_fields: safeStringList/);
    assert.match(route, /fields: safeRevisionFields/);
    assert.match(route, /do_not_approve_original_proposal/);
    assert.match(route, /do not recreate redacted fields/);
  });
});
