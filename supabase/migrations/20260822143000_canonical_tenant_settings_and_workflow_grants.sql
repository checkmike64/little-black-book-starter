-- Canonical install configuration and workflow grant hardening.
--
-- `tenants.settings` is the only writable configuration source. The legacy
-- `tenant_config` table is retained as a read-only compatibility projection so
-- an existing integration cannot silently observe stale configuration.
--
-- This migration also opts every browser-readable table into the Data API with
-- an explicit SELECT grant. Supabase stopped exposing new public tables by
-- default in 2026, so grants and RLS must be declared independently.

alter table public.tenants
  add column if not exists settings_version integer not null default 1;

alter table public.tenants
  drop constraint if exists tenants_settings_version_check;
alter table public.tenants
  add constraint tenants_settings_version_check
  check (settings_version > 0);

alter table public.tenant_config
  add column if not exists settings_version integer not null default 1;

create or replace function app_private.bump_tenant_settings_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.settings is distinct from old.settings then
    new.settings_version := greatest(old.settings_version + 1, new.settings_version);
  else
    new.settings_version := greatest(old.settings_version, new.settings_version);
  end if;
  return new;
end;
$$;

revoke all on function app_private.bump_tenant_settings_version()
  from public, anon, authenticated;

drop trigger if exists bump_tenant_settings_version on public.tenants;
create trigger bump_tenant_settings_version
before update of settings, settings_version on public.tenants
for each row execute function app_private.bump_tenant_settings_version();

create or replace function app_private.sync_tenant_config_from_settings()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.tenant_config (
    tenant_id,
    modules,
    quotas,
    write_rules,
    voice_profile,
    onboarding,
    retention,
    prompt_versions,
    settings_version,
    updated_at
  ) values (
    new.id,
    coalesce(new.settings -> 'modules', '{}'::jsonb),
    coalesce(new.settings -> 'quotas', '{}'::jsonb),
    coalesce(new.settings -> 'write_rules', '{}'::jsonb),
    coalesce(new.settings -> 'voice_profile', '{}'::jsonb),
    coalesce(new.settings -> 'onboarding', '{}'::jsonb),
    coalesce(new.settings -> 'retention', '{"raw_transcript_days":30}'::jsonb),
    coalesce(new.settings -> 'prompt_versions', '{}'::jsonb),
    new.settings_version,
    now()
  )
  on conflict (tenant_id) do update
  set modules = excluded.modules,
      quotas = excluded.quotas,
      write_rules = excluded.write_rules,
      voice_profile = excluded.voice_profile,
      onboarding = excluded.onboarding,
      retention = excluded.retention,
      prompt_versions = excluded.prompt_versions,
      settings_version = excluded.settings_version,
      updated_at = excluded.updated_at;
  return new;
end;
$$;

revoke all on function app_private.sync_tenant_config_from_settings()
  from public, anon, authenticated;

drop trigger if exists sync_tenant_config_from_settings on public.tenants;
create trigger sync_tenant_config_from_settings
after insert or update of settings, settings_version on public.tenants
for each row execute function app_private.sync_tenant_config_from_settings();

-- Reconcile the compatibility projection before making it read-only.
update public.tenants
set settings = settings,
    settings_version = settings_version;

drop policy if exists "owner and operator update config" on public.tenant_config;
revoke insert, update, delete, truncate, references, trigger
  on table public.tenant_config from authenticated;

-- Relationship and workflow changes go through authenticated server actions or
-- service-role-only RPCs so validation, approvals, and audit receipts cannot be
-- bypassed with a direct browser Data API request.
revoke insert, update, delete, truncate, references, trigger on table
  public.tenants,
  public.tenant_members,
  public.contacts,
  public.connections,
  public.introductions,
  public.interactions,
  public.interaction_contacts,
  public.promises,
  public.signals,
  public.want_to_know,
  public.pending_changes,
  public.field_provenance,
  public.transcripts,
  public.jobs,
  public.usage_events,
  public.audit_log,
  public.relationship_actions,
  public.ask_runs,
  public.integration_connections,
  public.calendar_events,
  public.calendar_attendees,
  public.calendar_attendee_preferences,
  public.content_items,
  public.content_scan_sources,
  public.content_scan_runs,
  public.relationship_contexts,
  public.relationship_context_memberships,
  public.connection_contexts,
  public.recommendation_day_overrides
