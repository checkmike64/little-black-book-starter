import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { normalizedActiveMigrationSql } from "./migration-source.js";

describe("engagement content feed", () => {
  test("shows only source-linked content and never substitutes contact notes", () => {
    const data = readFileSync(
      join(process.cwd(), "lib/engagement/data.ts"),
      "utf8",
    );
    const page = readFileSync(
      join(process.cwd(), "app/(portal)/engagement/page.tsx"),
      "utf8",
    );

    assert.match(data, /\.not\("source_url", "is", null\)/);
    assert.match(data, /\.is\("dismissed_at", null\)/);
    assert.match(page, /normalizeExternalContentUrl/);
    assert.match(page, /Open post/);
    assert.doesNotMatch(page, /contactItems/);
    assert.doesNotMatch(page, /Open Profile/);
    assert.doesNotMatch(page, /Why this one/);
    assert.doesNotMatch(page, /candidate\?\.why/);
  });

  test("keeps the card compact and action-focused", () => {
    const page = readFileSync(
      join(process.cwd(), "app/(portal)/engagement/page.tsx"),
      "utf8",
    );

    assert.match(page, /Two different relationship jobs/);
    assert.match(page, /engagement-post-excerpt/);
    assert.match(page, /Open post/);
    assert.match(page, /I engaged/);
    assert.match(page, /Do not engage/);
    assert.match(page, /Why it appears/);
    assert.match(page, /engagementPlacementReason/);
    assert.doesNotMatch(page, /signal\.why_now/);
    assert.doesNotMatch(page, />\s*Skip\s*</);
    assert.doesNotMatch(page, /lane-intro/);
    assert.doesNotMatch(page, /relationship priorities/);
    assert.doesNotMatch(page, /nextAction/);
  });

  test("separates a small in-network set from a larger Want to Know set", () => {
    const settings = readFileSync(
      join(process.cwd(), "lib/activity-settings.ts"),
      "utf8",
    );
    const page = readFileSync(
      join(process.cwd(), "app/(portal)/engagement/page.tsx"),
      "utf8",
    );
    const actions = readFileSync(
      join(process.cwd(), "app/(portal)/recommendation-actions.ts"),
      "utf8",
    );
    const globalCss = readFileSync(
      join(process.cwd(), "app/globals.css"),
      "utf8",
    );
    const ledgerCss = readFileSync(
      join(process.cwd(), "app/private-ledger.css"),
      "utf8",
    );

    assert.match(settings, /engagement_daily_limit: 3/);
    assert.match(settings, /want_to_know_daily_limit: 6/);
    assert.match(settings, /engagement_more_batch: 3/);
    assert.match(page, /In your network/);
    assert.match(page, /Want to Know/);
    assert.match(page, /Find \{moreBatch\} more in-network posts/);
    assert.match(page, /signals\.map\(\(signal\)/);
    assert.match(page, /engagement-daily-set/);
    assert.doesNotMatch(page, /engagement-daily-number/);
    assert.doesNotMatch(globalCss, /\.engagement-daily-number/);
    assert.doesNotMatch(ledgerCss, /\.engagement-daily-number/);
    assert.doesNotMatch(
      ledgerCss,
      /\.engagement-daily-item\s*\{[^}]*padding(?:-left)?:/s,
    );
    assert.doesNotMatch(
      ledgerCss,
      /\.engagement-daily-item \.engagement-post-card\s*\{[^}]*border-left:/s,
    );
    assert.doesNotMatch(page, /laneItems\[0\]/);
    assert.doesNotMatch(page, /more post.*waiting/);
    assert.doesNotMatch(page, /reserveCount > 0/);
    assert.match(actions, /settings\.activity\.engagement_more_batch/);
    assert.match(actions, /refillEngagementRecommendations/);
    assert.match(actions, /targetPending: request\.amount/);
    assert.match(actions, /ignoreCadence: true/);
    assert.match(actions, /engagementCapacityNeeded/);
    assert.match(actions, /noAdditionalEngagementMessage/);
    assert.match(actions, /Today’s research has not reached the engagement feed yet\./);
    assert.match(actions, /Today’s research reached the feed, but no additional posts passed/);
    assert.match(actions, /Math\.min\(request\.amount, refill\.pending\)/);
  });

  test("distinguishes a delayed feed from completing today's queue", () => {
    const page = readFileSync(
      join(process.cwd(), "app/(portal)/engagement/page.tsx"),
      "utf8",
    );
    const health = readFileSync(
      join(process.cwd(), "app/(portal)/engagement/feed-health.ts"),
      "utf8",
    );

    assert.match(page, /Today’s research has not reached the feed yet\./);
    assert.match(page, /Nothing else has passed the relevance checks yet\./);
    assert.match(page, /The last feed update was \$\{formatAge/);
    assert.match(page, /feedHealth\.receivedToday/);
    assert.match(health, /\.from\("content_items"\)/);
    assert.match(health, /\.from\("signals"\)/);
    assert.match(health, /\.gte\("created_at", dayStart\)/);
    assert.match(health, /latestReceivedAt/);
  });

  test("filters recommendations against private relationship context locally", () => {
    const refill = readFileSync(
      join(process.cwd(), "lib/automation/engagement-refill.ts"),
      "utf8",
    );
    const data = readFileSync(
      join(process.cwd(), "lib/engagement/data.ts"),
      "utf8",
    );
    const llm = readFileSync(
      join(process.cwd(), "lib/automation/llm.ts"),
      "utf8",
    );

    assert.match(refill, /engagementRelationshipFit/);
    assert.match(refill, /wantToKnowEngagementFit/);
    assert.match(refill, /why_stay_in_touch/);
    assert.match(refill, /current_asks/);
    assert.match(refill, /ideal_referral/);
    assert.match(refill, /owner_requested_batch: true/);
    assert.ok(
      refill.indexOf(".sort((a, b) => candidateScore(b) - candidateScore(a))") <
        refill.indexOf("seenEntities.add(key)"),
      "candidates must be ranked before one post per person is selected",
    );
    assert.match(data, /engagementRelationshipFit/);
    assert.match(data, /wantToKnowEngagementFit/);
    assert.match(data, /networkSignals/);
    assert.match(data, /wantToKnowSignals/);
    assert.match(data, /signal\.payload\?\.owner_requested_batch !== true/);
    assert.doesNotMatch(llm, /relationship_context/);
  });

  test("uses clean solid borders throughout the interface", () => {
    const styles = readFileSync(
      join(process.cwd(), "app/globals.css"),
      "utf8",
    );

    assert.doesNotMatch(styles, /\b(?:dashed|dotted)\b/);
  });

  test("records opening separately from completing an engagement", () => {
    const route = readFileSync(
      join(process.cwd(), "app/(portal)/engagement/open/[id]/route.ts"),
      "utf8",
    );
    const action = readFileSync(
      join(process.cwd(), "app/(portal)/engagement/actions.ts"),
      "utf8",
    );
    const migration = normalizedActiveMigrationSql;

    assert.match(route, /p_action: "opened"/);
    assert.match(route, /normalizeExternalContentUrl/);
    assert.match(action, /setSignalState\(formData, "engaged"\)/);
    assert.match(action, /setSignalState\(formData, "dismissed"\)/);
    assert.match(migration, /lbb_set_engagement_signal_state/);
    assert.match(migration, /engagement\.signal_opened/);
    assert.match(migration, /engagement\.signal_engaged/);
    assert.match(migration, /engagement\.signal_do_not_engage/);
    assert.doesNotMatch(migration, /delete from interactions/i);
  });

  test("tenant-scopes queue reads and preserves terminal lifecycle history", () => {
    const data = readFileSync(
      join(process.cwd(), "lib/engagement/data.ts"),
      "utf8",
    );
    const hardening = normalizedActiveMigrationSql;

    assert.match(data, /\.eq\("tenant_id", context\.tenantId\)/);
    assert.match(data, /loadError: true/);
    assert.match(hardening, /restore_engaged/);
    assert.match(hardening, /restore_dismissed/);
    assert.match(
      hardening,
      /before_row\.engaged_at is null[\s\S]*before_row\.dismissed_at is null/,
    );
    assert.match(hardening, /on delete set null/);
    assert.match(hardening, /num_nonnulls\(contact_id, want_to_know_id\) = 1/);
  });

  test("dismisses only one post with tenant-scoped audit and immediate undo", () => {
    const migration = normalizedActiveMigrationSql;
    const action = readFileSync(
      join(process.cwd(), "app/(portal)/engagement/actions.ts"),
      "utf8",
    );
    const page = readFileSync(
      join(process.cwd(), "app/(portal)/engagement/page.tsx"),
      "utf8",
    );

    assert.match(migration, /set_engagement_signal_dismissed/);
    assert.match(migration, /where id = p_signal_id[\s\S]*tenant_id = p_tenant_id/);
    assert.match(migration, /engagement\.signal_do_not_engage/);
    assert.match(migration, /engagement\.signal_restored/);
    assert.match(migration, /for update/);
    assert.match(migration, /grant execute[\s\S]*to service_role/);
    assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/);
    const auditMigration = normalizedActiveMigrationSql;
    assert.match(auditMigration, /jsonb_build_object\([\s\S]*dismissed_at/);
    assert.match(action, /requireTenantActionContext/);
    assert.match(action, /p_tenant_id: context\.tenantId/);
    assert.match(action, /p_actor_user_id: context\.userId/);
    assert.match(action, /restoreEngagementSignal/);
    assert.match(page, /undo_signal/);
    assert.match(page, /Undo/);
  });
});
