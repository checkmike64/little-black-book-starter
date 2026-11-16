import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260904133601_operator_only_recordings.sql",
  "utf8",
);
const normalizedMigration = migration
  .replace(/\s+/g, " ")
  .replace(/\s*([(),])\s*/g, "$1");

test("preserves owner RLS for stored-owner effective-operator installs", () => {
  assert.doesNotMatch(migration, /drop policy[\s\S]*recording owners read/i);
  assert.doesNotMatch(migration, /create policy[\s\S]*active operators read/i);
  assert.match(migration, /OPERATOR_EMAILS override/i);
  assert.match(migration, /tenant-filtered service-role read/i);
});

test("uses service-only operator RPCs without owner impersonation", () => {
  for (const signature of [
    "lbb_operator_confirm_meeting_contacts\\(uuid,uuid,uuid,uuid\\[\\],timestamptz\\)",
    "lbb_operator_dismiss_meeting_artifact\\(uuid,uuid,uuid\\)",
    "lbb_operator_decide_recording_followup\\(uuid,uuid,uuid,text,text,uuid,date,text,uuid\\[\\],timestamptz\\)",
    "lbb_enqueue_operator_recording_baseline\\(uuid,uuid,uuid\\)",
    "lbb_claim_operator_recording_baseline_jobs\\(integer,integer\\)",
    "lbb_claim_next_recording_baseline_job\\(integer\\)",
    "lbb_fail_operator_recording_baseline_job\\(uuid,uuid,text,text,text,integer\\)",
    "lbb_apply_operator_recording_baseline\\(uuid,uuid,text,text,jsonb\\)",
    "lbb_review_operator_routed_promise\\(uuid,uuid,uuid,text,timestamptz\\)",
    "lbb_review_operator_recording_action\\(uuid,uuid,uuid,text\\)",
    "lbb_owner_repair_operator_meeting_contacts\\(uuid,uuid,uuid,uuid\\[\\],timestamptz\\)",
  ]) {
    assert.match(
      normalizedMigration,
      new RegExp(`revoke all on function public\\.${signature}from public,anon,authenticated`, "i"),
    );
    assert.match(
      normalizedMigration,
      new RegExp(`grant execute on function public\\.${signature}to service_role`, "i"),
    );
  }
  assert.match(migration, /member\.role\s+in\s*\('owner',\s*'operator'\)/i);
  assert.match(migration, /owner_user_id_value\s*:=\s*transcript_row\.owner_user_id/i);
  assert.match(migration, /p_actor_user_id, 'operator'/i);
  assert.doesNotMatch(migration, /'decided_by_owner'\s*,\s*true/i);
  assert.doesNotMatch(migration, /'owner_approved'\s*,\s*true/i);
  assert.match(migration, /followup_row\.owner_user_id\s+is distinct from\s+owner_user_id_value/i);
  assert.match(migration, /transcript_row\.owner_user_id\s+is distinct from\s+p_actor_user_id/i);
});

test("resolved operator retries are checked before the transcript CAS", () => {
  const start = migration.indexOf(
    "create or replace function public.lbb_operator_decide_recording_followup",
  );
  const end = migration.indexOf(
    "revoke all on function public.lbb_operator_decide_recording_followup",
  );
  const body = migration.slice(start, end);
  assert.ok(start >= 0 && end > start);
  const duplicateCheck = body.indexOf("if followup_row.status not in ('proposed','pending')");
  assert.ok(duplicateCheck > 0);
  assert.ok(
    duplicateCheck < body.indexOf("transcript_row.processing_status not in ('review','ready')"),
  );
  assert.ok(duplicateCheck < body.indexOf("p_expected_transcript_updated_at is null"));
});

