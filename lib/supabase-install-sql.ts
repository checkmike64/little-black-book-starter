export const tenantBootstrapSql = `-- Little Black Book tenant bootstrap
-- Run from the Supabase SQL editor after the executive owner has signed in once.
-- Replace OWNER_EMAIL_HERE, OPTIONAL_OPERATOR_EMAIL_HERE, Client Name, and client-name.

with owner_user as (
  select id
  from auth.users
  where lower(email) = lower('OWNER_EMAIL_HERE')
  limit 1
),
created_tenant as (
  insert into public.tenants (name, slug, owner_user_id, settings)
  select
    'Client Name',
    'client-name',
    owner_user.id,
    '{
      "modules": {
        "ask": true,
        "networking": true,
        "engagement": true,
        "want_to_know": true
      },
      "quotas": {
        "enrichment_monthly": 25,
        "pulse_posts_monthly": 60,
        "claude_writes_daily": 100
      },
      "providers": {
        "apify": {
          "enabled": false,
          "credential_owner": "operator",
          "monthly_cost_limit_usd": 10,
          "markup_percent": 0,
          "included_usage_usd": 0
        },
        "outscraper": {
          "enabled": false,
          "credential_owner": "operator",
          "monthly_cost_limit_usd": 10,
          "markup_percent": 0,
          "included_usage_usd": 0
        }
      },
      "write_rules": {
        "mechanical_writes": true,
        "judgment_fields": "proposal_only",
        "transcript_storage": "intake_full_then_notes"
      },
      "onboarding": {
        "network_thesis": "",
        "referral_lanes": "",
        "prospecting_focus": "",
        "outreach_focus": "",
        "relationship_rules": "",
        "intake_notes": ""
      },
      "prospecting": {
        "buckets": []
      },
      "voice_profile": {
        "owner_voice": "",
        "assistant_style": "",
        "default_outreach_tone": ""
      },
      "retention": {
        "raw_transcript_days": 30
      },
      "prompt_versions": {
      },
      "delivery": {
        "launch_notes": ""
      }
    }'::jsonb
  from owner_user
  returning id, owner_user_id
),
owner_member as (
  insert into public.tenant_members (tenant_id, user_id, role, status)
  select id, owner_user_id, 'owner', 'active'
  from created_tenant
  on conflict (tenant_id, user_id) do update
    set role = excluded.role,
        status = excluded.status
  returning tenant_id, user_id, role
)
select
  tenant_id as default_tenant_id,
  user_id as owner_user_id,
  role
from owner_member;

-- Optional operator membership. Run only after the operator has signed in once.
-- insert into public.tenant_members (tenant_id, user_id, role, status)
-- select
--   'TENANT_UUID_HERE',
--   auth.users.id,
--   'operator',
--   'active'
-- from auth.users
-- where lower(email) = lower('OPTIONAL_OPERATOR_EMAIL_HERE')
-- on conflict (tenant_id, user_id) do update
--   set role = excluded.role,
--       status = excluded.status;
`;

export const existingDataBackfillSql = `-- Existing project backfill
-- Use only when converting an existing single-client project with rows that have null tenant_id.
-- Replace TENANT_UUID_HERE first.

update public.contacts set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
update public.connections set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
update public.introductions set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
update public.interactions set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
update public.interaction_contacts set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
update public.promises set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
update public.signals set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
update public.want_to_know set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
update public.pending_changes set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
update public.field_provenance set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
update public.transcripts set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
update public.jobs set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
update public.usage_events set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
update public.audit_log set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
`;

export const supabaseLiveAuditSql = `-- Little Black Book live Supabase audit
-- Run in the client project's Supabase SQL editor after migrations and tenant bootstrap.

with expected_tables(table_name) as (
  values
    ('tenants'),
    ('tenant_members'),
    ('tenant_config'),
    ('contacts'),
    ('connections'),
    ('introductions'),
    ('interactions'),
    ('interaction_contacts'),
    ('promises'),
    ('signals'),
    ('want_to_know'),
    ('pending_changes'),
    ('field_provenance'),
    ('transcripts'),
    ('jobs'),
    ('usage_events'),
    ('audit_log')
),
table_posture as (
  select
    expected_tables.table_name,
    coalesce(pg_class.relrowsecurity, false) as rls_enabled,
    count(pg_policies.policyname) as policy_count
  from expected_tables
  left join pg_class
    on pg_class.relname = expected_tables.table_name
  left join pg_namespace
    on pg_namespace.oid = pg_class.relnamespace
   and pg_namespace.nspname = 'public'
  left join pg_policies
    on pg_policies.schemaname = 'public'
   and pg_policies.tablename = expected_tables.table_name
  group by expected_tables.table_name, pg_class.relrowsecurity
)
select
  'table_posture' as check_group,
  table_name as subject,
  case when rls_enabled and policy_count > 0 then 'pass' else 'review' end as status,
  jsonb_build_object(
    'rls_enabled', rls_enabled,
    'policy_count', policy_count
  ) as detail
from table_posture

union all

select
  'storage_bucket' as check_group,
  'transcripts' as subject,
  case when exists (
    select 1 from storage.buckets
    where id = 'transcripts'
      and public = false
  ) then 'pass' else 'review' end as status,
  jsonb_build_object(
    'bucket_exists', exists (select 1 from storage.buckets where id = 'transcripts'),
    'is_private', exists (select 1 from storage.buckets where id = 'transcripts' and public = false)
  ) as detail

union all

select
  'function_posture' as check_group,
  coalesce(public_definer_functions.function_name, 'public_security_definer_functions') as subject,
  case when public_definer_functions.function_name is null then 'pass' else 'review' end as status,
  jsonb_build_object(
    'note', case
      when public_definer_functions.function_name is null
        then 'No public SECURITY DEFINER functions found.'
      else 'Unexpected public SECURITY DEFINER function. Review execute grants and search_path.'
    end
  ) as detail
from (
  select
    pg_proc.proname as function_name
  from pg_proc
  join pg_namespace
    on pg_namespace.oid = pg_proc.pronamespace
  where pg_namespace.nspname = 'public'
    and pg_proc.prosecdef
) public_definer_functions
right join (select 1) sentinel on true

union all

select
  'membership' as check_group,
  'active_tenant_members' as subject,
  case when count(*) between 1 and 2 then 'pass' else 'review' end as status,
  jsonb_build_object(
    'active_members', count(*),
    'roles', jsonb_agg(distinct role)
  ) as detail
from public.tenant_members
where status = 'active'
order by check_group, subject;
`;
