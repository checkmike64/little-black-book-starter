import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260904122042_atomic_production_check_evidence.sql",
  "utf8",
);

describe("atomic production evidence RPC", () => {
  test("is service-role-only, invoker rights, allowlisted, and CAS protected", () => {
    assert.match(migration, /security invoker/i);
    assert.match(migration, /for update/i);
    assert.match(migration, /current_version <> p_expected_version/i);
    assert.match(migration, /errcode = '40001'/i);
    assert.match(migration, /p_check_key = any \(allowed_keys\)/i);
    assert.match(
      migration,
      /revoke all on function public\.lbb_update_production_check\([\s\S]*from public, anon, authenticated/i,
    );
    assert.match(
      migration,
      /grant execute on function public\.lbb_update_production_check\([\s\S]*to service_role/i,
    );
  });

  test("writes the signoff and operator audit in one function with idempotent retries", () => {
    assert.match(migration, /update public\.tenants/);
    assert.match(migration, /insert into public\.audit_log/);
    assert.match(migration, /'operator'/);
    assert.match(migration, /'idempotent', true/);
    assert.match(migration, /'idempotent', false/);
    assert.match(migration, /char_length\(normalized_evidence_ref\) not between 6 and 500/i);
    assert.match(migration, /'evidence_ref', null/);
  });
});
