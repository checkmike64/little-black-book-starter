begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

select ok(
  not has_function_privilege(
    'anon',
    'public.lbb_update_production_check(uuid,uuid,integer,text,boolean,text)',
    'execute'
  ),
  'anon cannot execute the production evidence RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.lbb_update_production_check(uuid,uuid,integer,text,boolean,text)',
    'execute'
  ),
  'authenticated cannot execute the production evidence RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.lbb_update_production_check(uuid,uuid,integer,text,boolean,text)',
    'execute'
  ),
  'service role can execute the production evidence RPC'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'lbb_update_production_check'
  ),
  1,
  'the RPC has no overload'
);

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
) values (
  '10000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'operator-test@example.invalid',
  '',
  now(),
  now(),
  now()
);

insert into public.tenants (id, name, settings)
values (
  '20000000-0000-0000-0000-000000000001',
  'Production evidence test',
  '{"delivery":{"production_checks":{}}}'::jsonb
);

insert into public.tenant_members (tenant_id, user_id, role, status)
values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'operator',
  'active'
);

create temporary table production_check_results (payload jsonb);

insert into production_check_results
select public.lbb_update_production_check(
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  1,
  'support_contact_and_process_ready',
  true,
  'packet/support-v1'
);

select is(
  (select payload #>> '{production_check,confirmed}' from production_check_results),
  'true',
  'confirmation is stored'
);
select is(
  (select payload #>> '{production_check,evidence_ref}' from production_check_results),
  'packet/support-v1',
  'the opaque evidence reference is stored'
);
select is(
  (select (payload ->> 'settings_version')::integer from production_check_results),
  2,
  'the settings version advances'
);
select is(
  (select count(*)::integer from public.audit_log where action = 'deployment.production_check_confirmed'),
  1,
  'confirmation writes one audit receipt'
);
select is(
  (select actor_type from public.audit_log where action = 'deployment.production_check_confirmed'),
  'operator',
  'the audit receipt records the operator actor type'
);

truncate production_check_results;
insert into production_check_results
select public.lbb_update_production_check(
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  1,
  'support_contact_and_process_ready',
  true,
  'packet/support-v1'
);

select is(
  (select payload ->> 'idempotent' from production_check_results),
  'true',
  'an exact retry is idempotent even with the original expected version'
);
select is(
  (select count(*)::integer from public.audit_log where action = 'deployment.production_check_confirmed'),
  1,
  'an exact retry writes no second audit receipt'
);
select throws_ok(
  $$
    select public.lbb_update_production_check(
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      1,
      'support_contact_and_process_ready',
      true,
      'packet/support-v2'
    )
  $$,
  '40001',
  'Production evidence changed in another session.',
  'changed evidence requires a current settings version'
);
select is(
  (select settings_version from public.tenants where id = '20000000-0000-0000-0000-000000000001'),
  2,
  'a failed CAS does not change settings'
);

truncate production_check_results;
insert into production_check_results
select public.lbb_update_production_check(
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  2,
  'support_contact_and_process_ready',
  true,
  'packet/support-v2'
);

select is(
  (select (payload ->> 'settings_version')::integer from production_check_results),
  3,
  'changed evidence succeeds with the current version'
);
select is(
  (select count(*)::integer from public.audit_log where action = 'deployment.production_check_confirmed'),
  2,
  'changed evidence records a new audit receipt'
);
select throws_ok(
  $$
    select public.lbb_update_production_check(
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      2,
      'support_contact_and_process_ready',
      false,
      null
    )
  $$,
  '40001',
  'Production evidence changed in another session.',
  'the opposite state also requires a current settings version'
);

truncate production_check_results;
insert into production_check_results
select public.lbb_update_production_check(
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  3,
  'support_contact_and_process_ready',
  false,
  null
);

select is(
  (select payload #>> '{production_check,confirmed}' from production_check_results),
  'false',
  'a current-version clear succeeds'
);
select ok(
  (select payload #> '{production_check,evidence_ref}' from production_check_results) = 'null'::jsonb,
  'clearing removes the evidence reference'
);
select is(
  (select (payload ->> 'settings_version')::integer from production_check_results),
  4,
  'clearing advances the settings version'
);
select is(
  (select count(*)::integer from public.audit_log where action = 'deployment.production_check_cleared'),
  1,
  'clearing records one audit receipt'
);
select throws_ok(
  $$
    select public.lbb_update_production_check(
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      4,
      'not_a_check',
      true,
      'packet/invalid-key'
    )
  $$,
  '22023',
  'Unknown production check.',
  'unknown check keys are rejected'
);
select throws_ok(
  $$
    select public.lbb_update_production_check(
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      4,
      'support_contact_and_process_ready',
      true,
      'short'
    )
  $$,
  '22023',
  'A bounded opaque external evidence ID is required.',
  'short evidence references are rejected'
);
select throws_ok(
  $$
    select public.lbb_update_production_check(
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      4,
      'support_contact_and_process_ready',
      true,
      'https://records.example/evidence'
    )
  $$,
  '22023',
  'A bounded opaque external evidence ID is required.',
  'URLs are not accepted as opaque evidence references'
);

update public.tenant_members
set status = 'disabled'
where tenant_id = '20000000-0000-0000-0000-000000000001'
  and user_id = '10000000-0000-0000-0000-000000000001';

select throws_ok(
  $$
    select public.lbb_update_production_check(
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      4,
      'support_contact_and_process_ready',
      true,
      'packet/support-v3'
    )
  $$,
  '42501',
  'Only an active tenant owner or operator can update production evidence.',
  'inactive members cannot update production evidence'
);

select * from finish();
rollback;
