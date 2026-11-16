begin;

create extension if not exists pgtap with schema extensions;

select plan(48);

select ok(not has_function_privilege('anon',
  'public.lbb_operator_confirm_meeting_contacts(uuid,uuid,uuid,uuid[],timestamptz)','execute'),
  'anon cannot confirm recording people');
select ok(not has_function_privilege('authenticated',
  'public.lbb_operator_decide_recording_followup(uuid,uuid,uuid,text,text,uuid,date,text,uuid[],timestamptz)','execute'),
  'authenticated cannot route recording followups');
select ok(has_function_privilege('service_role',
  'public.lbb_operator_confirm_meeting_contacts(uuid,uuid,uuid,uuid[],timestamptz)','execute'),
  'service role can invoke guarded operator confirmation');
select ok(has_function_privilege('service_role',
  'public.lbb_claim_next_recording_baseline_job(integer)','execute'),
  'service role can claim the single recording AI slot');
select ok(not has_function_privilege('authenticated',
  'public.lbb_apply_operator_recording_baseline(uuid,uuid,text,text,jsonb)','execute'),
  'browser roles cannot apply operator baseline output');
select ok(has_function_privilege('service_role',
  'public.lbb_review_recording_baseline_change(uuid,uuid,uuid,text)','execute'),
  'service role can invoke guarded owner Changes review');
select ok(not has_column_privilege('authenticated','public.promises','review_status','update'),
  'browser members cannot forge promise review status');
select ok(has_column_privilege('authenticated','public.promises','status','update'),
  'legacy browser promise status privilege remains available subject to coherence checks');

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values
  ('11000000-0000-0000-0000-000000000001','authenticated','authenticated','owner-operator-test@example.invalid','',now(),now(),now()),
  ('11000000-0000-0000-0000-000000000002','authenticated','authenticated','operator-test@example.invalid','',now(),now(),now()),
  ('11000000-0000-0000-0000-000000000003','authenticated','authenticated','other-owner-test@example.invalid','',now(),now(),now());

insert into public.tenants (id,name) values
  ('21000000-0000-0000-0000-000000000001','Operator recordings test'),
  ('21000000-0000-0000-0000-000000000002','Other tenant');
insert into public.tenant_members (tenant_id,user_id,role,status) values
  ('21000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','owner','active'),
  ('21000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000002','operator','active'),
  ('21000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000003','owner','active');
insert into public.contacts (id,tenant_id,full_name,source) values
  ('31000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001','Operator meeting contact','manual'),
  ('31000000-0000-0000-0000-000000000002','21000000-0000-0000-0000-000000000002','Other tenant contact','manual');

insert into public.transcripts (
  id,tenant_id,owner_user_id,title,source,source_ref,external_artifact_id,
  transcript_sha256,distilled_summary,occurred_at,processing_status,action_items,metadata
) values (
  '41000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'Managed review meeting','notion','operator-test-source','operator-test-artifact',
  repeat('a',64),'Acme provides relationship software.',now()-interval '1 day','review','[]'::jsonb,'{}'::jsonb
);

insert into public.recording_followups (
  id,tenant_id,transcript_id,owner_user_id,source_item_index,followup_text,status
) values
  ('51000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',0,'Owner promise to send notes','proposed'),
  ('51000000-0000-0000-0000-000000000002','21000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',1,'Contact promised an introduction','proposed'),
  ('51000000-0000-0000-0000-000000000003','21000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',2,'Owner promise already completed later','proposed'),
  ('51000000-0000-0000-0000-000000000004','21000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',3,'Create approved action','proposed'),
  ('51000000-0000-0000-0000-000000000005','21000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',4,'Create declined action','proposed'),
  ('51000000-0000-0000-0000-000000000006','21000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',5,'Raw item already completed','proposed'),
  ('51000000-0000-0000-0000-000000000007','21000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001',6,'Raw item is not a follow-up','proposed');

create temporary table operator_results (label text primary key,payload jsonb);
insert into operator_results
select 'stage',public.lbb_operator_confirm_meeting_contacts(
  '21000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000002',array['31000000-0000-0000-0000-000000000001'::uuid],null
);
select is((select payload->>'processing_status' from operator_results where label='stage'),'review',
  'people confirmation stages contacts while item decisions remain');
select is((select interaction_id from public.transcripts where id='41000000-0000-0000-0000-000000000001'),null::uuid,
  'staging does not silently accept the meeting');
select is((select actor_type from public.audit_log where action='recording.meeting_contacts_staged_by_operator'),'operator',
  'staging is attributed to the actual operator');
