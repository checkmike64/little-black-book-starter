import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const migration = readFileSync(
  "supabase/migrations/20261001040000_want_to_know_relationship_programs.sql",
  "utf8",
);
const workspace = readFileSync("lib/want-to-know/workspace.ts", "utf8");
const actions = readFileSync("app/(portal)/want-to-know/actions.ts", "utf8");

describe("Want to Know relationship-program data foundation", () => {
  test("preserves legacy buckets while assigning stable tenant-scoped programs", () => {
    assert.match(migration, /create table public\.want_to_know_programs/);
    assert.match(migration, /unique \(tenant_id, id\)/);
    assert.match(migration, /add column program_id uuid/);
    assert.match(migration, /legacy_bucket_name/);
    assert.match(migration, /sync_want_to_know_program_compatibility/);
    assert.doesNotMatch(migration, /delete from public\.want_to_know/);
  });

  test("models pause and archive as reversible lifecycle states", () => {
    assert.match(migration, /relationship_status text not null default 'active'/);
    assert.match(migration, /'paused'::text/);
    assert.match(migration, /'archived'::text/);
    assert.match(migration, /set_want_to_know_status_timestamps/);
  });

  test("provides an immutable tenant-secured event and touch ledger", () => {
    assert.match(migration, /create table public\.want_to_know_events/);
    assert.match(migration, /alter table public\.want_to_know_events enable row level security/);
    assert.match(migration, /grant select on table public\.want_to_know_events to authenticated/);
    assert.doesNotMatch(migration, /grant[^;]*insert[^;]*want_to_know_events to authenticated/);
    assert.match(migration, /grant select on table public\.want_to_know_programs to authenticated/);
    assert.doesNotMatch(migration, /grant[^;]*(insert|update)[^;]*want_to_know_programs to authenticated/);
    assert.match(migration, /app_private\.is_tenant_member\(tenant_id\)/);
    assert.match(migration, /roll_up_want_to_know_touch/);
  });

  test("loads a category workspace and evidence-rich candidate detail", () => {
    assert.match(workspace, /getWantToKnowCategoryWorkspace/);
    assert.match(workspace, /getWantToKnowCandidateDetail/);
    assert.match(workspace, /\.from\("signals"\)/);
    assert.match(workspace, /\.from\("content_items"\)/);
    assert.match(workspace, /\.from\("want_to_know_events"\)/);
    assert.match(workspace, /\.eq\("tenant_id", context\.tenantId\)/);
  });

  test("keeps owner mutations tenant-scoped, auditable, and return-path safe", () => {
    assert.match(actions, /createWantToKnowProgram/);
    assert.match(actions, /updateWantToKnowProgram/);
    assert.match(actions, /reorderWantToKnowPrograms/);
    assert.match(actions, /updateWantToKnowProfile/);
    assert.match(actions, /logWantToKnowEvent/);
    assert.match(actions, /pauseWantToKnowRelationship/);
    assert.match(actions, /archiveWantToKnowRelationship/);
    assert.match(actions, /redirectToFormReturn/);
    assert.match(actions, /writeAudit/);
    assert.match(actions, /\.eq\("tenant_id", context\.tenantId\)/);
    assert.match(migration, /lbb_reorder_want_to_know_programs/);
    assert.match(migration, /to service_role/);
  });
});
