-- Forward-only closure for schema changes that exist in the authoritative
-- hosted project but were not represented by matching migration timestamps.
-- This migration is intentionally idempotent so it can be rehearsed against
-- both a clean replay and the current hosted schema without ledger repair.

alter table public.interactions
  add column if not exists idempotency_key text;

alter table public.pending_changes
  add column if not exists idempotency_key text;

create unique index if not exists interactions_tenant_idempotency_key_idx
  on public.interactions (tenant_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists pending_changes_tenant_idempotency_key_idx
  on public.pending_changes (tenant_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.lbb_create_pending_change(
  p_tenant_id uuid,
  p_idempotency_key text,
  p_contact_id uuid,
  p_change_type text,
  p_summary text,
  p_payload jsonb,
  p_source text,
  p_risk_level text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  existing_id uuid;
  new_id uuid;
  normalized_key text := nullif(trim(p_idempotency_key), '');
  normalized_source text := coalesce(nullif(trim(p_source), ''), 'client_claude_project');
  normalized_risk text := case when p_risk_level = 'high' then 'high' else 'low' end;
  normalized_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Tenant does not exist.' using errcode = '22023';
  end if;

  if p_contact_id is not null and not exists (
    select 1 from public.contacts where tenant_id = p_tenant_id and id = p_contact_id
  ) then
    raise exception 'contact_id must belong to this tenant.' using errcode = '22023';
  end if;

  insert into public.pending_changes (
    tenant_id,
    contact_id,
    change_type,
    summary,
    payload,
    source,
    risk_level,
    proposed_by,
    idempotency_key
  ) values (
    p_tenant_id,
    p_contact_id,
    trim(p_change_type),
    trim(p_summary),
    normalized_payload,
    normalized_source,
    normalized_risk,
    'claude',
    normalized_key
  )
  on conflict (tenant_id, idempotency_key)
    where idempotency_key is not null
  do nothing
  returning id into new_id;

  if new_id is null then
    select id into existing_id
    from public.pending_changes
    where tenant_id = p_tenant_id and idempotency_key = normalized_key
    limit 1;

    if existing_id is not null then
      return jsonb_build_object('id', existing_id, 'duplicate', true);
    end if;

    raise exception 'Pending change could not be recorded.' using errcode = '40001';
  end if;

  insert into public.audit_log (
    tenant_id,
    actor_type,
    action,
    table_name,
    record_id,
    after
  ) values (
    p_tenant_id,
    'claude',
    'pending_change.created',
    'pending_changes',
    new_id,
    jsonb_build_object(
      'change_type', trim(p_change_type),
      'source', normalized_source,
      'risk_level', normalized_risk,
      'idempotency_key', normalized_key,
      'payload_keys', coalesce((
        select jsonb_agg(payload_key order by payload_key)
        from jsonb_object_keys(normalized_payload) as payload_keys(payload_key)
      ), '[]'::jsonb)
    )
  );

  insert into public.usage_events (
    tenant_id,
    actor_type,
    event_type,
    quantity,
    unit,
    metadata
  ) values (
    p_tenant_id,
    'claude',
    'pending_change_created',
    1,
    'change',
    jsonb_build_object('source', normalized_source, 'idempotency_key', normalized_key)
  );

  return jsonb_build_object('id', new_id, 'duplicate', false);
end;
$$;

revoke execute on function public.lbb_create_pending_change(
  uuid, text, uuid, text, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.lbb_create_pending_change(
  uuid, text, uuid, text, text, jsonb, text, text
) to service_role;

-- Preserve current tenant values while filling keys that predate the managed
-- install template.
with defaults as (
  select
    '{"ask":true,"networking":true,"engagement":true,"want_to_know":true,"scoreboard":true}'::jsonb as modules,
    '{"enrichment_monthly":25,"pulse_posts_monthly":60,"claude_writes_daily":100}'::jsonb as quotas,
    '{"mechanical_writes":true,"judgment_fields":"proposal_only","transcript_storage":"intake_full_then_notes"}'::jsonb as write_rules,
    '{"network_thesis":"","referral_lanes":"","prospecting_focus":"","outreach_focus":"","relationship_rules":"","intake_notes":""}'::jsonb as onboarding,
    '{"buckets":[]}'::jsonb as prospecting,
    '{"owner_voice":"","assistant_style":"","default_outreach_tone":""}'::jsonb as voice_profile
)
update public.tenants
set settings = settings || jsonb_build_object(
  'modules', defaults.modules || coalesce(settings->'modules', '{}'::jsonb),
  'quotas', defaults.quotas || coalesce(settings->'quotas', '{}'::jsonb),
  'write_rules', defaults.write_rules || coalesce(settings->'write_rules', '{}'::jsonb),
  'onboarding', defaults.onboarding || coalesce(settings->'onboarding', '{}'::jsonb),
  'prospecting', defaults.prospecting || coalesce(settings->'prospecting', '{}'::jsonb),
  'voice_profile', defaults.voice_profile || coalesce(settings->'voice_profile', '{}'::jsonb)
)
from defaults;

-- The product has no anonymous database-browsing mode. RLS remains enabled,
-- but these revokes remove the unnecessary privilege layer as well.
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

alter default privileges in schema public
  revoke all privileges on tables from anon;
alter default privileges in schema public
  revoke all privileges on sequences from anon;
alter default privileges in schema public
  revoke execute on functions from public;
alter default privileges in schema public
  revoke execute on functions from anon;

-- Browser-authenticated access is read-only. All workflow mutations go through
-- checked server actions or narrowly granted service-role RPCs.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from authenticated;

drop policy if exists "members insert ask runs" on public.ask_runs;
drop policy if exists "members update ask runs" on public.ask_runs;
drop policy if exists "members delete ask runs" on public.ask_runs;
drop policy if exists "gateway append audit log" on public.audit_log;
drop policy if exists "members insert contacts" on public.contacts;
drop policy if exists "members update contacts" on public.contacts;
drop policy if exists "owner and operator delete contacts" on public.contacts;
drop policy if exists "members insert interaction contacts" on public.interaction_contacts;
drop policy if exists "members update interaction contacts" on public.interaction_contacts;
drop policy if exists "members delete interaction contacts" on public.interaction_contacts;
drop policy if exists "members insert interactions" on public.interactions;
drop policy if exists "members insert introductions" on public.introductions;
drop policy if exists "members update introductions" on public.introductions;
drop policy if exists "members delete introductions" on public.introductions;
drop policy if exists "members review pending changes" on public.pending_changes;
drop policy if exists "members insert promises" on public.promises;
drop policy if exists "members update promises" on public.promises;
drop policy if exists "members delete promises" on public.promises;
drop policy if exists "members insert relationship actions" on public.relationship_actions;
drop policy if exists "members update relationship actions" on public.relationship_actions;
drop policy if exists "members delete relationship actions" on public.relationship_actions;
drop policy if exists "owners insert tenant members" on public.tenant_members;
drop policy if exists "owners update tenant members" on public.tenant_members;
drop policy if exists "owners delete tenant members" on public.tenant_members;
drop policy if exists "owners update tenant" on public.tenants;
drop policy if exists "owner and operator insert transcript metadata" on public.transcripts;
drop policy if exists "owner and operator update transcript metadata" on public.transcripts;
drop policy if exists "owner and operator delete transcript metadata" on public.transcripts;
drop policy if exists "members insert want to know" on public.want_to_know;
drop policy if exists "members update want to know" on public.want_to_know;
drop policy if exists "members delete want to know" on public.want_to_know;

-- Foreign-key indexes reported by the branch advisor after the canonical and
-- recording migrations were replayed.
create index if not exists client_import_batches_created_by_idx
  on public.client_import_batches (created_by);
create index if not exists client_import_batches_rolled_back_by_idx
  on public.client_import_batches (rolled_back_by)
  where rolled_back_by is not null;
create index if not exists integration_connections_authorization_attested_by_idx
  on public.integration_connections (authorization_attested_by)
  where authorization_attested_by is not null;
create index if not exists integration_connections_authorized_owner_user_idx
  on public.integration_connections (authorized_owner_user_id)
  where authorized_owner_user_id is not null;
create index if not exists integration_connections_consented_by_idx
  on public.integration_connections (consented_by)
  where consented_by is not null;
create index if not exists recording_ingest_receipts_owner_user_idx
  on public.recording_ingest_receipts (owner_user_id);
create index if not exists recording_ingest_receipts_tenant_connection_owner_idx
  on public.recording_ingest_receipts (tenant_id, connection_id, owner_user_id);
create index if not exists transcripts_owner_user_idx
  on public.transcripts (owner_user_id)
  where owner_user_id is not null;
create index if not exists transcripts_tenant_connection_owner_idx
  on public.transcripts (tenant_id, connection_id, owner_user_id)
  where connection_id is not null and owner_user_id is not null;
