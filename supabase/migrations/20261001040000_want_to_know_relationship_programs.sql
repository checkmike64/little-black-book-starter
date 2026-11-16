-- Give Want to Know categories stable tenant-scoped identities while retaining
-- the legacy bucket/lane columns used by existing automations and exports.

create table public.want_to_know_programs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  program_key text not null,
  name text not null,
  legacy_bucket_name text,
  lane text,
  goal text,
  look_for text,
  intensity text not null default 'Low',
  policy jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  sort_order integer not null default 0,
  provenance jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  paused_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint want_to_know_programs_tenant_id_id_key unique (tenant_id, id),
  constraint want_to_know_programs_key_not_blank check (btrim(program_key) <> ''),
  constraint want_to_know_programs_name_not_blank check (btrim(name) <> ''),
  constraint want_to_know_programs_intensity_check
    check (intensity = any (array['Low'::text, 'Medium'::text, 'High'::text])),
  constraint want_to_know_programs_status_check
    check (status = any (array['active'::text, 'paused'::text, 'archived'::text])),
  constraint want_to_know_programs_status_timestamp_check
    check (
      (status = 'active' and paused_at is null and archived_at is null)
      or (status = 'paused' and paused_at is not null and archived_at is null)
      or (status = 'archived' and archived_at is not null)
    )
);

comment on table public.want_to_know_programs is
  'Owner-managed relationship programs that give Want to Know categories stable identities.';
comment on column public.want_to_know_programs.legacy_bucket_name is
  'Original bucket label retained for compatibility and migration provenance.';
comment on column public.want_to_know_programs.provenance is
  'Origin and source configuration used to create this program. Never treated as instructions.';

create unique index want_to_know_programs_tenant_key_idx
  on public.want_to_know_programs (tenant_id, program_key);
create unique index want_to_know_programs_tenant_name_idx
  on public.want_to_know_programs (tenant_id, lower(name));
create index want_to_know_programs_tenant_status_order_idx
  on public.want_to_know_programs (tenant_id, status, sort_order, name);
create index want_to_know_programs_created_by_idx
  on public.want_to_know_programs (created_by)
  where created_by is not null;
create index want_to_know_programs_updated_by_idx
  on public.want_to_know_programs (updated_by)
  where updated_by is not null;

alter table public.want_to_know_programs enable row level security;

revoke all on table public.want_to_know_programs from anon, authenticated;
grant select on table public.want_to_know_programs to authenticated;
grant all on table public.want_to_know_programs to postgres, service_role;

create policy "members read want to know programs"
  on public.want_to_know_programs
  for select
  to authenticated
  using (app_private.is_tenant_member(tenant_id));

create trigger set_want_to_know_programs_updated_at
  before update on public.want_to_know_programs
  for each row
  execute function public.set_updated_at();

alter table public.want_to_know
  add column program_id uuid,
  add column relationship_status text not null default 'active',
  add column paused_at timestamptz,
  add column archived_at timestamptz;

alter table public.want_to_know
  add constraint want_to_know_tenant_program_fkey
    foreign key (tenant_id, program_id)
    references public.want_to_know_programs(tenant_id, id)
    on delete restrict,
  add constraint want_to_know_relationship_status_check
    check (relationship_status = any (array['active'::text, 'paused'::text, 'archived'::text])),
  add constraint want_to_know_relationship_status_timestamp_check
    check (
      (relationship_status = 'active' and paused_at is null and archived_at is null)
      or (relationship_status = 'paused' and paused_at is not null and archived_at is null)
      or (relationship_status = 'archived' and archived_at is not null)
    );

comment on column public.want_to_know.program_id is
  'Stable relationship-program identity. bucket and lane remain synchronized compatibility fields.';
comment on column public.want_to_know.relationship_status is
  'Lifecycle independent of research stage: active, paused, or archived.';

create index want_to_know_tenant_program_status_idx
  on public.want_to_know (tenant_id, program_id, relationship_status, updated_at desc)
  where owner_selected_at is not null;
create index want_to_know_program_id_idx
  on public.want_to_know (program_id)
  where program_id is not null;
