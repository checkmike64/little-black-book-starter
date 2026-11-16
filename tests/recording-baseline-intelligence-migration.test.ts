import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const migrationPath =
  "supabase/migrations/20260904015451_recording_baseline_intelligence.sql";
const sql = readFileSync(migrationPath, "utf8");
const lower = sql.toLowerCase();

const expectedFields = [
  "company_name",
  "company_description",
  "role_title",
  "location",
  "time_zone",
  "phone",
  "linkedin",
  "instagram",
  "facebook",
  "x_twitter",
  "youtube",
  "podcast_url",
  "website",
  "current_asks",
  "wants_help_with",
  "services_offered",
  "ideal_referral",
];

function functionBody(name: string, nextMarker: string) {
  const start = lower.indexOf(`create or replace function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = lower.indexOf(nextMarker, start);
  assert.notEqual(end, -1, `${name} must have a bounded body`);
  return lower.slice(start, end);
}

describe("recording baseline migration contract", () => {
  test("uses only the approved centrally enforced field policy", () => {
    const policyStart = lower.indexOf("insert into app_private.recording_baseline_field_policy");
    const policyEnd = lower.indexOf("on conflict (field_name)", policyStart);
    assert.ok(policyStart >= 0 && policyEnd > policyStart);
    const policy = lower.slice(policyStart, policyEnd);
    const actual = [...policy.matchAll(/\('([a-z_]+)',\s*'(?:text|text_array|date)'/g)]
      .map((match) => match[1]);
    assert.deepEqual(actual, expectedFields);
    for (const excluded of [
      "full_name",
      "email",
      "one_line_summary",
      "met_date",
      "how_we_met",
      "how_i_know_them",
      "what_they_want_more_of",
      "recent_activity",
      "private_notes",
      "relationship_strength",
      "do_not_refer_for",
    ]) {
      assert.doesNotMatch(policy, new RegExp(`\\('${excluded}'`));
    }
  });

  test("enforces safe value types, grounded evidence, and field-aware normalization", () => {
    assert.match(lower, /recording_baseline_value_is_valid\(\s*p_field_name text,/);
    assert.match(lower, /p_field_name in \([\s\S]*'website'[\s\S]*'podcast_url'[\s\S]*\)[\s\S]*\^https:\/\//);
    assert.match(lower, /p_field_name = 'phone'[\s\S]*regexp_replace\(p_value #>> '\{\}', '\[\^0-9\]'/);
    assert.match(lower, /normalize_recording_baseline_value\([\s\S]*when p_field_name = 'phone'/);
    assert.match(lower, /when p_field_name in \([\s\S]*'website'[\s\S]*regexp_replace\(lower\(trim/);
    assert.match(lower, /regexp_replace\(trim\(evidence_summary\), '\\s\+', ' ', 'g'\)[\s\S]*regexp_replace\(trim\(interaction_row\.summary\), '\\s\+', ' ', 'g'\)/);
  });

  test("adds exact-retry job identity and an atomic bounded lease", () => {
    assert.match(lower, /add column if not exists idempotency_key text/);
    assert.match(lower, /add column if not exists payload_hash text/);
    assert.match(lower, /create unique index if not exists jobs_tenant_type_idempotency_idx/);
    const enqueue = functionBody(
      "public.lbb_enqueue_recording_baseline",
      "revoke all on function public.lbb_enqueue_recording_baseline",
    );
    assert.match(enqueue, /existing_job\.payload_hash is distinct from job_hash/);
    assert.match(enqueue, /recording baseline idempotency conflict/);
    assert.match(enqueue, /existing_job\.status = 'cancelled'[\s\S]*meeting_contact_unconfirmed[\s\S]*status = 'queued'/);

    const claim = functionBody(
      "public.lbb_claim_recording_baseline_jobs",
      "revoke all on function public.lbb_claim_recording_baseline_jobs",
    );
    assert.match(claim, /for update of queued skip locked/);
    assert.match(claim, /queued\.attempts < 5/);
    assert.match(claim, /p_lease_seconds not between 30 and 900/);
    assert.match(claim, /lock_token = next_lock_token/);
    assert.match(claim, /contact_updated_at_at_claim = candidate\.contact_updated_at/);
    assert.match(claim, /recording_baseline_source_ineligible/);
    assert.match(claim, /recording\.baseline_cancelled_source_ineligible/);
    assert.doesNotMatch(claim, /transcript\.action_items/);
    assert.match(claim, /jsonb_agg\(resolved\.followup_text order by resolved\.source_item_index, resolved\.id\)/);
    assert.match(claim, /resolved\.contact_id = contact\.id/);
    assert.match(claim, /resolved\.status in \('routed', 'completed'\)/);
    assert.doesNotMatch(claim, /resolved\.status in \([^)]*(?:proposed|pending|dismissed)/);
    for (const field of [
      "contact_id uuid",
      "is_first_confirmed_meeting boolean",
      "interaction_occurred_at timestamptz",
      "interaction_summary text",
      "contact_snapshot jsonb",
    ]) {
      assert.match(claim, new RegExp(field));
    }
    assert.match(claim, /'id', contact\.id,[\s\S]*'full_name', contact\.full_name/);
  });

  test("keeps participant confirmation explicit, owner scoped, repairable, and auditable", () => {
    const confirm = functionBody(
      "public.lbb_confirm_meeting_contacts",
      "revoke all on function public.lbb_confirm_meeting_contacts",
    );
    assert.match(confirm, /member\.role = 'owner'/);
    assert.match(confirm, /cardinality\(requested_ids\) = 0/);
    assert.match(confirm, /contact\.tenant_id = p_tenant_id[\s\S]*contact\.archived_at is null/);
    assert.match(confirm, /transcript_row\.updated_at is distinct from p_expected_transcript_updated_at/);
    assert.match(confirm, /processing_status = 'review'[\s\S]*unresolved\.status in \('proposed', 'pending'\)[\s\S]*meeting_contacts_staged/);
    assert.match(confirm, /public\.lbb_accept_meeting_artifact/);

    const accept = functionBody(
      "public.lbb_accept_meeting_artifact",
      "revoke all on function public.lbb_accept_meeting_artifact",
    );
    assert.match(accept, /at least one explicit confirmed meeting contact is required/);
    assert.match(accept, /delete from public\.interaction_contacts/);
    assert.match(accept, /status = 'cancelled'[\s\S]*meeting_contact_unconfirmed/);
    assert.match(accept, /public\.lbb_enqueue_recording_baseline/);
  });

  test("finalizes baselines atomically without overwriting established values", () => {
    const apply = functionBody(
      "public.lbb_apply_recording_baseline",
      "revoke all on function public.lbb_apply_recording_baseline",
    );
    assert.match(apply, /actual_suggestion_keys is distinct from array\['confidence','evidence_summary','value'\]/);
    assert.match(apply, /or exists \([\s\S]*from public\.recording_followups resolved[\s\S]*resolved\.contact_id = contact_row\.id[\s\S]*resolved\.status in \('routed', 'completed'\)/);
    assert.match(apply, /regexp_replace\(trim\(resolved\.followup_text\), '\\s\+', ' ', 'g'\)/);
    assert.match(apply, /suggestion_confidence < 0\.90/);
    assert.match(apply, /if current_value is null then/);
    assert.match(apply, /where tenant_id = \$2 and id = \$3 and %i is null/);
    assert.match(apply, /current_normalized is not distinct from suggested_normalized/);
    assert.match(apply, /contact_row\.updated_at is distinct from job_row\.contact_updated_at_at_claim/);
    assert.match(apply, /'fields', jsonb_build_object\(suggestion\.key, suggestion_value\)/);
    assert.match(apply, /'expected_current_value', current_value/);
    assert.match(apply, /expected_contact_updated_at/);
    assert.match(apply, /recording-baseline-conflict:' \|\| job_row\.id::text \|\| ':' \|\| suggestion\.key/);
    assert.match(apply, /insert into public\.field_provenance/);
    assert.match(apply, /set status = 'succeeded'/);
  });

  test("preserves the legacy decision RPC while requiring contacts before finalization", () => {
    const nineArg = lower.match(
      /create or replace function public\.lbb_decide_recording_followup\([\s\S]*?p_meeting_contact_ids uuid\[\]\s*\)\s*returns jsonb[\s\S]*?revoke all on function public\.lbb_decide_recording_followup\(\s*uuid,uuid,uuid,text,text,uuid,date,text,uuid\[\]\s*\)/,
    )?.[0];
    assert.ok(nineArg);
    assert.doesNotMatch(nineArg, /p_meeting_contact_ids uuid\[\] default/);
    assert.match(nineArg, /metadata -> 'confirmed_contact_ids'/);
    assert.match(nineArg, /from public\.calendar_attendees attendee/);
    assert.match(nineArg, /from public\.recording_followups decided/);
    assert.match(nineArg, /confirm at least one meeting contact before finalizing/);
    assert.match(lower, /p_note text default null[\s\S]*select public\.lbb_decide_recording_followup\([\s\S]*null::uuid\[\]/);
  });

  test("reviews recording contradictions with an owner-scoped field-level CAS", () => {
    const review = functionBody(
      "public.lbb_review_recording_baseline_change",
      "revoke all on function public.lbb_review_recording_baseline_change",
    );
    assert.match(review, /p_decision is null or p_decision not in \('approve', 'dismiss'\)/);
    assert.match(review, /member\.role = 'owner'/);
    assert.match(review, /change_row\.source <> 'recording_baseline'/);
    assert.match(review, /change_row\.status <> 'pending'/);
    assert.match(review, /jsonb_object_keys\(change_row\.payload -> 'fields'\)\) <> 1/);
    assert.match(review, /recording_baseline_field_policy policy/);
    assert.match(review, /expected_current_value := change_row\.payload -> 'expected_current_value'/);
    assert.match(review, /current_value is distinct from expected_current_value/);
    assert.match(review, /to_jsonb\(%i\) is not distinct from \$4/);
    assert.match(review, /insert into public\.field_provenance/);
    assert.match(review, /update public\.pending_changes[\s\S]*reviewed_by = p_actor_user_id/);
    assert.match(review, /recording\.baseline_change_/);
    assert.match(review, /exact_duplicate := change_row\.status = case[\s\S]*when p_decision = 'approve' then 'approved' else 'dismissed' end/);
    assert.match(review, /not exact_duplicate and change_row\.status <> 'pending'[\s\S]*already resolved or superseded/);
    assert.match(review, /job\.tenant_id = p_tenant_id[\s\S]*job\.id = baseline_job_id[\s\S]*job\.job_type = 'recording_baseline'[\s\S]*job\.status = 'succeeded'/);
    assert.match(review, /job\.payload ->> 'contact_id' = change_row\.contact_id::text/);
    assert.match(review, /job\.result -> 'contradiction_change_ids' @> jsonb_build_array\(change_row\.id\)/);
    assert.match(review, /transcript\.id = evidence_transcript_id[\s\S]*transcript\.interaction_id = evidence_interaction_id/);
    assert.match(review, /interaction\.metadata ->> 'evidence_grade' = 'owner_confirmed'/);
    assert.match(review, /if exact_duplicate then[\s\S]*'duplicate', true/);
    const approvalOnly = review.match(
      /if p_decision = 'approve' then([\s\S]*?)end if;\s*update public\.pending_changes/,
    )?.[1];
    assert.ok(approvalOnly);
    assert.match(approvalOnly, /update public\.contacts/);
    assert.match(approvalOnly, /insert into public\.field_provenance/);
    const afterApproval = review.split(/end if;\s*update public\.pending_changes/).at(-1) ?? "";
    assert.doesNotMatch(afterApproval, /update public\.contacts/);
  });

  test("keeps every new boundary service-role only and extends the full AI ledger validator", () => {
    for (const signature of [
      "lbb_enqueue_recording_baseline(uuid,uuid,uuid)",
      "lbb_claim_recording_baseline_jobs(integer,integer)",
      "lbb_fail_recording_baseline_job(uuid,uuid,text,text,text,integer)",
      "lbb_apply_recording_baseline(uuid,uuid,text,text,jsonb)",
      "lbb_confirm_meeting_contacts(uuid,uuid,uuid,uuid[],timestamptz)",
      "lbb_review_recording_baseline_change(uuid,uuid,uuid,text)",
    ]) {
      assert.match(lower, new RegExp(`revoke all on function public\\.${signature.replace(/[()[\]]/g, "\\$&")}[\\s\\S]*?from public, anon, authenticated`));
      assert.match(lower, new RegExp(`grant execute on function public\\.${signature.replace(/[()[\]]/g, "\\$&")}[\\s\\S]*?to service_role`));
    }
    assert.match(lower, /create or replace function public\.lbb_record_ai_generation_ledger/);
    assert.match(lower, /'recording_baseline'/);
    assert.match(lower, /'recordings'/);
    assert.match(lower, /task' = 'recording_baseline' and p_metadata ->> 'feature' <> 'recordings'/);
    assert.match(lower, /ai ledger metadata keys do not match the content-free schema/);
    assert.doesNotMatch(lower, /grant execute[\s\S]{0,180}to (?:anon|authenticated)/);
  });
});
