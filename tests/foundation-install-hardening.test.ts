import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const migrationPath =
  "supabase/migrations/20260822143000_canonical_tenant_settings_and_workflow_grants.sql";
const driftClosurePath =
  "supabase/migrations/20260823172839_reconcile_hosted_schema_drift.sql";
const stalePolicyClosurePath =
  "supabase/migrations/20260823172945_remove_stale_membership_write_policies.sql";

describe("repeatable install foundation", () => {
  test("keeps tenants.settings canonical and tenant_config read-only", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const bootstrap = readFileSync("lib/supabase-install-sql.ts", "utf8");
    const settingsActions = readFileSync("app/(portal)/settings/actions.ts", "utf8");

    assert.match(migration, /settings_version integer not null default 1/i);
    assert.match(migration, /sync_tenant_config_from_settings/i);
    assert.match(migration, /after insert or update of settings, settings_version/i);
    assert.match(migration, /drop policy if exists "owner and operator update config"/i);
    assert.match(
      migration,
      /revoke insert, update, delete, truncate, references, trigger\s+on table public\.tenant_config from authenticated/is,
    );
    assert.doesNotMatch(bootstrap, /insert into public\.tenant_config/i);
    assert.match(bootstrap, /"raw_transcript_days": 30/);
    assert.match(bootstrap, /"prompt_versions"/);
    assert.match(settingsActions, /lbb_update_tenant_settings/);
    assert.match(settingsActions, /changed in another session/i);
    assert.match(migration, /current_version <> p_expected_version/i);
    assert.match(migration, /tenant\.settings\.updated/i);
  });

  test("makes the authenticated Data API relationship surface read-only", () => {
    const migration = readFileSync(migrationPath, "utf8");

    assert.match(
      migration,
      /revoke insert, update, delete, truncate, references, trigger on table[\s\S]*public\.contacts[\s\S]*public\.audit_log[\s\S]*from authenticated;/i,
    );
    assert.match(
      migration,
      /grant select on table[\s\S]*public\.contacts[\s\S]*public\.audit_log[\s\S]*to authenticated;/i,
    );
    assert.match(
      migration,
      /revoke all on table public\.google_oauth_transactions\s+from public, anon, authenticated;/i,
    );
    assert.match(migration, /create policy "operators read tenant configuration"/i);
    assert.match(migration, /create policy "operators read compatibility config"/i);
    assert.match(migration, /create policy "operators read jobs"/i);
    assert.match(migration, /create policy "operators read usage"/i);
    assert.match(migration, /create policy "operators read audit log"/i);
    assert.doesNotMatch(migration, /create policy "members read tenant"/i);
  });

  test("authorizes Claude writes atomically and only for service_role", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const shared = readFileSync("app/api/claude/_shared.ts", "utf8");
    const claudeAuth = readFileSync("lib/claude-auth.ts", "utf8");

    assert.match(migration, /create table if not exists public\.claude_write_receipts/i);
    assert.match(migration, /pg_advisory_xact_lock/i);
    assert.match(migration, /tenant_settings #>> '\{activity,time_zone\}'/i);
    assert.match(migration, /at time zone tenant_time_zone/i);
    assert.match(migration, /mechanical_writes_disabled/i);
    assert.match(migration, /daily_quota_exceeded/i);
    assert.match(
      migration,
      /revoke execute on function public\.lbb_authorize_claude_write\([\s\S]*from public, anon, authenticated;/i,
    );
    assert.match(
      migration,
      /grant execute on function public\.lbb_authorize_claude_write\([\s\S]*to service_role;/i,
    );
    assert.match(claudeAuth, /timingSafeEqual/);
    assert.match(shared, /export async function authorizeClaudeWrite/);
  });

  test("closes hosted migration drift without reopening the browser write surface", () => {
    const migration = readFileSync(driftClosurePath, "utf8");
    const stalePolicies = readFileSync(stalePolicyClosurePath, "utf8");

    assert.match(migration, /add column if not exists idempotency_key text/i);
    assert.match(migration, /interactions_tenant_idempotency_key_idx/i);
    assert.match(migration, /pending_changes_tenant_idempotency_key_idx/i);
    assert.match(migration, /create or replace function public\.lbb_create_pending_change/i);
    assert.match(migration, /on conflict \(tenant_id, idempotency_key\)/i);
    assert.doesNotMatch(migration, /'payload', normalized_payload/i);
    assert.match(migration, /'payload_keys'/i);
    assert.match(migration, /revoke all privileges on all tables in schema public from anon/i);
    assert.match(migration, /revoke execute on all functions in schema public from public, anon/i);
    assert.match(
      migration,
      /revoke insert, update, delete, truncate, references, trigger\s+on all tables in schema public from authenticated/is,
    );
    assert.match(migration, /drop policy if exists "gateway append audit log"/i);
    assert.match(migration, /drop policy if exists "members insert interactions"/i);
    assert.match(migration, /recording_ingest_receipts_tenant_connection_owner_idx/i);
    assert.match(migration, /transcripts_tenant_connection_owner_idx/i);
    assert.doesNotMatch(migration, /grant .* to anon/i);
    assert.doesNotMatch(migration, /grant (insert|update|delete).*authenticated/i);
    assert.match(stalePolicies, /drop policy if exists "owners insert memberships"/i);
    assert.match(stalePolicies, /drop policy if exists "owners update memberships"/i);
    assert.match(stalePolicies, /drop policy if exists "owners delete memberships"/i);
  });

  test("places policy checks before high-impact Claude mutations", () => {
    const cases = [
      ["app/api/claude/interactions/route.ts", 'admin.rpc("lbb_log_interaction"'],
      ["app/api/claude/pending-changes/route.ts", 'admin.rpc("lbb_create_pending_change"'],
      ["app/api/claude/signals/route.ts", 'admin.rpc(\n    "lbb_record_engagement_signal_v2"'],
      ["app/api/claude/calendar/route.ts", 'admin.rpc(\n    "lbb_record_claude_calendar_snapshot"'],
      ["app/api/claude/content/route.ts", ".upsert(rows"],
      ["app/api/claude/networking/route.ts", 'admin.rpc(\n      "lbb_record_grounded_networking_recommendation"'],
    ] as const;

    for (const [path, mutationNeedle] of cases) {
      const source = readFileSync(path, "utf8");
      const policyIndex = source.indexOf("await authorizeClaudeWrite");
      const mutationIndex = source.indexOf(mutationNeedle);
      assert.ok(policyIndex >= 0, `${path} must authorize the write`);
      assert.ok(mutationIndex > policyIndex, `${path} must authorize before mutation`);
    }
  });

  test("passes the static install rehearsal", () => {
    const output = execFileSync(process.execPath, ["scripts/install-rehearsal.mjs"], {
      encoding: "utf8",
    });

    assert.match(output, /Summary: 0 fail, 0 warn/);
  });
});