from authenticated;

-- Explicit Data API opt-in for the read surface. RLS remains the row-level
-- authorization layer for each table.
grant select on table
  public.tenants,
  public.tenant_members,
  public.tenant_config,
  public.contacts,
  public.connections,
  public.introductions,
  public.interactions,
  public.interaction_contacts,
  public.promises,
  public.signals,
  public.want_to_know,
  public.pending_changes,
  public.field_provenance,
  public.transcripts,
  public.jobs,
  public.usage_events,
  public.audit_log,
  public.relationship_actions,
  public.ask_runs,
  public.integration_connections,
  public.calendar_events,
  public.calendar_attendees,
  public.calendar_attendee_preferences,
  public.content_items,
  public.content_scan_sources,
  public.content_scan_runs,
  public.relationship_contexts,
  public.relationship_context_memberships,
  public.connection_contexts,
  public.recommendation_day_overrides
to authenticated;

-- Enforce the concierge boundary in the database, not only in the UI. Owners
-- consume server-rendered, owner-safe projections; only operators may query
-- strategy, prompts, provider controls, quotas, or raw operational logs.
drop policy if exists "members read tenant" on public.tenants;
create policy "operators read tenant configuration"
on public.tenants for select
to authenticated
using (app_private.has_tenant_role(id, array['operator']));

drop policy if exists "members read config" on public.tenant_config;
create policy "operators read compatibility config"
on public.tenant_config for select
to authenticated
using (app_private.has_tenant_role(tenant_id, array['operator']));

drop policy if exists "owner and operator read jobs" on public.jobs;
create policy "operators read jobs"
on public.jobs for select
to authenticated
using (tenant_id is not null and app_private.has_tenant_role(tenant_id, array['operator']));

drop policy if exists "owner and operator read usage" on public.usage_events;
create policy "operators read usage"
on public.usage_events for select
to authenticated
using (tenant_id is not null and app_private.has_tenant_role(tenant_id, array['operator']));

drop policy if exists "members read audit log" on public.audit_log;
create policy "operators read audit log"
on public.audit_log for select
to authenticated
using (tenant_id is not null and app_private.has_tenant_role(tenant_id, array['operator']));

-- OAuth transaction rows stay service-role-only and intentionally have no
-- authenticated RLS policy.
revoke all on table public.google_oauth_transactions
  from public, anon, authenticated;
grant select, insert, update, delete on table public.google_oauth_transactions
  to service_role;

-- Atomic, idempotent write-budget receipts. The route supplies a stable hashed
-- request key, so a retry does not consume quota twice.
create table if not exists public.claude_write_receipts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  usage_date date not null default current_date,
  request_key text not null check (length(request_key) between 1 and 160),
  write_class text not null check (write_class in ('mechanical', 'proposal')),
  units integer not null check (units between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (tenant_id, usage_date, request_key)
);

alter table public.claude_write_receipts enable row level security;
revoke all on table public.claude_write_receipts
  from public, anon, authenticated;
grant select, insert, update, delete on table public.claude_write_receipts
  to service_role;

create index if not exists claude_write_receipts_tenant_day_idx
  on public.claude_write_receipts (tenant_id, usage_date, created_at desc);