test("legacy recording connection RPCs accept guarded active owners or operators and stay service-only", () => {
  const signatures = [
    "lbb_prepare_recording_connection\\(uuid,uuid,uuid,uuid,text,uuid\\)",
    "lbb_upsert_recording_connection\\(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text\\)",
    "lbb_abandon_recording_connection_provisioning\\(uuid,uuid,uuid,uuid\\)",
    "lbb_mark_recording_provisioning_cleanup_pending\\(uuid,uuid,uuid,uuid,text,text\\)",
    "lbb_ensure_manual_recording_connection\\(uuid,uuid,uuid,text,text\\)",
    "lbb_confirm_recording_upstream_revoked\\(uuid,uuid,uuid\\)",
  ];
  for (const signature of signatures) {
    assert.match(normalizedMigration, new RegExp(
      `revoke all on function public\\.${signature}from public,anon,authenticated`,
      "i",
    ));
    assert.match(normalizedMigration, new RegExp(
      `grant execute on function public\\.${signature}to service_role`,
      "i",
    ));
  }
  assert.ok((migration.match(/role in \('owner', 'operator'\)/g) ?? []).length >= 6);
});

test("keeps operator recording outputs pending for the actual owner", () => {
  assert.match(
    migration,
    /drop constraint if exists recording_followups_target_table_check[\s\S]*?target_table in \('relationship_actions', 'promises', 'pending_changes'\)/i,
  );
  assert.match(migration, /add column if not exists owner_user_id uuid references auth\.users/i);
  assert.match(migration, /review_status in \('pending_owner', 'accepted', 'declined'\)/i);
  assert.match(
    migration,
    /insert into public\.promises[\s\S]*?'pending_owner'/i,
  );
  assert.match(migration, /status in \('pending_review', 'open', 'completed', 'skipped', 'stopped'\)/i);
  assert.match(migration, /review_status = 'pending_owner'[\s\S]{0,180}status = 'pending_review'/i);
  assert.match(migration, /followup_row\.followup_text, 'pending_review'/i);
  assert.match(migration, /revoke update on table public\.promises from authenticated/i);
  assert.match(migration, /grant update \([\s\S]{0,180}status[\s\S]{0,180}\) on table public\.promises to authenticated/i);
  assert.doesNotMatch(
    migration.match(/grant update \([\s\S]*?\) on table public\.promises to authenticated/i)?.[0] ?? "",
    /review_status|reviewed_by|reviewed_at|owner_user_id/i,
  );
  assert.match(
    migration,
    /insert into public\.pending_changes[\s\S]*?'recording_action'[\s\S]*?'pending'[\s\S]*?'recording_operator'/i,
  );
  assert.match(migration, /promise\.owner_user_id=p_actor_user_id/i);
  assert.match(migration, /change\.payload->>'owner_user_id'=p_actor_user_id::text/i);
  assert.match(migration, /p_expected_updated_at is null[\s\S]*promise changed after the page loaded/i);
  assert.match(migration, /p_decision not in \('accept','already_done','decline'\)/i);
  assert.match(migration, /when p_decision='already_done' then 'completed'/i);
  assert.match(migration, /followup\.target_table='promises'[\s\S]{0,500}followup\.followup_text=promise_row\.promise_text/i);
  assert.match(migration, /followup\.target_table='pending_changes'[\s\S]{0,500}followup\.followup_text=action_payload->>'title'/i);
  assert.match(migration, /for update/i);
});

test("one oldest-due baseline mode consumes the cron AI slot", () => {
  assert.match(
    migration,
    /create or replace function public\.lbb_claim_next_recording_baseline_job[\s\S]*order by job\.run_after,job\.created_at,job\.id[\s\S]*selected_job\.job_type='recording_baseline_operator'/i,
  );
  assert.match(migration, /lbb_claim_operator_recording_baseline_jobs\(1,p_lease_seconds\)/i);
  assert.match(migration, /lbb_claim_recording_baseline_jobs\(1,p_lease_seconds\)/i);
  assert.match(migration, /if claimed_job\.job_id<>selected_job\.id then[\s\S]*status='queued'[\s\S]*continue/i);
  assert.match(migration, /actor_user_id:=case when selected_job\.job_type='recording_baseline_operator'[\s\S]*claimed_job\.operator_user_id/i);
});

