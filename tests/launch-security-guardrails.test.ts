import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { normalizedActiveMigrationSql } from "./migration-source.js";
import { resolveClaudeTenantId } from "../lib/claude-tenant-scope.js";

const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "22222222-2222-4222-8222-222222222222";

describe("launch security guardrails", () => {
  test("scopes Claude tenant access to the configured default tenant", () => {
    assert.equal(resolveClaudeTenantId(undefined, tenantA), tenantA);
    assert.equal(resolveClaudeTenantId(tenantA, tenantA), tenantA);
    assert.equal(resolveClaudeTenantId(tenantB, tenantA), null);
    assert.equal(resolveClaudeTenantId("not-a-uuid", tenantA), null);
  });

  test("allows explicit tenant ids only when no default tenant is configured", () => {
    assert.equal(resolveClaudeTenantId(tenantA, undefined), tenantA);
    assert.equal(resolveClaudeTenantId(undefined, undefined), null);
    assert.equal(resolveClaudeTenantId(tenantA, undefined, true), null);
  });

  test("enforces same-tenant contacts for relationship actions", () => {
    const migration = normalizedActiveMigrationSql;

    assert.match(migration, /foreign key \(tenant_id, contact_id\)/i);
    assert.match(migration, /references public\.contacts\s*\(tenant_id, id\)/i);
    assert.match(
      migration,
      /select count\(\*\) from public\.contacts where tenant_id = p_tenant_id and id = any\(p_contact_ids\)/i,
    );

    const indexMigration = normalizedActiveMigrationSql;
    assert.match(indexMigration, /\(tenant_id, contact_id\)/i);
  });

  test("validates Ask action contacts before service-role inserts", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(portal)/ask/actions.ts"),
      "utf8",
    );
    const decisionStart = source.indexOf("export async function markAskRunDecision");
    const decisionSource = source.slice(decisionStart);
    const contactReadIndex = decisionSource.indexOf('.from("contacts")');
    const actionInsertIndex = decisionSource.indexOf('.from("relationship_actions")\n          .insert');

    assert.ok(contactReadIndex >= 0, "Ask decisions must verify selected contacts");
    assert.ok(actionInsertIndex > contactReadIndex, "verify the tenant contact before insert");
    assert.match(decisionSource, /contact_id: verifiedContactId/);
    assert.match(
      decisionSource,
      /needs_evidence_verification: needsEvidenceVerification/,
    );
    assert.match(
      decisionSource,
      /needsEvidenceVerification\s*\? "owner_verification"/,
    );
  });

  test("does not expose lookalike Claude API routes through the auth proxy", () => {
    const source = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");

    assert.match(source, /pathname\.startsWith\("\/api\/claude\/"\)/);
    assert.doesNotMatch(source, /pathname\.startsWith\("\/api\/claude"\) \|\|/);
  });

  test("hardens the repeatable Supabase launch template", () => {
    const migration = normalizedActiveMigrationSql;

    assert.match(migration, /public\.contacts/);
    assert.match(migration, /public\.ask_runs/);
    assert.match(migration, /public\.relationship_actions/);
    assert.match(migration, /to authenticated/);
    assert.match(
      migration,
      /revoke all privileges on all sequences in schema public from anon/,
    );
    assert.match(migration, /drop policy if exists gateway append audit log/);
    assert.match(
      migration,
      /revoke all on tables from public, anon, authenticated/,
    );
    assert.match(
      migration,
      /revoke execute on functions from public, anon, authenticated/,
    );
  });
});