create or replace function public.lbb_authorize_claude_write(
  p_tenant_id uuid,
  p_write_class text,
  p_request_key text,
  p_units integer default 1
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  tenant_settings jsonb;
  quota_text text;
  quota_limit integer;
  used_units integer;
  mechanical_allowed boolean;
  tenant_time_zone text;
  usage_day date;
begin
  if p_write_class not in ('mechanical', 'proposal') then
    raise exception 'Unsupported Claude write class.' using errcode = '22023';
  end if;
  if p_request_key is null or length(trim(p_request_key)) not between 1 and 160 then
    raise exception 'A stable Claude request key is required.' using errcode = '22023';
  end if;
  if p_units not between 1 and 100 then
    raise exception 'Claude write units must be between 1 and 100.' using errcode = '22023';
  end if;

  select settings
  into tenant_settings
  from public.tenants
  where id = p_tenant_id;

  if not found then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'unknown_tenant',
      'duplicate', false
    );
  end if;

  mechanical_allowed := case lower(coalesce(
    tenant_settings #>> '{write_rules,mechanical_writes}',
    'true'
  ))
    when 'true' then true
    when 'false' then false
    else false
  end;

  if p_write_class = 'mechanical' and not mechanical_allowed then
    insert into public.audit_log (
      tenant_id, actor_type, action, table_name, metadata
    ) values (
      p_tenant_id,
      'claude',
      'claude.write_blocked',
      'claude_write_receipts',
      jsonb_build_object(
        'reason', 'mechanical_writes_disabled',
        'write_class', p_write_class,
        'request_key', p_request_key,
        'units', p_units
      )
    );
    return jsonb_build_object(
      'allowed', false,
      'reason', 'mechanical_writes_disabled',
      'duplicate', false
    );
  end if;

  quota_text := tenant_settings #>> '{quotas,claude_writes_daily}';
  quota_limit := case
    when quota_text ~ '^\d{1,9}$' then quota_text::integer
    else 100
  end;

  select name
  into tenant_time_zone
  from pg_catalog.pg_timezone_names
  where name = coalesce(
    tenant_settings #>> '{activity,time_zone}',
    'America/Mexico_City'
  )
  limit 1;
  tenant_time_zone := coalesce(tenant_time_zone, 'America/Mexico_City');
  usage_day := (statement_timestamp() at time zone tenant_time_zone)::date;

  -- Serialize this tenant/day budget while keeping independent installs and
  -- tenants free to authorize writes concurrently.
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || usage_day::text, 0)
  );

  if exists (
    select 1
    from public.claude_write_receipts
    where tenant_id = p_tenant_id
      and usage_date = usage_day
      and request_key = p_request_key
  ) then
    select coalesce(sum(units), 0)::integer
    into used_units
    from public.claude_write_receipts
    where tenant_id = p_tenant_id
      and usage_date = usage_day;
    return jsonb_build_object(
      'allowed', true,
      'reason', 'duplicate_retry',
      'duplicate', true,
      'used', used_units,
      'limit', quota_limit
    );
  end if;

  select coalesce(sum(units), 0)::integer
  into used_units
  from public.claude_write_receipts
  where tenant_id = p_tenant_id
    and usage_date = usage_day;

  if used_units + p_units > quota_limit then
    insert into public.audit_log (
      tenant_id, actor_type, action, table_name, metadata
    ) values (
      p_tenant_id,
      'claude',
      'claude.write_blocked',
      'claude_write_receipts',
      jsonb_build_object(
        'reason', 'daily_quota_exceeded',
        'write_class', p_write_class,
        'request_key', p_request_key,
        'requested_units', p_units,
        'used', used_units,
        'limit', quota_limit
      )
    );
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_quota_exceeded',
      'duplicate', false,
      'used', used_units,
      'limit', quota_limit
    );
  end if;

  insert into public.claude_write_receipts (
    tenant_id, usage_date, request_key, write_class, units
  ) values (
    p_tenant_id, usage_day, p_request_key, p_write_class, p_units
  );

  return jsonb_build_object(
    'allowed', true,
    'reason', 'authorized',
    'duplicate', false,
    'used', used_units + p_units,
    'limit', quota_limit
  );