create index want_to_know_paused_at_idx
  on public.want_to_know (tenant_id, paused_at desc)
  where relationship_status = 'paused';
create index want_to_know_archived_at_idx
  on public.want_to_know (tenant_id, archived_at desc)
  where relationship_status = 'archived';

create or replace function app_private.set_relationship_status_timestamps()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'active' then
    new.paused_at := null;
    new.archived_at := null;
  elsif new.status = 'paused' then
    new.paused_at := coalesce(new.paused_at, now());
    new.archived_at := null;
  elsif new.status = 'archived' then
    new.archived_at := coalesce(new.archived_at, now());
  end if;
  return new;
end;
$$;

create or replace function app_private.set_want_to_know_status_timestamps()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.relationship_status = 'active' then
    new.paused_at := null;
    new.archived_at := null;
  elsif new.relationship_status = 'paused' then
    new.paused_at := coalesce(new.paused_at, now());
    new.archived_at := null;
  elsif new.relationship_status = 'archived' then
    new.archived_at := coalesce(new.archived_at, now());
  end if;
  return new;
end;
$$;

create trigger normalize_want_to_know_program_status_timestamps
  before insert or update of status on public.want_to_know_programs
  for each row
  execute function app_private.set_relationship_status_timestamps();

create trigger normalize_want_to_know_status_timestamps
  before insert or update of relationship_status on public.want_to_know
  for each row
  execute function app_private.set_want_to_know_status_timestamps();

