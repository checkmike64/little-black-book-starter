import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { normalizedActiveMigrationSql } from "./migration-source.js";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("networking relationship context", () => {
  test("stores reusable contexts, memberships, and pair-specific evidence", () => {
    const migration = normalizedActiveMigrationSql;

    assert.match(migration, /create table public\.relationship_contexts/);
    assert.match(migration, /create table public\.relationship_context_memberships/);
    assert.match(migration, /create table public\.connection_contexts/);
    assert.match(migration, /unique \(tenant_id, canonical_key\)/);
    assert.match(migration, /foreign key \(tenant_id, contact_id\)/);
    assert.match(migration, /foreign key \(tenant_id, connection_id\)/);
    assert.match(migration, /'mastermind'::text[\s\S]{0,100}'community'::text/);
    assert.match(migration, /'strong'::text[\s\S]{0,100}'none'::text/);
  });

  test("keeps writes behind tenant-checked, service-role-only functions", () => {
    const migration = normalizedActiveMigrationSql;

    assert.match(migration, /enable row level security/g);
    assert.match(migration, /app_private\.is_tenant_member\(tenant_id\)/);
    assert.match(migration, /status = 'active'/);
    assert.match(migration, /revoke all on table public\.connections from authenticated/);
    assert.doesNotMatch(
      migration,
      /create policy members insert connections on public\.connections/,
    );
    assert.match(migration, /lbb_save_relationship_context/);
    assert.match(migration, /lbb_confirm_connection_context/);
    assert.match(migration, /lbb_restore_connection_recommendation/);
    assert.match(migration, /from public, anon, authenticated/g);
    assert.match(migration, /to service_role/g);
    assert.match(migration, /insert into public\.audit_log/g);

    const hardening = normalizedActiveMigrationSql;
    assert.match(hardening, /revoke all on table public\.connections/);
    assert.match(hardening, /relationship_contexts_created_by_idx/);
    assert.match(hardening, /relationship_context_memberships_created_by_idx/);
    assert.match(hardening, /connection_contexts_created_by_idx/);
  });

  test("uses context as evidence without materializing every possible pair", () => {
    const migration = normalizedActiveMigrationSql;
    const data = source("lib/networking/data.ts");

    assert.match(data, /relationship_context_memberships/);
    assert.match(
      data,
      /\.eq\("confirmed_memberships\.verification_state", "confirmed"\)/,
    );
    assert.doesNotMatch(data, /\.limit\(10000\)/);
    assert.match(data, /shared_contexts: sharedContexts/);
    assert.match(data, /\["strong", "moderate"\]\.includes/);
    assert.match(data, /source_project_duplicate/);
    assert.match(data, /networkFitScore/);
    assert.match(data, /podcast_topic_fit_v1/);
    assert.match(data, /scoreNetworkingPair/);
    assert.match(data, /services_offered/);
    assert.doesNotMatch(migration, /cross join/);
  });

  test("uses one trust taxonomy in manual intake", () => {
    const intake = source("app/(portal)/contacts/new/page.tsx");
    assert.match(intake, /Tier 1 - Deep Trust/);
    assert.match(intake, /Tier 2 - Working Trust/);
    assert.match(intake, /Tier 3 - Acquaintance/);
    assert.doesNotMatch(intake, /<option>High Trust<\/option>/);
    assert.doesNotMatch(intake, /<option>Do Not Refer<\/option>/);
  });

  test("captures context in a compact flow and exposes it on profiles", () => {
    const page = source("app/(portal)/networking/page.tsx");
    const dialog = source(
      "app/(portal)/networking/already-connected-dialog.tsx",
    );
    const manager = source(
      "app/(portal)/networking/relationship-context-capture.tsx",
    );
    const groupEditor = source(
      "app/(portal)/networking/relationship-group-editor.tsx",
    );
    const contactPage = source("app/(portal)/contacts/[id]/page.tsx");

    assert.match(page, /Check first/);
    assert.match(page, /NetworkingBasisDialog/);
    assert.match(page, /My Groups/);
    assert.match(page, /RelationshipGroupEditor/);
    assert.match(dialog, /They already know each other/);
    assert.match(dialog, /Save connection/);
    assert.match(dialog, /Mark connected without details/);
    assert.match(dialog, /Add a note/);
    assert.match(manager, /Search the Book/);
    assert.match(manager, /Create group/);
    assert.match(groupEditor, /Add or remove people/);
    assert.match(groupEditor, /Save people/);
    assert.match(contactPage, />Groups</);
  });

  test("replaces group membership atomically and keeps an audit trail", () => {
    const migration = normalizedActiveMigrationSql;
    const action = source("app/(portal)/networking/actions.ts");

    assert.match(migration, /lbb_replace_relationship_context_members/);
    assert.match(migration, /for update/);
    assert.match(migration, /not \(contact_id = any\(normalized_contacts\)\)/);
    assert.match(migration, /on conflict \(tenant_id, context_id, contact_id\)/);
    assert.match(migration, /relationship_context\.members_replaced/);
    assert.match(migration, /from public, anon, authenticated/);
    assert.match(migration, /to service_role/);
    assert.match(action, /replaceRelationshipGroupMembers/);
    assert.match(action, /lbb_replace_relationship_context_members/);
  });

  test("installs the structured group model without copied test rows", () => {
    const migration = normalizedActiveMigrationSql;

    assert.match(migration, /how_we_met\s+text/);
    assert.match(migration, /how_i_know_them\s+text\[\]/);
    assert.match(migration, /create table public\.relationship_contexts/);
    assert.match(migration, /create table public\.relationship_context_memberships/);
    assert.match(migration, /create table public\.connection_contexts/);
    assert.match(migration, /app_private\.relationship_context_key/);
    assert.match(migration, /relationship_context_memberships_verification_check/);
    assert.match(migration, /unique \(tenant_id, canonical_key\)/);
    assert.match(migration, /foreign key \(tenant_id, contact_id\)/);
    assert.match(migration, /foreign key \(tenant_id, connection_id\)/);
    assert.doesNotMatch(migration, /test_duplicate_source_project/);
    assert.doesNotMatch(migration, /networking\.relationship_context_backfill_completed/);
  });

  test("keeps Networking direct and free of dead-end owner workflows", () => {
    const page = source("app/(portal)/networking/page.tsx");

    assert.match(page, /Create an introduction/);
    assert.match(page, /Create introduction/);
    assert.match(page, /Mark sent/);
    assert.match(page, /Show me \{moreBatch\} more/);
    assert.match(page, /fitSummary\(recommendation\)/);
    assert.match(page, /networkingProfileBasis/);
    assert.match(page, /personABasis=\{howKnown/);
    assert.match(page, /introductionReason/);
    assert.doesNotMatch(page, /timingReason/);
    assert.doesNotMatch(page, /connection\.evidence\.why_now/);
    assert.doesNotMatch(page, /Shared groups &amp; events/);
    assert.doesNotMatch(page, /Propose a different introduction/);
    assert.doesNotMatch(page, /Introductions in progress/);
    assert.doesNotMatch(page, /Daily goal met/);
    assert.doesNotMatch(page, /completed today/);
    assert.doesNotMatch(page, /<summary>Promises/);
  });

  test("keeps sent introductions as history unless follow-up was scheduled", () => {
    const movement = source("lib/relationship-movement.ts");
    const contactBrief = source("lib/contact-executive-brief.ts");

    assert.doesNotMatch(movement, /madeNeedsCloseout/);
    assert.doesNotMatch(movement, /Record outcome/);
    assert.match(movement, /if \(!followDue && !proposedStale\) return null/);
    assert.match(contactBrief, /\["proposed", "follow_up"\]\.includes/);
  });

  test("Ask the Book only treats confirmed relationships as warm paths", () => {
    const askData = source("lib/ask/data.ts");

    assert.match(
      askData,
      /\.from\("connections"\)[\s\S]{0,500}\.eq\("status", "already_connected"\)/,
    );
    assert.match(askData, /scoreRelationshipContext/);
    assert.match(askData, /relationship_context_memberships/);
  });
});