select throws_ok($$
  select public.lbb_operator_confirm_meeting_contacts(
    '21000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000002',array['31000000-0000-0000-0000-000000000002'::uuid],null)
$$,'42501','active recording operator access required','cross-tenant operator confirmation is denied');

create temporary table operator_transcript_version as
select updated_at
from public.transcripts
where id = '41000000-0000-0000-0000-000000000001';

insert into operator_results
select 'promise_accept',public.lbb_operator_decide_recording_followup(
  '21000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000002','owner_promise','approve',
  '31000000-0000-0000-0000-000000000001',current_date+7,null,
  array['31000000-0000-0000-0000-000000000001'::uuid],
  (select updated_at from operator_transcript_version));
insert into operator_results
select 'promise_already_done',public.lbb_operator_decide_recording_followup(
  '21000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000002',
  '11000000-0000-0000-0000-000000000002','contact_promise','approve',
  '31000000-0000-0000-0000-000000000001',null,null,
  array['31000000-0000-0000-0000-000000000001'::uuid],
  (select updated_at from operator_transcript_version));
insert into operator_results
select 'promise_decline',public.lbb_operator_decide_recording_followup(
  '21000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000003',
  '11000000-0000-0000-0000-000000000002','owner_promise','approve',
  '31000000-0000-0000-0000-000000000001',null,null,
  array['31000000-0000-0000-0000-000000000001'::uuid],
  (select updated_at from operator_transcript_version));
insert into operator_results
select 'action_accept',public.lbb_operator_decide_recording_followup(
  '21000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000004',
  '11000000-0000-0000-0000-000000000002','action','approve',
  '31000000-0000-0000-0000-000000000001',current_date+3,'Operator note',
  array['31000000-0000-0000-0000-000000000001'::uuid],
  (select updated_at from operator_transcript_version));
insert into operator_results
select 'action_decline',public.lbb_operator_decide_recording_followup(
  '21000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000005',
  '11000000-0000-0000-0000-000000000002','action','approve',
  '31000000-0000-0000-0000-000000000001',null,null,
  array['31000000-0000-0000-0000-000000000001'::uuid],
  (select updated_at from operator_transcript_version));
insert into operator_results
select 'raw_already_done',public.lbb_operator_decide_recording_followup(
  '21000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000006',
  '11000000-0000-0000-0000-000000000002',null,'already_done',null,null,null,
  array['31000000-0000-0000-0000-000000000001'::uuid],
  (select updated_at from operator_transcript_version));
insert into operator_results
select 'raw_decline',public.lbb_operator_decide_recording_followup(
  '21000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000007',
  '11000000-0000-0000-0000-000000000002',null,'decline',null,null,null,
  array['31000000-0000-0000-0000-000000000001'::uuid],
  (select updated_at from operator_transcript_version));

select is((select processing_status from public.transcripts where id='41000000-0000-0000-0000-000000000001'),'ready',
  'the final operator item decision finalizes the reviewed meeting');
select is((select metadata->>'evidence_grade' from public.transcripts where id='41000000-0000-0000-0000-000000000001'),'operator_reviewed',
  'operator finalization never stamps owner confirmation');
select is((select count(*)::integer from public.promises where review_status='pending_owner' and status='pending_review'),3,
  'operator promises are non-live owner review proposals');
select is((select count(*)::integer from public.promises where status='open'),0,
  'operator promises do not enter open commitment consumers');
select is((select count(*)::integer from public.pending_changes where source='recording_operator' and status='pending'),2,
  'operator actions land in Changes rather than the action ledger');
select is((select count(*)::integer from public.relationship_actions),0,
  'operator routing creates no live relationship action');
select is((select count(*)::integer from public.jobs where job_type='recording_baseline_operator' and status='queued'),1,
  'operator finalization enqueues one proposal-only baseline job');
select is((select status from public.recording_followups where id='51000000-0000-0000-0000-000000000006'),'completed',
  'operator Already done is a terminal completed raw item');
select ok((select target_table is null and target_id is null from public.recording_followups where id='51000000-0000-0000-0000-000000000006'),
  'operator Already done creates no downstream target');
select is((select status from public.recording_followups where id='51000000-0000-0000-0000-000000000007'),'dismissed',
  'operator Decline is a terminal dismissed raw item');
select ok((select target_table is null and target_id is null from public.recording_followups where id='51000000-0000-0000-0000-000000000007'),
  'operator Decline creates no downstream target');
