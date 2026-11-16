-- Little Black Book tenant bootstrap
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

