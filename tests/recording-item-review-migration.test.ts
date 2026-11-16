import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260830034629_recording_item_review.sql",
  "utf8",
);

describe("recording item review database boundary", () => {
  test("adds a proposal state and migrates only unconfirmed meeting items", () => {
    assert.match(migration, /status in \('proposed', 'pending', 'routed', 'dismissed'\)/);
    assert.match(migration, /transcript\.processing_status = 'review'/);
    assert.match(migration, /followup\.status = 'pending'/);
  });

  test("keeps item decisions atomic and owner scoped", () => {
    assert.match(migration, /create or replace function public\.lbb_review_recording_followup/);
    assert.match(migration, /member\.role = 'owner'/);
    assert.match(migration, /for update/);
    assert.match(migration, /p_decision not in \('confirm', 'dismiss'\)/);
    assert.match(migration, /recording\.followup_review_/);
  });

  test("prevents whole-meeting confirmation while proposals remain", () => {
    assert.match(migration, /followup\.status = 'proposed'/);
    assert.match(migration, /decide every proposed follow-up before confirming the meeting/);
  });

  test("exposes the decision RPC only to the service role", () => {
    assert.match(
      migration,
      /revoke all on function public\.lbb_review_recording_followup\([\s\S]*?from public, anon, authenticated/,
    );
    assert.match(
      migration,
      /grant execute on function public\.lbb_review_recording_followup\([\s\S]*?to service_role/,
    );
  });
});