test("operator baseline is proposal-only and owner review remains atomic", () => {
  assert.match(migration, /'review_mode','owner_proposal_only'/i);
  assert.match(migration, /job_type='recording_baseline_operator'/i);
  assert.match(migration, /suggestion_confidence<0\.90/i);
  assert.ok(
    (migration.match(/coalesce\(to_jsonb\(%I\), ''null''::jsonb\)/g) ?? []).length >= 5,
    "operator proposals and reviews must compare SQL NULL as canonical JSON null",
  );
  assert.match(migration, /'auto_filled_count',0/i);
  assert.match(migration, /'expected_current_value',current_value/i);
  assert.match(migration, /'proposal_sha256',proposal_hash/i);
  assert.match(migration, /'proposal_hashes',proposal_hashes/i);
  assert.match(migration, /operator recording baseline proposal integrity check failed/i);
  assert.match(migration, /'recording_baseline','claude'/i);
  assert.match(
    migration,
    /operator_user_id_value,'operator',[\s\S]{0,100}'recording\.operator_baseline_change_proposed'/i,
  );
  assert.match(
    migration,
    /operator_user_id_value,'operator','recording\.operator_baseline_proposed'/i,
  );

  const applyStart = migration.indexOf(
    "create or replace function public.lbb_apply_operator_recording_baseline",
  );
  const applyEnd = migration.indexOf(
    "revoke all on function public.lbb_apply_operator_recording_baseline",
  );
  const applyBody = migration.slice(applyStart, applyEnd);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  assert.doesNotMatch(applyBody, /update public\.contacts/i);
  assert.doesNotMatch(applyBody, /insert into public\.field_provenance/i);
  assert.match(applyBody, /insert into public\.pending_changes/i);

  assert.match(
    migration,
    /create function public\.lbb_review_recording_baseline_change[\s\S]*job\.payload->>'owner_user_id'[\s\S]*p_actor_user_id::text/i,
  );
  assert.match(
    migration,
    /current_value is distinct from expected_current_value[\s\S]*update public\.contacts[\s\S]*insert into public\.field_provenance[\s\S]*update public\.pending_changes[\s\S]*insert into public\.audit_log/i,
  );
});

test("terminal operator outcomes cannot synthesize downstream work", () => {
  assert.match(
    migration,
    /route_value := case[\s\S]*'already_done'[\s\S]*'dismiss'/i,
  );
  assert.match(
    migration,
    /if normalized_outcome = 'approve' and p_classification in \('owner_promise','contact_promise'\)/i,
  );
  assert.match(
    migration,
    /elsif normalized_outcome = 'approve' and p_classification = 'action'/i,
  );
  assert.doesNotMatch(migration, /normalized_outcome = 'already_done'[\s\S]{0,180}insert into public\.(promises|relationship_actions|pending_changes)/i);
});

test("preserves the database-first owner contract", () => {
  assert.match(
    migration,
    /alter function public\.lbb_review_recording_baseline_change\(uuid,uuid,uuid,text\)[\s\S]*rename to lbb_review_owner_recording_baseline_change/i,
  );
  assert.match(
    migration,
    /job_type_value='recording_baseline'[\s\S]*lbb_review_owner_recording_baseline_change/i,
  );
  assert.doesNotMatch(migration, /drop function[\s\S]*lbb_(accept_meeting_artifact|confirm_meeting_contacts|decide_recording_followup)/i);
});

test("pending owner promises stay out of existing live-promise consumers", () => {
  for (const path of [
    "lib/ask/data.ts",
    "lib/launch/data.ts",
    "lib/contacts/data.ts",
    "lib/movement/data.ts",
    "lib/scoreboard/data.ts",
    "lib/introduction-drafts.ts",
    "lib/dashboard/data.ts",
    "lib/automation/networking-refill.ts",
    "lib/export/owner-handoff-data.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /\.eq\(["']status["'],\s*["']open["']\)/);
    assert.doesNotMatch(source, /pending_review/);
  }
});