end;
$$;

revoke execute on function public.lbb_authorize_claude_write(
  uuid, text, text, integer
) from public, anon, authenticated;
grant execute on function public.lbb_authorize_claude_write(
  uuid, text, text, integer
) to service_role;

create or replace function public.lbb_update_tenant_settings(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_settings jsonb,
  p_action text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  previous_settings jsonb;
  current_version integer;
  next_version integer;
begin
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and role = 'operator'
      and status = 'active'
  ) then
    raise exception 'Only an active operator can update install settings.' using errcode = '42501';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Settings must be a JSON object.' using errcode = '22023';
  end if;

  select settings, settings_version
  into previous_settings, current_version
  from public.tenants
  where id = p_tenant_id
  for update;
  if not found then
    raise exception 'Tenant does not exist.' using errcode = '22023';
  end if;
  if current_version <> p_expected_version then
    raise exception 'Settings changed in another session.' using errcode = '40001';
  end if;

  update public.tenants
  set settings = p_settings
  where id = p_tenant_id
  returning settings_version into next_version;

  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action, table_name, record_id, before, after
  ) values (
    p_tenant_id,
    p_actor_user_id,
    'operator',
    left(coalesce(nullif(trim(p_action), ''), 'tenant.settings.updated'), 160),
    'tenants',
    p_tenant_id,
    jsonb_build_object('settings', previous_settings, 'settings_version', current_version),
    jsonb_build_object('settings', p_settings, 'settings_version', next_version)
  );

  return jsonb_build_object('settings_version', next_version);
end;
$$;

revoke execute on function public.lbb_update_tenant_settings(
  uuid, uuid, integer, jsonb, text
) from public, anon, authenticated;
grant execute on function public.lbb_update_tenant_settings(
  uuid, uuid, integer, jsonb, text
) to service_role;

