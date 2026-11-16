import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { normalizedActiveMigrationSql } from "./migration-source.js";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("relationship data hardening", () => {
  const migration = normalizedActiveMigrationSql;

  test("fails closed before enforcing tenant-composite relationship references", () => {
    assert.match(migration, /constraint connections_contact_a_fkey/);
    assert.match(migration, /constraint introductions_person_a_fkey/);
    assert.match(migration, /foreign key \(tenant_id, contact_a\)/);
    assert.match(migration, /foreign key \(tenant_id, contact_b\)/);
    assert.match(migration, /foreign key \(tenant_id, person_a\)/);
    assert.match(migration, /foreign key \(tenant_id, person_b\)/);
  });

  test("keeps a tenant-safe link from a graduated prospect to the Book contact", () => {
    assert.match(migration, /graduated_contact_id\s+uuid/);
    assert.match(migration, /foreign key \(tenant_id, graduated_contact_id\)/);
    assert.match(
      migration,
      /stage = 'graduated'::text[\s\S]{0,80}graduated_at is not null/i,
    );

    const action = source("app/(portal)/changes/actions.ts");
    assert.match(action, /graduated_contact_id: contactId/);
    assert.match(action, /graduated_at: new Date\(\)\.toISOString\(\)/);
  });

  test("indexes composite foreign-key lookup paths", () => {
    assert.match(migration, /connections_tenant_contact_a_idx/);
    assert.match(migration, /connections_tenant_contact_b_idx/);
    assert.match(migration, /introductions_tenant_person_a_idx/);
    assert.match(migration, /introductions_tenant_person_b_idx/);
    assert.match(migration, /want_to_know_tenant_graduated_contact_idx/);
  });

  test("refreshes computed relationship strength in the daily tenant run", () => {
    const dailyAutomation = source("app/api/automation/daily/route.ts");
    assert.match(dailyAutomation, /lbb_refresh_relationship_strength/);
    assert.match(dailyAutomation, /stage: "relationship_strength"/);
    assert.match(dailyAutomation, /relationship_strength_updated/);
  });
});
