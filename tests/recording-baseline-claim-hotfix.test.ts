import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appliedMigration = readFileSync(
  "supabase/migrations/20260904015451_recording_baseline_intelligence.sql",
  "utf8",
).toLowerCase();
const hotfixMigration = readFileSync(
  "supabase/migrations/20260904025833_fix_recording_baseline_claim.sql",
  "utf8",
).toLowerCase();

function claimFunction(sql: string) {
  const start = sql.indexOf(
    "create or replace function public.lbb_claim_recording_baseline_jobs",
  );
  assert.notEqual(start, -1, "claim function must exist");
  const end = sql.indexOf(
    "revoke all on function public.lbb_claim_recording_baseline_jobs",
    start,
  );
  assert.notEqual(end, -1, "claim function must have a bounded body");
  return sql.slice(start, end);
}

function claimDefinitionAndGrant(sql: string) {
  const start = sql.indexOf(
    "create or replace function public.lbb_claim_recording_baseline_jobs",
  );
  assert.notEqual(start, -1, "claim function must exist");
  const end = sql.indexOf("to service_role;", start);
  assert.notEqual(end, -1, "claim function service-role grant must exist");
  return sql.slice(start, end + "to service_role;".length);
}

test("forward repair qualifies RETURNS TABLE output names in the cancellation projection", () => {
  const appliedClaim = claimFunction(appliedMigration);
  const repairedClaim = claimFunction(hotfixMigration);

  assert.match(repairedClaim, /returns table \([\s\S]*\btenant_id uuid,/);
  assert.match(
    appliedClaim,
    /select tenant_id, 'system', 'recording\.baseline_cancelled_source_ineligible'/,
  );
  assert.doesNotMatch(
    repairedClaim,
    /select tenant_id, 'system', 'recording\.baseline_cancelled_source_ineligible'/,
  );
  assert.match(
    repairedClaim,
    /select cancelled\.tenant_id, 'system', 'recording\.baseline_cancelled_source_ineligible',[\s\S]*'jobs', cancelled\.id,[\s\S]*cancelled\.payload -> 'transcript_id'[\s\S]*cancelled\.payload -> 'contact_id'[\s\S]*from cancelled;/,
  );
});

test("changes only the ambiguous cancellation projection and preserves grants", () => {
  const appliedClaim = claimDefinitionAndGrant(appliedMigration);
  const repairedClaim = claimDefinitionAndGrant(hotfixMigration);
  const expected = appliedClaim.replace(
    `select tenant_id, 'system', 'recording.baseline_cancelled_source_ineligible',
    'jobs', id,
    jsonb_build_object(
      'transcript_id', payload -> 'transcript_id',
      'contact_id', payload -> 'contact_id'
    )`,
    `select cancelled.tenant_id, 'system', 'recording.baseline_cancelled_source_ineligible',
    'jobs', cancelled.id,
    jsonb_build_object(
      'transcript_id', cancelled.payload -> 'transcript_id',
      'contact_id', cancelled.payload -> 'contact_id'
    )`,
  );

  assert.notEqual(expected, appliedClaim, "fixture must retain the production defect");
  assert.equal(repairedClaim, expected);
  assert.match(
    repairedClaim,
    /returning invalid_job\.tenant_id, invalid_job\.id, invalid_job\.payload/,
  );
  assert.match(repairedClaim, /for update of queued skip locked/);
  assert.match(repairedClaim, /resolved\.status in \('routed', 'completed'\)/);
  assert.doesNotMatch(repairedClaim, /transcript\.action_items/);
  assert.match(
    repairedClaim,
    /revoke all on function public\.lbb_claim_recording_baseline_jobs\(integer,integer\)\s+from public, anon, authenticated;/,
  );
  assert.match(
    repairedClaim,
    /grant execute on function public\.lbb_claim_recording_baseline_jobs\(integer,integer\)\s+to service_role;/,
  );
});