insert into operator_results
select 'raw_already_done_retry',public.lbb_operator_decide_recording_followup(
  '21000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000006',
  '11000000-0000-0000-0000-000000000002',null,'already_done',null,null,null,
  array['31000000-0000-0000-0000-000000000001'::uuid],
  (select updated_at from operator_transcript_version));
insert into operator_results
select 'raw_decline_retry',public.lbb_operator_decide_recording_followup(
  '21000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000007',
  '11000000-0000-0000-0000-000000000002',null,'decline',null,null,null,
  array['31000000-0000-0000-0000-000000000001'::uuid],
  (select updated_at from operator_transcript_version));
select is((select payload->>'duplicate' from operator_results where label='raw_already_done_retry'),'true',
  'exact Already done retry is idempotent');
select is((select payload->>'duplicate' from operator_results where label='raw_decline_retry'),'true',
  'exact Decline retry is idempotent');
select throws_ok($$
  select public.lbb_operator_decide_recording_followup(
    '21000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000006',
    '11000000-0000-0000-0000-000000000002',null,'decline',null,null,null,
    array['31000000-0000-0000-0000-000000000001'::uuid],
    (select updated_at from operator_transcript_version))
$$,'40001','recording follow-up was already resolved','changed Already done retry conflicts');
select throws_ok($$
  select public.lbb_operator_decide_recording_followup(
    '21000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000007',
    '11000000-0000-0000-0000-000000000002',null,'already_done',null,null,null,
    array['31000000-0000-0000-0000-000000000001'::uuid],
    (select updated_at from operator_transcript_version))
$$,'40001','recording follow-up was already resolved','changed Decline retry conflicts');

create temporary table owner_review_ids as
select followup.source_item_index,promise.id,promise.updated_at
from public.promises promise
join public.recording_followups followup on followup.target_table='promises' and followup.target_id=promise.id;
select throws_ok(format($sql$
  select public.lbb_review_operator_routed_promise(
    '21000000-0000-0000-0000-000000000001','%s','11000000-0000-0000-0000-000000000003','accept','%s')
$sql$,(select id from owner_review_ids where source_item_index=0),
  (select updated_at from owner_review_ids where source_item_index=0)),
  '42501','active recording owner access required','a cross-tenant owner cannot review the proposal');
insert into operator_results select 'owner_accept',public.lbb_review_operator_routed_promise(
  '21000000-0000-0000-0000-000000000001',(select id from owner_review_ids where source_item_index=0),
  '11000000-0000-0000-0000-000000000001','accept',(select updated_at from owner_review_ids where source_item_index=0));
insert into operator_results select 'owner_already_done',public.lbb_review_operator_routed_promise(
  '21000000-0000-0000-0000-000000000001',(select id from owner_review_ids where source_item_index=1),
  '11000000-0000-0000-0000-000000000001','already_done',(select updated_at from owner_review_ids where source_item_index=1));
insert into operator_results select 'owner_decline',public.lbb_review_operator_routed_promise(
  '21000000-0000-0000-0000-000000000001',(select id from owner_review_ids where source_item_index=2),
  '11000000-0000-0000-0000-000000000001','decline',(select updated_at from owner_review_ids where source_item_index=2));
select is((select status from public.promises promise join owner_review_ids ids using(id) where ids.source_item_index=0),'open',
  'owner Approve activates the promise');
select is((select status from public.promises promise join owner_review_ids ids using(id) where ids.source_item_index=1),'completed',
  'owner Already done records a completed accepted promise');
select ok((select completed_at is not null from public.promises promise join owner_review_ids ids using(id) where ids.source_item_index=1),
  'Already done records completion time');
select is((select status from public.promises promise join owner_review_ids ids using(id) where ids.source_item_index=2),'skipped',
  'owner Decline keeps the proposal out of live promises');
select throws_ok(format($sql$
  select public.lbb_review_operator_routed_promise(
    '21000000-0000-0000-0000-000000000001','%s','11000000-0000-0000-0000-000000000001','already_done',null)
$sql$,(select id from owner_review_ids where source_item_index=0)),
  '40001','operator-routed promise was already reviewed','opposite promise retry conflicts');

create temporary table action_review_ids as
select followup.source_item_index,change.id
from public.pending_changes change
join public.recording_followups followup on followup.target_table='pending_changes' and followup.target_id=change.id
where change.source='recording_operator';
insert into operator_results select 'action_owner_approve',public.lbb_review_operator_recording_action(
  '21000000-0000-0000-0000-000000000001',(select id from action_review_ids where source_item_index=3),
  '11000000-0000-0000-0000-000000000001','approve');
