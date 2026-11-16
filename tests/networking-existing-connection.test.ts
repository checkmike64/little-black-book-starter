import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { normalizedActiveMigrationSql } from "./migration-source.js";

describe("existing connection decisions", () => {
  test("stores owner confirmations as durable, canonical connection state", () => {
    const migration = normalizedActiveMigrationSql;

    assert.match(migration, /already_connected/);
    assert.match(migration, /connections_canonicalize_pair/);
    assert.match(migration, /check \(\(contact_a < contact_b\)\)/);
    assert.match(migration, /for update/);
    assert.match(migration, /connection\.already_connected_confirmed/);
    assert.match(migration, /grant execute[\s\S]*to service_role/);
    assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/);

    const indexMigration = normalizedActiveMigrationSql;
    assert.match(indexMigration, /connections_confirmed_by_idx/);
    assert.match(indexMigration, /where \(confirmed_by is not null\)/);
  });

  test("tenant-scopes the action and keeps update plus audit inside the database function", () => {
    const action = readFileSync(
      join(process.cwd(), "app/(portal)/networking/actions.ts"),
      "utf8",
    );

    assert.match(action, /requireTenantActionContext/);
    assert.match(action, /p_tenant_id: context\.tenantId/);
    assert.match(action, /p_actor_user_id: context\.userId/);
    assert.match(action, /lbb_confirm_connection_context/);
    assert.match(action, /lbb_restore_connection_recommendation/);
    assert.match(action, /restoreConnectionRecommendation/);
    assert.doesNotMatch(action, /\.from\("connections"\)\s*\.update/);
  });

  test("shows only unresolved suggestions in the recommendation and navigation counts", () => {
    const data = readFileSync(
      join(process.cwd(), "lib/networking/data.ts"),
      "utf8",
    );
    const layout = readFileSync(
      join(process.cwd(), "app/(portal)/layout.tsx"),
      "utf8",
    );
    const page = readFileSync(
      join(process.cwd(), "app/(portal)/networking/page.tsx"),
      "utf8",
    );
    const dialog = readFileSync(
      join(
        process.cwd(),
        "app/(portal)/networking/already-connected-dialog.tsx",
      ),
      "utf8",
    );

    assert.match(data, /\.eq\("status", "suggested"\)/);
    assert.match(data, /snoozed_until\.is\.null,snoozed_until\.lte/);
    assert.match(layout, /\.eq\("status", "suggested"\)/);
    assert.match(layout, /snoozed_until\.is\.null,snoozed_until\.lte/);
    assert.match(dialog, /They already know each other/);
    assert.match(page, /undo_connection/);
    assert.match(data, /\.eq\("tenant_id", context\.tenantId\)/);
    assert.match(data, /loadError: true/);
  });

  test("turns Not useful now into an audited 45-day database snooze", () => {
    const migration = normalizedActiveMigrationSql;
    const action = readFileSync(
      join(process.cwd(), "app/(portal)/networking/actions.ts"),
      "utf8",
    );
    const page = readFileSync(
      join(process.cwd(), "app/(portal)/networking/page.tsx"),
      "utf8",
    );

    assert.match(migration, /now\(\) \+ interval '45 days'/);
    assert.match(migration, /connection\.recommendation_snoozed/);
    assert.match(migration, /snooze_connection_recommendation/);
    assert.match(action, /snoozeConnectionRecommendation/);
    assert.match(action, /Skipped for 45 days/);
    assert.match(page, /Not useful now/);
    assert.match(page, /action=\{snoozeConnectionRecommendation\}/);
    assert.doesNotMatch(page, /networking\?skip=/);
  });

  test("keeps a permanent suggestion block separate from already connected and temporary snooze", () => {
    const migration = normalizedActiveMigrationSql;
    const action = readFileSync(
      join(process.cwd(), "app/(portal)/networking/actions.ts"),
      "utf8",
    );
    const page = readFileSync(
      join(process.cwd(), "app/(portal)/networking/page.tsx"),
      "utf8",
    );

    assert.match(migration, /status = 'dismissed'/);
    assert.match(migration, /connection\.do_not_connect_confirmed/);
    assert.match(migration, /block_connection_recommendation/);
    assert.match(migration, /from public, anon, authenticated/);
    assert.match(action, /blockConnectionRecommendation/);
    assert.match(action, /Marked do not connect/);
    assert.match(page, /Do not suggest again/);
    assert.match(page, /action=\{blockConnectionRecommendation\}/);
  });

  test("approves a recommendation and creates its introduction atomically", () => {
    const migration = normalizedActiveMigrationSql;
    const action = readFileSync(
      join(process.cwd(), "app/(portal)/introductions/actions.ts"),
      "utf8",
    );

    assert.match(migration, /lbb_create_introduction_from_connection/);
    assert.match(migration, /Contacts do not match the recommendation/);
    assert.match(migration, /for update/);
    assert.match(migration, /insert into public\.introductions/);
    assert.match(migration, /update public\.connections/);
    assert.match(migration, /introduction\.recommendation_approved/);
    assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/);
    assert.match(action, /lbb_create_introduction_from_connection/);
    assert.doesNotMatch(
      action,
      /\.from\("connections"\)[\s\S]{0,100}\.update/,
    );
  });
});