create or replace function public.lbb_record_ai_generation_ledger(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_status text,
  p_total_tokens integer,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  audit_id uuid;
  usage_id uuid;
begin
  if p_status not in ('completed', 'failed') then
    raise exception 'Unsupported AI ledger status.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Tenant does not exist.' using errcode = '22023';
  end if;
  if p_actor_user_id is not null and not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
  ) then
    raise exception 'AI actor does not belong to this tenant.' using errcode = '42501';
  end if;

  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action, table_name, metadata
  ) values (
    p_tenant_id,
    p_actor_user_id,
    'system',
    'ai.generation.' || p_status,
    'usage_events',
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into audit_id;

  if p_status = 'completed' then
    insert into public.usage_events (
      tenant_id, actor_user_id, actor_type, event_type, quantity, unit, metadata
    ) values (
      p_tenant_id,
      p_actor_user_id,
      'system',
      'ai.generation.tokens',
      greatest(coalesce(p_total_tokens, 0), 0),
      'token',
      coalesce(p_metadata, '{}'::jsonb)
    ) returning id into usage_id;
  end if;

  return jsonb_build_object('audit_id', audit_id, 'usage_event_id', usage_id);
end;
$$;

revoke execute on function public.lbb_record_ai_generation_ledger(
  uuid, uuid, text, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.lbb_record_ai_generation_ledger(
  uuid, uuid, text, integer, jsonb
) to service_role;

create or replace function public.lbb_record_grounded_networking_recommendation(
  p_tenant_id uuid,
  p_idempotency_key text,
  p_contact_a uuid,
  p_contact_b uuid,
  p_summary text,
  p_why_now text,
  p_match_type text,
  p_direction text,
  p_confidence numeric,
  p_priority_score integer,
  p_evidence jsonb,
  p_matched_terms jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  connection_id uuid;
begin
  if jsonb_typeof(p_evidence) <> 'array' then
    raise exception 'Source-referenced networking evidence is required.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_evidence) = 0 then
    raise exception 'Source-referenced networking evidence is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_matched_terms) <> 'array' then
    raise exception 'One to eight matched evidence excerpts are required.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_matched_terms) not between 1 and 8 then
    raise exception 'One to eight matched evidence excerpts are required.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_evidence) as evidence_item
    where nullif(btrim(evidence_item ->> 'source_ref'), '') is null
      or nullif(btrim(evidence_item ->> 'note'), '') is null
  ) then
    raise exception 'Every networking evidence item needs a source reference and factual note.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_matched_terms) as matched_term
    where nullif(btrim(matched_term ->> 'contact_id'), '') is null
       or nullif(btrim(matched_term ->> 'source_ref'), '') is null
       or nullif(btrim(matched_term ->> 'excerpt'), '') is null
       or not exists (
         select 1
         from jsonb_array_elements(p_evidence) as evidence_item
         where evidence_item ->> 'contact_id' = matched_term ->> 'contact_id'
           and evidence_item ->> 'source_ref' = matched_term ->> 'source_ref'
       )
  ) then
    raise exception 'Every matched term must bind one contact and exact excerpt to cited evidence.'
      using errcode = '22023';
  end if;

  result := public.lbb_record_networking_recommendation(
    p_tenant_id,
    p_idempotency_key,
    p_contact_a,
    p_contact_b,
    p_summary,
    p_why_now,
    p_match_type,
    p_direction,
    p_confidence,
    p_priority_score,
    p_evidence
  );
  connection_id := nullif(result ->> 'id', '')::uuid;
  if connection_id is not null and result ->> 'status' in ('created', 'upgraded') then
    update public.connections
    set evidence = evidence || jsonb_build_object(
      'matched_terms', (
        select jsonb_agg(matched_term ->> 'excerpt')
        from jsonb_array_elements(p_matched_terms) as matched_term
      ),
      'matched_term_refs', p_matched_terms,
      'matched_terms_source', 'stored_evidence_exact_excerpt'
    )
    where tenant_id = p_tenant_id and id = connection_id;
  end if;
  return result;
end;
$$;

revoke execute on function public.lbb_record_grounded_networking_recommendation(
  uuid, text, uuid, uuid, text, text, text, text, numeric, integer, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.lbb_record_grounded_networking_recommendation(
  uuid, text, uuid, uuid, text, text, text, text, numeric, integer, jsonb, jsonb
) to service_role;

-- Operator list imports create review proposals, never contacts. The batch
-- receipt makes the operation addressable and allows a complete rollback while
-- every imported proposal is still pending.
create table if not exists public.client_import_batches (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  file_name text not null,
  status text not null default 'applied'
    check (status in ('applied', 'rolled_back')),
  ready_count integer not null check (ready_count between 1 and 500),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  rolled_back_by uuid references auth.users(id) on delete restrict,
  rolled_back_at timestamptz
);

alter table public.client_import_batches enable row level security;
revoke all on table public.client_import_batches from public, anon, authenticated;
grant all on table public.client_import_batches to service_role;

create index if not exists client_import_batches_tenant_created_idx
  on public.client_import_batches (tenant_id, created_at desc);

create or replace function public.lbb_import_client_list_candidates(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_batch_id uuid,
  p_file_name text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  item jsonb;
  inserted_count integer := 0;
  source_row integer;
  full_name text;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Import rows must be an array of 1 to 500 reviewed candidates.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'Import rows must be an array of 1 to 500 reviewed candidates.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and role = 'operator'
      and status = 'active'
  ) then
    raise exception 'Only an active operator can import a client list.' using errcode = '42501';
  end if;

  insert into public.client_import_batches (
    id, tenant_id, file_name, ready_count, created_by
  ) values (
    p_batch_id,
    p_tenant_id,
    left(coalesce(nullif(trim(p_file_name), ''), 'client-list.csv'), 180),
    jsonb_array_length(p_rows),
    p_actor_user_id
  );

  for item in select value from jsonb_array_elements(p_rows)
  loop
    source_row := nullif(item ->> 'source_row', '')::integer;
    full_name := left(trim(coalesce(item ->> 'full_name', '')), 500);
    if source_row is null or source_row < 2 or full_name = '' then
      raise exception 'Every imported candidate needs a source row and full name.'
        using errcode = '22023';
    end if;

    insert into public.pending_changes (
      tenant_id,
      change_type,
      summary,
      payload,
      status,
      source,
      proposed_by,
      risk_level,
      idempotency_key
    ) values (
      p_tenant_id,
      'want_to_know_candidate',
      'Review ' || full_name || ' for Want to Know.',
      jsonb_build_object(
        'candidate', item - 'source_row',
        'evidence', jsonb_build_object(
          'source_type', 'operator_client_list',
          'source_ref', 'client-list:' || p_batch_id::text || ':row:' || source_row::text,
          'import_batch_id', p_batch_id,
          'file_name', left(coalesce(nullif(trim(p_file_name), ''), 'client-list.csv'), 180),
          'source_row', source_row,
          'imported_by_user_id', p_actor_user_id,
          'observed_at', statement_timestamp()
        ),
        'verification', jsonb_build_object(
          'required', true,
          'owner_question', 'Should this person enter Want to Know, and is the bucket correct?'
        )
      ),
      'pending',
      'operator_client_list',
      'operator',
      'high',
      'client-list:' || p_batch_id::text || ':row:' || source_row::text
    );
    inserted_count := inserted_count + 1;
  end loop;

  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action, table_name, record_id, after
  ) values (
    p_tenant_id,
    p_actor_user_id,
    'operator',
    'client_list.imported',
    'client_import_batches',
    p_batch_id,
    jsonb_build_object('file_name', p_file_name, 'proposal_count', inserted_count)
  );

  return jsonb_build_object('batch_id', p_batch_id, 'created', inserted_count);
end;
$$;

create or replace function public.lbb_rollback_client_list_import(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_batch_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  rolled_back_count integer;
begin
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and role = 'operator'
      and status = 'active'
  ) then
    raise exception 'Only an active operator can roll back a client list.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.client_import_batches
    where id = p_batch_id and tenant_id = p_tenant_id and status = 'applied'
    for update
  ) then
    raise exception 'That import batch is not available for rollback.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.pending_changes
    where tenant_id = p_tenant_id
      and payload #>> '{evidence,import_batch_id}' = p_batch_id::text
      and status <> 'pending'
  ) then
    raise exception 'This batch has reviewed rows and cannot be rolled back automatically.'
      using errcode = '55000';
  end if;

  update public.pending_changes
  set status = 'dismissed', reviewed_by = p_actor_user_id, reviewed_at = statement_timestamp()
  where tenant_id = p_tenant_id
    and payload #>> '{evidence,import_batch_id}' = p_batch_id::text
    and status = 'pending';
  get diagnostics rolled_back_count = row_count;

  update public.client_import_batches
  set status = 'rolled_back',
      rolled_back_by = p_actor_user_id,
      rolled_back_at = statement_timestamp()
  where id = p_batch_id and tenant_id = p_tenant_id;

  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action, table_name, record_id, after
  ) values (
    p_tenant_id,
    p_actor_user_id,
    'operator',
    'client_list.rolled_back',
    'client_import_batches',
    p_batch_id,
    jsonb_build_object('dismissed_proposals', rolled_back_count)
  );

  return jsonb_build_object('batch_id', p_batch_id, 'dismissed', rolled_back_count);
end;
$$;

revoke execute on function public.lbb_import_client_list_candidates(
  uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated;
revoke execute on function public.lbb_rollback_client_list_import(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.lbb_import_client_list_candidates(
  uuid, uuid, uuid, text, jsonb
) to service_role;
grant execute on function public.lbb_rollback_client_list_import(
  uuid, uuid, uuid
) to service_role;