-- Seed every configured category. Disabled configuration is preserved as a
-- paused program instead of being discarded.
with configured_programs as (
  select
    tenant.id as tenant_id,
    bucket.value as config,
    bucket.ordinality::integer as sort_order,
    btrim(bucket.value->>'name') as name
  from public.tenants tenant
  join lateral jsonb_array_elements(
    case
      when jsonb_typeof(tenant.settings #> '{prospecting,buckets}') = 'array'
        then tenant.settings #> '{prospecting,buckets}'
      else '[]'::jsonb
    end
  ) with ordinality as bucket(value, ordinality) on true
  where nullif(btrim(bucket.value->>'name'), '') is not null
), deduplicated as (
  select distinct on (tenant_id, lower(name))
    tenant_id,
    config,
    sort_order,
    name
  from configured_programs
  order by tenant_id, lower(name), sort_order
)
insert into public.want_to_know_programs (
  tenant_id,
  program_key,
  name,
  legacy_bucket_name,
  lane,
  goal,
  look_for,
  intensity,
  policy,
  status,
  sort_order,
  provenance
)
select
  tenant_id,
  concat(
    coalesce(nullif(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''), 'program'),
    '-',
    substr(md5(lower(name)), 1, 8)
  ),
  name,
  name,
  nullif(btrim(config->>'lane'), ''),
  nullif(btrim(config->>'goal'), ''),
  nullif(btrim(config->>'look_for'), ''),
  case lower(coalesce(config->>'intensity', 'low'))
    when 'high' then 'High'
    when 'medium' then 'Medium'
    else 'Low'
  end,
  case when jsonb_typeof(config->'policy') = 'object' then config->'policy' else '{}'::jsonb end,
  case
    when exists (
      select 1
      from public.want_to_know candidate
      where candidate.tenant_id = deduplicated.tenant_id
        and candidate.owner_selected_at is not null
        and candidate.stage <> 'graduated'
        and lower(coalesce(nullif(btrim(candidate.bucket), ''), 'Uncategorized')) = lower(deduplicated.name)
    ) then 'active'
    else 'paused'
  end,
  sort_order * 10,
  jsonb_build_object(
    'origin', 'tenant_settings',
    'settings_path', 'prospecting.buckets',
    'legacy_config', config
  )
from deduplicated
on conflict do nothing;

-- Preserve categories that exist on people but were absent from tenant settings.
with saved_buckets as (
  select distinct on (tenant_id, lower(btrim(bucket)))
    tenant_id,
    btrim(bucket) as name,
    nullif(btrim(lane), '') as lane
  from public.want_to_know
  where nullif(btrim(bucket), '') is not null
  order by tenant_id, lower(btrim(bucket)), updated_at desc
)
insert into public.want_to_know_programs (
  tenant_id,
  program_key,
  name,
  legacy_bucket_name,
  lane,
  status,
  sort_order,
  provenance
)
select
  tenant_id,
  concat(
    coalesce(nullif(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''), 'program'),
    '-',
    substr(md5(lower(name)), 1, 8)
  ),
  name,
  name,
  lane,
  'active',
  1000,
  jsonb_build_object('origin', 'legacy_bucket', 'legacy_bucket_name', name)
from saved_buckets
on conflict do nothing;

-- Every currently active owner-selected person gets a stable program identity,
-- even if their previous category was blank.
insert into public.want_to_know_programs (
  tenant_id,
  program_key,
  name,
  legacy_bucket_name,
  status,
  sort_order,
  provenance
)
select distinct
  candidate.tenant_id,
  'uncategorized-' || substr(md5('uncategorized'), 1, 8),
  'Uncategorized',
  'Uncategorized',
  'active',
  2000,
  jsonb_build_object(
    'origin', 'migration_fallback',
    'reason', 'Active owner-selected person had no legacy bucket.'
  )
from public.want_to_know candidate
where candidate.owner_selected_at is not null
  and candidate.stage <> 'graduated'
  and nullif(btrim(candidate.bucket), '') is null
on conflict do nothing;

update public.want_to_know candidate
set program_id = program.id
from public.want_to_know_programs program
where candidate.tenant_id = program.tenant_id
  and candidate.owner_selected_at is not null
  and candidate.stage <> 'graduated'
  and candidate.program_id is null
  and lower(
    coalesce(nullif(btrim(candidate.bucket), ''), 'Uncategorized')
  ) = lower(coalesce(program.legacy_bucket_name, program.name));

create or replace function app_private.sync_want_to_know_program_fields()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  selected_program public.want_to_know_programs%rowtype;
begin
  if new.program_id is null then
    return new;
  end if;

  select *
  into selected_program
  from public.want_to_know_programs
  where tenant_id = new.tenant_id
    and id = new.program_id;

  if not found then
    raise exception 'Want to Know program does not belong to this tenant.';
  end if;

  new.bucket := selected_program.name;
  new.lane := selected_program.lane;
  return new;
end;
$$;

create or replace function app_private.sync_want_to_know_program_compatibility()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  update public.want_to_know
  set bucket = new.name,
      lane = new.lane
  where tenant_id = new.tenant_id
    and program_id = new.id
    and (bucket is distinct from new.name or lane is distinct from new.lane);
  return new;
end;
$$;

create trigger sync_want_to_know_program_fields
  before insert or update of program_id on public.want_to_know
  for each row
  execute function app_private.sync_want_to_know_program_fields();

create trigger sync_want_to_know_program_compatibility
  after update of name, lane on public.want_to_know_programs
  for each row
  execute function app_private.sync_want_to_know_program_compatibility();

create or replace function public.lbb_reorder_want_to_know_programs(
  p_tenant_id uuid,
  p_program_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  supplied_count integer;
  matched_count integer;
begin
  supplied_count := coalesce(cardinality(p_program_ids), 0);
  if supplied_count = 0 then
    raise exception 'At least one relationship program is required.';
  end if;

  if supplied_count <> (
    select count(distinct program_id)
    from unnest(p_program_ids) as supplied(program_id)
  ) then
    raise exception 'Relationship program order contains duplicates.';
  end if;

  select count(*)
  into matched_count
  from public.want_to_know_programs
  where tenant_id = p_tenant_id
    and status <> 'archived'
    and id = any(p_program_ids);

  if matched_count <> supplied_count or matched_count <> (
    select count(*)
    from public.want_to_know_programs
    where tenant_id = p_tenant_id
      and status <> 'archived'
  ) then
    raise exception 'Relationship program order must include every non-archived program in this tenant exactly once.';
  end if;

  update public.want_to_know_programs
  set sort_order = array_position(p_program_ids, id) * 10
  where tenant_id = p_tenant_id
    and status <> 'archived';
end;
$$;

revoke all on function public.lbb_reorder_want_to_know_programs(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.lbb_reorder_want_to_know_programs(uuid, uuid[])
  to service_role;

create table public.want_to_know_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  want_to_know_id uuid not null,
  program_id uuid,
  event_type text not null,
  is_touch boolean not null default false,
  occurred_at timestamptz not null default now(),
  title text,
  summary text,
  channel text,
  direction text,
  source text not null default 'manual',
  source_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  idempotency_key text,
  constraint want_to_know_events_tenant_candidate_fkey
    foreign key (tenant_id, want_to_know_id)
    references public.want_to_know(tenant_id, id)
    on delete cascade,
  constraint want_to_know_events_tenant_program_fkey
    foreign key (tenant_id, program_id)
    references public.want_to_know_programs(tenant_id, id)
    on delete set null (program_id),
  constraint want_to_know_events_type_not_blank check (btrim(event_type) <> ''),
  constraint want_to_know_events_source_not_blank check (btrim(source) <> ''),
  constraint want_to_know_events_direction_check
    check (
      direction is null
      or direction = any (array['inbound'::text, 'outbound'::text, 'mutual'::text, 'system'::text])
    )
);

comment on table public.want_to_know_events is
  'Immutable event and touch ledger for a Want to Know relationship.';
comment on column public.want_to_know_events.is_touch is
  'True only when the event represents an actual relationship touch; drives last_touch and engagement_count.';

alter table public.want_to_know_events enable row level security;

revoke all on table public.want_to_know_events from anon, authenticated;
grant select on table public.want_to_know_events to authenticated;
grant all on table public.want_to_know_events to postgres, service_role;

create policy "members read want to know events"
  on public.want_to_know_events
  for select
  to authenticated
  using (app_private.is_tenant_member(tenant_id));

create index want_to_know_events_tenant_candidate_time_idx
  on public.want_to_know_events (tenant_id, want_to_know_id, occurred_at desc);
create index want_to_know_events_tenant_program_time_idx
  on public.want_to_know_events (tenant_id, program_id, occurred_at desc)
  where program_id is not null;
create index want_to_know_events_tenant_type_time_idx
  on public.want_to_know_events (tenant_id, event_type, occurred_at desc);
create index want_to_know_events_created_by_idx
  on public.want_to_know_events (created_by)
  where created_by is not null;
create unique index want_to_know_events_tenant_idempotency_idx
  on public.want_to_know_events (tenant_id, idempotency_key)
  where idempotency_key is not null;

create or replace function app_private.roll_up_want_to_know_touch()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.is_touch then
    update public.want_to_know
    set engagement_count = coalesce(engagement_count, 0) + 1,
        last_touch = greatest(
          coalesce(last_touch, (new.occurred_at at time zone 'UTC')::date),
          (new.occurred_at at time zone 'UTC')::date
        )
    where tenant_id = new.tenant_id
      and id = new.want_to_know_id;
  end if;
  return new;
end;
$$;

create trigger roll_up_want_to_know_touch
  after insert on public.want_to_know_events
  for each row
  execute function app_private.roll_up_want_to_know_touch();

-- A single snapshot preserves the old counters and date without inventing
-- historical event detail or incrementing them again.
insert into public.want_to_know_events (
  tenant_id,
  want_to_know_id,
  program_id,
  event_type,
  is_touch,
  occurred_at,
  title,
  summary,
  source,
  metadata,
  idempotency_key
)
select
  candidate.tenant_id,
  candidate.id,
  candidate.program_id,
  'legacy_state_imported',
  false,
  coalesce(candidate.owner_selected_at, candidate.added_at),
  'Previous relationship activity preserved',
  'Imported the previous touch summary without fabricating individual events.',
  'schema_migration',
  jsonb_build_object(
    'legacy_engagement_count', candidate.engagement_count,
    'legacy_last_touch', candidate.last_touch,
    'legacy_bucket', candidate.bucket,
    'legacy_lane', candidate.lane,
    'legacy_source', candidate.source
  ),
  'want-to-know-program-foundation:' || candidate.id::text
from public.want_to_know candidate
where candidate.owner_selected_at is not null
  and (candidate.engagement_count > 0 or candidate.last_touch is not null)
on conflict do nothing;