insert into operator_results select 'action_owner_decline',public.lbb_review_operator_recording_action(
  '21000000-0000-0000-0000-000000000001',(select id from action_review_ids where source_item_index=4),
  '11000000-0000-0000-0000-000000000001','decline');
select is((select count(*)::integer from public.relationship_actions),1,
  'owner Approve creates exactly one live action');
select is((select count(*)::integer from public.pending_changes where source='recording_operator' and status='dismissed'),1,
  'owner Decline dismisses the action proposal');

create temporary table claimed_baseline as
select * from public.lbb_claim_next_recording_baseline_job(300);
select is((select count(*)::integer from claimed_baseline),1,'the unified cron claimant leases one AI job');
select is((select job_type from claimed_baseline),'recording_baseline_operator','the unified claimant identifies operator proposal mode');
create temporary table contact_before_baseline as
select company_name,updated_at from public.contacts where id='31000000-0000-0000-0000-000000000001';
insert into operator_results
select 'baseline_apply',public.lbb_apply_operator_recording_baseline(
  job_id,lock_token,'recording_baseline_v2','gen_operator_test_1',
  '{"company_name":{"confidence":0.95,"evidence_summary":"Acme","value":"Acme"}}'::jsonb
) from claimed_baseline;
select is((select company_name from public.contacts where id='31000000-0000-0000-0000-000000000001'),null::text,
  'operator baseline apply never writes a contact field');
select is((select updated_at from public.contacts where id='31000000-0000-0000-0000-000000000001'),
  (select updated_at from contact_before_baseline),'operator baseline apply leaves the contact version unchanged');
select is((select count(*)::integer from public.field_provenance where record_id='31000000-0000-0000-0000-000000000001'),0,
  'operator baseline apply writes no field provenance before owner approval');
select is((select count(*)::integer from public.pending_changes where source='recording_baseline' and status='pending'),1,
  'operator baseline apply creates one owner Changes proposal');
select is((select actor_type from public.audit_log where action='recording.operator_baseline_proposed'),'operator',
  'operator baseline completion audit preserves the initiating operator');
select is((select public.lbb_apply_operator_recording_baseline(
    job_id,lock_token,'recording_baseline_v2','gen_operator_test_1',
    '{"company_name":{"confidence":0.95,"evidence_summary":"Acme","value":"Acme"}}'::jsonb
  )->>'duplicate' from claimed_baseline),'true','exact baseline completion retry is idempotent');
select throws_ok(format($sql$
  select public.lbb_apply_operator_recording_baseline(
    '%s','%s','recording_baseline_v2','gen_operator_test_1',
    '{"company_name":{"confidence":0.95,"evidence_summary":"Acme","value":"Different"}}'::jsonb)
$sql$,(select job_id from claimed_baseline),(select lock_token from claimed_baseline)),
  '40001','operator recording baseline completion idempotency conflict','changed baseline completion retry conflicts');

create temporary table baseline_change as
select id from public.pending_changes where source='recording_baseline' and status='pending';
create temporary table baseline_change_original as
select id,payload from public.pending_changes where id=(select id from baseline_change);
update public.pending_changes
set payload=jsonb_set(jsonb_set(payload,'{proposed_value}','"Tampered"'::jsonb),
  '{fields,company_name}','"Tampered"'::jsonb)
where id=(select id from baseline_change);
select throws_ok(format($sql$
  select public.lbb_review_recording_baseline_change(
    '21000000-0000-0000-0000-000000000001','%s',
    '11000000-0000-0000-0000-000000000001','approve')
$sql$,(select id from baseline_change)),
  '22023','operator recording baseline proposal integrity check failed',
  'owner review rejects a tampered operator baseline proposal');
update public.pending_changes change
set payload=original.payload
from baseline_change_original original
where change.id=original.id;
insert into operator_results select 'baseline_owner_approve',public.lbb_review_recording_baseline_change(
  '21000000-0000-0000-0000-000000000001',(select id from baseline_change),
  '11000000-0000-0000-0000-000000000001','approve');
select is((select company_name from public.contacts where id='31000000-0000-0000-0000-000000000001'),'Acme',
  'only the owner Changes approval writes the contact field');
select is((select count(*)::integer from public.field_provenance where record_id='31000000-0000-0000-0000-000000000001'),1,
  'owner Changes approval writes provenance atomically');
select is((select status from public.pending_changes where id=(select id from baseline_change)),'approved',
  'owner Changes approval resolves the proposal atomically');

select * from finish();
rollback;
