import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  offboardingAuthTables,
  offboardingStorageTables,
  offboardingTenantTables,
  offboardingVaultTables,
} from "../lib/commercial/offboarding-evidence.js";

const sql = readFileSync("scripts/export-offboarding-inventory.sql", "utf8");
const executableSql = sql.replace(/^\s*--.*$/gm, "");

describe("offboarding inventory SQL", () => {
  test("is an operator-invoked read-only, fail-closed observation", () => {
    assert.match(executableSql, /begin transaction isolation level repeatable read read only;/i);
    assert.match(sql, /\\set QUIET 1/);
    assert.match(executableSql, /set local lock_timeout = '2s';/i);
    assert.match(executableSql, /set local statement_timeout = '60s';/i);
    assert.match(executableSql, /rollback;/i);
    assert.match(executableSql, /where guard\.valid/i);
    assert.match(executableSql, /platform_projection_guard as/i);
    assert.match(executableSql, /where guard\.valid and platform_projection_guard\.valid/i);
    assert.match(executableSql, /char_length\(observation_id\) between 6 and 500/i);
    assert.doesNotMatch(executableSql, /\{\d+,\d{3,}\}/);
    assert.doesNotMatch(
      executableSql,
      /\b(?:insert|update|delete|alter|create|drop|truncate|copy|call|grant|revoke)\b/i,
    );
  });

  test("covers the reviewed public and platform catalogs exactly", () => {
    for (const table of offboardingTenantTables) {
      assert.match(sql, new RegExp(`\\('${table}'\\)`));
      assert.match(sql, new RegExp(`select '${table}'`));
    }
    assert.match(sql, /schema\.discovered_tenant_tables|discovered_tenant_tables/);
    assert.match(sql, /pg_catalog\.pg_attribute/);
    assert.match(sql, /n\.nspname in \('auth', 'storage', 'vault'\)/);
    assert.match(sql, /c\.relkind in \('r', 'p'\)/);
    assert.match(sql, /pg_catalog\.pg_sequences/);
    assert.match(sql, /application_catalog_facts/);
    assert.match(sql, /pg_catalog\.pg_policies/);
    assert.match(sql, /pg_get_functiondef/);
    assert.match(sql, /pg_get_triggerdef/);
    assert.match(sql, /platform_safe_rows/);
    for (const table of offboardingAuthTables) assert.match(sql, new RegExp(`\\('auth','${table}'\\)`));
    for (const table of offboardingStorageTables) assert.match(sql, new RegExp(`\\('storage','${table}'\\)`));
    for (const table of offboardingVaultTables) assert.match(sql, new RegExp(`\\('vault','${table}'\\)`));
    assert.match(sql, /to_jsonb\(t\)::text from public\.contacts/);
    assert.equal(sql.match(/to_jsonb\(t\)::text from public\./g)?.length, 38);
    assert.equal(
      sql.match(/(?:select|union all select) '(?:auth|storage|vault)'\s*,\s*'[^']+'/g)?.length,
      32,
    );
    assert.match(sql, /from allowed_platform_tables table_scope/);
    assert.match(sql, /'auth','schema_migrations'.*jsonb_build_object\('version',t\.version\)/);
    assert.match(sql, /'storage','buckets_vectors'.*jsonb_build_object\('id',t\.id,'type',t\.type,'created_at',t\.created_at,'updated_at',t\.updated_at\)/);
    assert.match(sql, /'storage','migrations'.*jsonb_build_object\('id',t\.id,'name',t\.name,'hash',t\.hash,'executed_at',t\.executed_at\)/);
  });

  test("never emits decrypted secrets or content-bearing relationship fields", () => {
    assert.doesNotMatch(sql, /vault\.decrypted_secrets/i);
    assert.doesNotMatch(sql, /decrypted_secret|secret_value|encrypted_secret|ciphertext/i);
    assert.doesNotMatch(
      executableSql,
      /\b(?:full_name|email|phone|notes|summary|transcript_text|raw_payload|user_agent|ip_address|token)\b/i,
    );
    assert.doesNotMatch(executableSql, /https?:\/\//i);
    assert.doesNotMatch(sql, /auth','one_time_tokens'.*'relates_to'/);
    assert.doesNotMatch(sql, /auth','sessions'.*'tag'/);
    assert.doesNotMatch(sql, /to_jsonb\(t\)::text from (?:auth|storage|vault)\./);
    assert.match(sql, /never emitted/i);
    assert.doesNotMatch(sql, /'tenant_id',\s*parameters\.tenant_id/i);
    assert.match(sql, /'tenant_fingerprint',\s*tenant_observation\.tenant_fingerprint/i);
  });
});
