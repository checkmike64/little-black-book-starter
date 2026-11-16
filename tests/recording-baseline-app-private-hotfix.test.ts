import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const baselineMigration = readFileSync(
  "supabase/migrations/20260904015451_recording_baseline_intelligence.sql",
  "utf8",
).toLowerCase();
const hotfixMigration = readFileSync(
  "supabase/migrations/20260904064420_grant_service_role_app_private_usage.sql",
  "utf8",
).toLowerCase();

test("lets only the service role resolve the private baseline policy boundary", () => {
  assert.match(
    hotfixMigration,
    /revoke usage on schema app_private from public, anon;/,
  );
  assert.match(
    hotfixMigration,
    /grant usage on schema app_private to service_role;/,
  );
  assert.doesNotMatch(
    hotfixMigration,
    /grant usage on schema app_private to (?:public|anon|authenticated)/,
  );
  assert.doesNotMatch(hotfixMigration, /grant (?:all|create) on schema app_private/);
});

test("completes the existing invoker RPC privilege chain without widening object access", () => {
  assert.match(
    baselineMigration,
    /create or replace function public\.lbb_apply_recording_baseline\([\s\S]*?security invoker/,
  );
  assert.match(
    baselineMigration,
    /grant select on table app_private\.recording_baseline_field_policy to service_role;/,
  );
  for (const signature of [
    "app_private.recording_baseline_value_is_valid(text,text,jsonb,integer)",
    "app_private.normalize_recording_baseline_value(text,text,jsonb)",
  ]) {
    const escaped = signature.replace(/[()[\]]/g, "\\$&");
    assert.match(
      baselineMigration,
      new RegExp(
        `revoke all on function ${escaped}[\\s\\S]*?from public, anon, authenticated;`,
      ),
    );
    assert.match(
      baselineMigration,
      new RegExp(`grant execute on function ${escaped}[\\s\\S]*?to service_role;`),
    );
  }
  assert.match(
    baselineMigration,
    /revoke all on function public\.lbb_apply_recording_baseline\(uuid,uuid,text,text,jsonb\)[\s\S]*?from public, anon, authenticated;/,
  );
  assert.match(
    baselineMigration,
    /grant execute on function public\.lbb_apply_recording_baseline\(uuid,uuid,text,text,jsonb\)[\s\S]*?to service_role;/,
  );
});
