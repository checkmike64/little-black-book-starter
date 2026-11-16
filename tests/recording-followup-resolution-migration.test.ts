import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260902153722_streamline_meeting_processing.sql",
  "utf8",
);

describe("simplified recording follow-up resolution boundary", () => {
  test("adds a distinct terminal already-done state without a downstream target", () => {
    assert.match(migration, /normalized_outcome = 'already_done' then 'completed'/);
    assert.match(migration, /normalized_outcome = 'already_done' then 'already_done'/);
    assert.match(migration, /created_target_id uuid;/);
    assert.match(migration, /created_target_table text;/);
    assert.match(migration, /due_on = case when normalized_outcome = 'approve' then p_due_on else null end/);
  });

  test("approves work atomically while preserving concrete internal routes", () => {
    assert.match(migration, /create or replace function public\.lbb_decide_recording_followup/);
    assert.match(migration, /normalized_outcome = 'approve'/);
    assert.match(migration, /insert into public\.relationship_actions/);
    assert.match(migration, /insert into public\.promises/);
    assert.match(migration, /for update/);
    assert.match(migration, /member\.role = 'owner'/);
  });

  test("rejects nullable outcomes and classifications", () => {
    assert.match(migration, /normalized_outcome is null[\s\S]*normalized_outcome not in/);
    assert.match(migration, /p_classification is null[\s\S]*p_classification not in/);
    assert.match(migration, /normalized_outcome not in \('approve', 'already_done', 'decline'\)/);
  });

  test("does not create a task or promise for already-done or not-follow-up outcomes", () => {
    const actionInsert = migration.indexOf("insert into public.relationship_actions");
    const promiseInsert = migration.indexOf("insert into public.promises");
    assert.ok(actionInsert > migration.indexOf("normalized_outcome = 'approve'"));
    assert.ok(promiseInsert > migration.indexOf("normalized_outcome = 'approve'"));
    assert.match(migration, /normalized_outcome = 'already_done' then 'already_done'/);
    assert.match(migration, /normalized_outcome = 'decline' then 'dismissed'/);
    assert.match(migration, /normalized_outcome = 'approve' and p_contact_id is null/);
  });

  test("treats only exact repeated decisions as idempotent", () => {
    assert.match(migration, /followup_row\.contact_id is not distinct from/);
    assert.match(migration, /followup_row\.due_on is not distinct from/);
    assert.match(migration, /followup_row\.resolution_note is not distinct from clean_note/);
    assert.match(migration, /metadata->>'classification'/);
  });

  test("exposes the decision RPC only to the service role", () => {
    assert.match(
      migration,
      /revoke all on function public\.lbb_decide_recording_followup\([\s\S]*?from public, anon, authenticated/,
    );
    assert.match(
      migration,
      /grant execute on function public\.lbb_decide_recording_followup\([\s\S]*?to service_role/,
    );
  });

  test("processes the meeting automatically after its final decision", () => {
    assert.match(migration, /unresolved\.status in \('proposed', 'pending'\)/);
    assert.match(migration, /public\.lbb_accept_meeting_artifact/);
    assert.match(migration, /'meeting_processed', meeting_processed/);
  });

  test("repairs only valid active same-tenant legacy contact references", () => {
    assert.match(migration, /update public\.pending_changes change/);
    assert.match(migration, /change\.payload ->> 'contact_id'/);
    assert.match(migration, /contact\.tenant_id = change\.tenant_id/);
    assert.match(migration, /contact\.archived_at is null/);
  });
});
