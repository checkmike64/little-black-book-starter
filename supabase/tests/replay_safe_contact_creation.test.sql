begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

select ok(not has_function_privilege(
  'anon',
  'public.lbb_create_contact_once(uuid,uuid,text,jsonb,text,jsonb)',
  'execute'
), 'anon cannot execute contact creation');
select ok(not has_function_privilege(
  'authenticated',
  'public.lbb_create_contact_once(uuid,uuid,text,jsonb,text,jsonb)',
  'execute'
), 'authenticated cannot execute contact creation');
select ok(has_function_privilege(
  'service_role',
  'public.lbb_create_contact_once(uuid,uuid,text,jsonb,text,jsonb)',
  'execute'
), 'service role can execute contact creation');
select ok(not has_function_privilege(
  'anon',
  'public.lbb_approve_new_contact_once(uuid,uuid,uuid,jsonb,text,jsonb)',
  'execute'
), 'anon cannot execute new-person approval');
select ok(not has_function_privilege(
  'authenticated',
  'public.lbb_approve_new_contact_once(uuid,uuid,uuid,jsonb,text,jsonb)',
  'execute'
), 'authenticated cannot execute new-person approval');
select ok(has_function_privilege(
  'service_role',
  'public.lbb_approve_new_contact_once(uuid,uuid,uuid,jsonb,text,jsonb)',
  'execute'
), 'service role can execute new-person approval');
select ok(not has_table_privilege(
  'authenticated', 'app_private.contact_creation_requests', 'select'
), 'authenticated cannot read private replay keys');

insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values
  ('12000000-0000-4000-8000-000000000001','authenticated','authenticated','creator@example.invalid','',now(),now(),now()),
  ('12000000-0000-4000-8000-000000000002','authenticated','authenticated','inactive@example.invalid','',now(),now(),now());
insert into public.tenants (id,name) values
  ('22000000-0000-4000-8000-000000000001','Replay tenant one'),
  ('22000000-0000-4000-8000-000000000002','Replay tenant two');
insert into public.tenant_members (tenant_id,user_id,role,status) values
  ('22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','owner','active'),
  ('22000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000001','operator','active'),
  ('22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000002','operator','disabled');

create temporary table creation_results (label text primary key, payload jsonb);
insert into creation_results values ('first', public.lbb_create_contact_once(
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'manual-intake:request-one',
  '{"full_name":"Replay Person","email":"replay@example.invalid","relationship_type":["Peer","Referral Partner"]}'::jsonb,
  'manual_intake', '{"intake":{"reviewed":true}}'::jsonb
));
select is((select payload->>'created' from creation_results where label='first'), 'true',
  'first request creates a contact');
select is((select count(*)::integer from public.contacts where full_name='Replay Person'), 1,
  'first request creates exactly one contact');
select is(
  (select relationship_type from public.contacts where full_name='Replay Person'),
  array['Peer','Referral Partner']::text[],
  'manual creation persists the relationship type payload'
);

insert into creation_results values ('replay', public.lbb_create_contact_once(
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'manual-intake:request-one',
  '{"full_name":"Replay Person","email":"replay@example.invalid","relationship_type":["Peer","Referral Partner"]}'::jsonb,
  'manual_intake', '{"intake":{"reviewed":true}}'::jsonb
));
select is((select payload->>'replayed' from creation_results where label='replay'), 'true',
  'exact retry is identified as a replay');
select is(
  (select payload->>'contact_id' from creation_results where label='first'),
  (select payload->>'contact_id' from creation_results where label='replay'),
  'exact retry returns the same contact');
select is((select count(*)::integer from public.contacts where full_name='Replay Person'), 1,
  'exact retry creates no duplicate');
select throws_ok($$
  select public.lbb_create_contact_once(
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'manual-intake:request-one',
    '{"full_name":"Changed Person"}'::jsonb, 'manual_intake', '{}'::jsonb)
$$, '22023', 'creation_request_key was already used with a different payload.',
  'same key with a changed payload is rejected');

insert into creation_results values ('other_tenant', public.lbb_create_contact_once(
  '22000000-0000-4000-8000-000000000002',
  '12000000-0000-4000-8000-000000000001',
  'manual-intake:request-one',
  '{"full_name":"Other Tenant Person"}'::jsonb, 'manual_intake', '{}'::jsonb
));
select is((select payload->>'created' from creation_results where label='other_tenant'), 'true',
  'the same request key is independent in another tenant');
select throws_ok($$
  select public.lbb_create_contact_once(
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000002',
    'manual-intake:inactive',
    '{"full_name":"Denied Person"}'::jsonb, 'manual_intake', '{}'::jsonb)
$$, '42501', 'Actor is not an active member of this tenant.',
  'inactive tenant actor is rejected');
select throws_ok($$
  select public.lbb_create_contact_once(
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'manual-intake:unsupported',
    '{"full_name":"Unsafe Person","tenant_id":"22000000-0000-4000-8000-000000000002"}'::jsonb,
    'manual_intake', '{}'::jsonb)
$$, '22023', 'Unsupported contact fields: tenant_id',
  'protected contact fields are rejected');

insert into public.pending_changes (
  id,tenant_id,change_type,summary,payload,status,risk_level,source
) values (
  '32000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'new_contact','Add approval person','{"fields":{"full_name":"Approval Person"}}'::jsonb,
  'pending','high','client_claude_project'
);
insert into creation_results values ('approval', public.lbb_approve_new_contact_once(
  '22000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  '{"full_name":"Approval Person"}'::jsonb, 'claude_proposal',
  '{"pending_change_id":"32000000-0000-4000-8000-000000000001"}'::jsonb
));
select is((select payload->>'approved' from creation_results where label='approval'), 'true',
  'new-person proposal is approved');
select ok((select status='approved' and contact_id is not null from public.pending_changes
  where id='32000000-0000-4000-8000-000000000001'),
  'approval atomically links the pending change to its contact');
insert into creation_results values ('approval_replay', public.lbb_approve_new_contact_once(
  '22000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  '{"full_name":"Approval Person"}'::jsonb, 'claude_proposal',
  '{"pending_change_id":"32000000-0000-4000-8000-000000000001"}'::jsonb
));
select is((select payload->>'approval_replayed' from creation_results where label='approval_replay'), 'true',
  'approval retry returns the existing approved contact');
select is((select count(*)::integer from public.contacts where full_name='Approval Person'), 1,
  'approval retry creates no duplicate contact');
select throws_ok($$
  select public.lbb_approve_new_contact_once(
    '22000000-0000-4000-8000-000000000001',
    '32000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    '{"full_name":"Changed Approval Person"}'::jsonb, 'claude_proposal',
    '{"pending_change_id":"32000000-0000-4000-8000-000000000001"}'::jsonb)
$$, '22023', 'creation_request_key was already used with a different payload.',
  'approval retry with changed content is rejected');

select * from finish();
rollback;
