-- Durable Notion meeting synchronization and owner follow-up routing.
-- Raw webhook bodies and transcript text are intentionally excluded. Provider
-- tokens remain in Vault, operational receipts remain service-only, and only
-- the recording owner can read or route their proposed follow-ups.

create unique index if not exists transcripts_tenant_id_id_unique_idx
  on public.transcripts (tenant_id, id);

create table public.recording_sync_state (
  connection_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'notion' check (provider = 'notion'),
  last_checked_at timestamptz,
  last_succeeded_at timestamptz,
  last_event_at timestamptz,
  last_imported_at timestamptz,
  checked_count integer not null default 0 check (checked_count >= 0),
  ready_count integer not null default 0 check (ready_count >= 0),
  pending_count integer not null default 0 check (pending_count >= 0),
  enqueued_count integer not null default 0 check (enqueued_count >= 0),
  trigger_source text check (trigger_source in ('scheduled', 'manual', 'webhook')),
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recording_sync_state_connection_fkey
    foreign key (tenant_id, connection_id, owner_user_id)
    references public.integration_connections(tenant_id, id, user_id)
    on delete cascade
);

alter table public.recording_sync_state enable row level security;
revoke all on table public.recording_sync_state from public, anon, authenticated;
grant all on table public.recording_sync_state to service_role;
grant select on table public.recording_sync_state to authenticated;

create policy "recording owners read their sync state"
on public.recording_sync_state for select
to authenticated
using (
  owner_user_id = (select auth.uid())
  and app_private.has_tenant_role(tenant_id, array['owner'])
);

create index recording_sync_state_tenant_success_idx
  on public.recording_sync_state (tenant_id, last_succeeded_at desc);

create trigger set_recording_sync_state_updated_at
  before update on public.recording_sync_state
  for each row execute function public.set_updated_at();

create table public.notion_webhook_config (
  singleton boolean primary key default true check (singleton),
  verification_token_secret_id uuid not null unique,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notion_webhook_config enable row level security;
revoke all on table public.notion_webhook_config from public, anon, authenticated;
grant all on table public.notion_webhook_config to service_role;

create trigger set_notion_webhook_config_updated_at
  before update on public.notion_webhook_config
  for each row execute function public.set_updated_at();

create table public.notion_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  external_event_id text not null,
  external_page_id text,
  event_type text not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'received'
    check (status in ('received', 'processing', 'succeeded', 'failed', 'ignored')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  metadata jsonb not null default '{"raw_payload_stored":false}'::jsonb,
  constraint notion_webhook_events_connection_fkey
    foreign key (tenant_id, connection_id, owner_user_id)
    references public.integration_connections(tenant_id, id, user_id)
    on delete cascade,
  constraint notion_webhook_events_connection_event_key
    unique (connection_id, external_event_id),
  constraint notion_webhook_events_bounds_check check (
    length(trim(external_event_id)) between 1 and 320
    and length(trim(event_type)) between 1 and 120
    and (external_page_id is null or length(external_page_id) <= 320)
    and (last_error is null or length(last_error) <= 400)
  )
);

alter table public.notion_webhook_events enable row level security;
revoke all on table public.notion_webhook_events from public, anon, authenticated;
grant all on table public.notion_webhook_events to service_role;

create index notion_webhook_events_due_idx
  on public.notion_webhook_events (next_attempt_at, received_at)
  where status in ('received', 'processing', 'failed');

create index notion_webhook_events_tenant_received_idx
  on public.notion_webhook_events (tenant_id, received_at desc);

create table public.recording_followups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  transcript_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_item_index integer not null check (source_item_index >= 0),
  followup_text text not null check (length(trim(followup_text)) between 1 and 1000),
  assignee text,
  assignee_email text,
  owner_assigned boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'routed', 'dismissed')),
  route text check (route in (
    'action', 'owner_promise', 'contact_promise', 'context', 'dismiss'
  )),
  contact_id uuid,
  due_on date,
  resolution_note text,
  target_table text check (target_table in ('relationship_actions', 'promises')),
  target_id uuid,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  source text not null default 'recording_action_item'
    check (source = 'recording_action_item'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recording_followups_transcript_fkey
    foreign key (tenant_id, transcript_id)
    references public.transcripts(tenant_id, id)
    on delete cascade,
  constraint recording_followups_tenant_contact_fkey
    foreign key (tenant_id, contact_id)
    references public.contacts(tenant_id, id)
    on delete set null (contact_id),
  constraint recording_followups_transcript_item_key
    unique (transcript_id, source_item_index),
  constraint recording_followups_resolution_check check (
    (status = 'pending' and route is null and target_table is null
      and target_id is null and resolved_at is null)
    or
    (status = 'routed' and route in (
      'action', 'owner_promise', 'contact_promise', 'context'
    ) and resolved_at is not null)
    or
    (status = 'dismissed' and route = 'dismiss'
      and target_table is null and target_id is null and resolved_at is not null)
  ),
  constraint recording_followups_target_check check (
    (route = 'action' and target_table = 'relationship_actions' and target_id is not null)
    or
    (route in ('owner_promise', 'contact_promise')
      and target_table = 'promises' and target_id is not null)
    or
    (route in ('context', 'dismiss') and target_table is null and target_id is null)
    or
    route is null
  )
);

alter table public.recording_followups enable row level security;
revoke all on table public.recording_followups from public, anon, authenticated;
grant all on table public.recording_followups to service_role;
grant select on table public.recording_followups to authenticated;

create policy "recording owners read their followups"
on public.recording_followups for select
to authenticated
using (
  owner_user_id = (select auth.uid())
  and app_private.has_tenant_role(tenant_id, array['owner'])
);

create index recording_followups_owner_inbox_idx
  on public.recording_followups (tenant_id, owner_user_id, status, created_at desc);

create index recording_followups_transcript_idx
  on public.recording_followups (tenant_id, transcript_id);

create trigger set_recording_followups_updated_at
  before update on public.recording_followups
  for each row execute function public.set_updated_at();

create or replace function app_private.seed_recording_followups(
  p_tenant_id uuid,
  p_transcript_id uuid,
  p_owner_user_id uuid,
  p_provider text,
  p_processing_status text,
  p_action_items jsonb,
  p_transcript_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  item jsonb;
  item_ordinality bigint;
  item_text text;
  item_owner_assigned boolean;
  seed_dismissed boolean := p_processing_status in ('dismissed', 'purged');
begin
  if p_owner_user_id is null
    or jsonb_typeof(coalesce(p_action_items, '[]'::jsonb)) <> 'array'
    or p_processing_status not in ('review', 'ready', 'dismissed', 'purged')
  then
    return;
  end if;

  for item, item_ordinality in
    select value, ordinality
    from jsonb_array_elements(p_action_items) with ordinality
  loop
    item_text := nullif(trim(case
      when jsonb_typeof(item) = 'object' then coalesce(item ->> 'text', '')
      when jsonb_typeof(item) = 'string' then coalesce(item #>> '{}', '')
      else ''
    end), '');
    if item_text is null then
      continue;
    end if;
    item_owner_assigned := case
      when jsonb_typeof(item) = 'object'
        and jsonb_typeof(item -> 'owner_assigned') = 'boolean'
      then (item ->> 'owner_assigned')::boolean
      else false
    end;

    insert into public.recording_followups (
      tenant_id, transcript_id, owner_user_id, source_item_index,
      followup_text, assignee, assignee_email, owner_assigned,
      status, route, resolution_note, resolved_at, source, metadata
    ) values (
      p_tenant_id, p_transcript_id, p_owner_user_id,
      (item_ordinality - 1)::integer, left(item_text, 1000),
      nullif(left(trim(coalesce(item ->> 'assignee', '')), 240), ''),
      nullif(left(lower(trim(coalesce(item ->> 'assignee_email', ''))), 320), ''),
      item_owner_assigned,
      case when seed_dismissed then 'dismissed' else 'pending' end,
      case when seed_dismissed then 'dismiss' else null end,
      case when seed_dismissed then 'Meeting artifact dismissed before routing.' else null end,
      case when seed_dismissed then now() else null end,
      'recording_action_item',
      jsonb_build_object(
        'provider', left(coalesce(p_provider, 'unknown'), 80),
        'action_item_source', nullif(left(coalesce(item ->> 'source', ''), 80), ''),
        'action_item_timestamp', nullif(left(coalesce(item ->> 'timestamp', ''), 120), ''),
        'raw_transcript_stored', false,
        'transcript_evidence_grade', p_transcript_metadata ->> 'evidence_grade'
      )
    )
    on conflict (transcript_id, source_item_index) do update set
      followup_text = excluded.followup_text,
      assignee = excluded.assignee,
      assignee_email = excluded.assignee_email,
      owner_assigned = excluded.owner_assigned,
      metadata = public.recording_followups.metadata || excluded.metadata,
      status = case
        when public.recording_followups.status = 'pending' and seed_dismissed
          then 'dismissed'
        else public.recording_followups.status
      end,
      route = case
        when public.recording_followups.status = 'pending' and seed_dismissed
          then 'dismiss'
        else public.recording_followups.route
      end,
      resolution_note = case
        when public.recording_followups.status = 'pending' and seed_dismissed
          then 'Meeting artifact dismissed before routing.'
        else public.recording_followups.resolution_note
      end,
      resolved_at = case
        when public.recording_followups.status = 'pending' and seed_dismissed
          then now()
        else public.recording_followups.resolved_at
      end;
  end loop;

  if seed_dismissed then
    update public.recording_followups
    set status = 'dismissed', route = 'dismiss',
      resolution_note = coalesce(
        resolution_note, 'Meeting artifact dismissed before routing.'
      ), resolved_at = coalesce(resolved_at, now())
    where tenant_id = p_tenant_id
      and transcript_id = p_transcript_id
      and status = 'pending';
  end if;
end;
$$;

revoke all on function app_private.seed_recording_followups(
  uuid, uuid, uuid, text, text, jsonb, jsonb
) from public, anon, authenticated;

create or replace function app_private.sync_recording_followups_from_transcript()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform app_private.seed_recording_followups(
    new.tenant_id, new.id, new.owner_user_id, new.source,
    new.processing_status, new.action_items, new.metadata
  );
  return new;
end;
$$;

revoke all on function app_private.sync_recording_followups_from_transcript()
  from public, anon, authenticated;

create trigger sync_recording_followups_from_transcript
after insert or update of action_items, processing_status, owner_user_id, source
on public.transcripts
for each row execute function app_private.sync_recording_followups_from_transcript();

do $$
declare
  transcript_row public.transcripts%rowtype;
begin
  for transcript_row in
    select * from public.transcripts
    where owner_user_id is not null
      and jsonb_typeof(action_items) = 'array'
      and jsonb_array_length(action_items) > 0
  loop
    perform app_private.seed_recording_followups(
      transcript_row.tenant_id,
      transcript_row.id,
      transcript_row.owner_user_id,
      transcript_row.source,
      transcript_row.processing_status,
      transcript_row.action_items,
      transcript_row.metadata
    );
  end loop;
end;
$$;

create or replace function public.lbb_record_notion_sync_result(
  p_tenant_id uuid,
  p_connection_id uuid,
  p_owner_user_id uuid,
  p_trigger_source text,
  p_checked_count integer,
  p_ready_count integer,
  p_pending_count integer,
  p_enqueued_count integer,
  p_last_event_at timestamptz default null,
  p_last_imported_at timestamptz default null,
  p_succeeded boolean default true,
  p_error text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  sync_row public.recording_sync_state%rowtype;
  clean_error text := nullif(left(trim(coalesce(p_error, '')), 400), '');
begin
  if p_trigger_source not in ('scheduled', 'manual', 'webhook')
    or p_succeeded is null
    or p_checked_count is null or p_checked_count < 0
    or p_ready_count is null or p_ready_count < 0
    or p_pending_count is null or p_pending_count < 0
    or p_enqueued_count is null or p_enqueued_count < 0
    or p_ready_count + p_pending_count > p_checked_count
    or p_enqueued_count > p_ready_count
  then
    raise exception 'invalid Notion sync result' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.integration_connections connection
    join public.tenant_members member
      on member.tenant_id = connection.tenant_id
      and member.user_id = connection.user_id
      and member.status = 'active'
      and member.role = 'owner'
    where connection.tenant_id = p_tenant_id
      and connection.id = p_connection_id
      and connection.user_id = p_owner_user_id
      and connection.provider = 'notion'
      and connection.status = 'active'
  ) then
    raise exception 'active owner Notion connection required' using errcode = '42501';
  end if;

  insert into public.recording_sync_state (
    connection_id, tenant_id, owner_user_id, provider,
    last_checked_at, last_succeeded_at, last_event_at, last_imported_at,
    checked_count, ready_count, pending_count, enqueued_count,
    trigger_source, last_error, metadata
  ) values (
    p_connection_id, p_tenant_id, p_owner_user_id, 'notion',
    now(), case when p_succeeded then now() else null end,
    p_last_event_at, p_last_imported_at,
    p_checked_count, p_ready_count, p_pending_count, p_enqueued_count,
    p_trigger_source,
    case when p_succeeded then null else coalesce(clean_error, 'Notion sync failed') end,
    jsonb_build_object('raw_provider_payload_stored', false)
  )
  on conflict (connection_id) do update set
    tenant_id = excluded.tenant_id,
    owner_user_id = excluded.owner_user_id,
    last_checked_at = excluded.last_checked_at,
    last_succeeded_at = coalesce(
      excluded.last_succeeded_at, public.recording_sync_state.last_succeeded_at
    ),
    last_event_at = coalesce(
      excluded.last_event_at, public.recording_sync_state.last_event_at
    ),
    last_imported_at = coalesce(
      excluded.last_imported_at, public.recording_sync_state.last_imported_at
    ),
    checked_count = excluded.checked_count,
    ready_count = excluded.ready_count,
    pending_count = excluded.pending_count,
    enqueued_count = excluded.enqueued_count,
    trigger_source = excluded.trigger_source,
    last_error = excluded.last_error,
    metadata = public.recording_sync_state.metadata || excluded.metadata
  returning * into sync_row;

  return jsonb_build_object(
    'connection_id', sync_row.connection_id,
    'last_checked_at', sync_row.last_checked_at,
    'last_succeeded_at', sync_row.last_succeeded_at,
    'last_event_at', sync_row.last_event_at,
    'last_imported_at', sync_row.last_imported_at,
    'checked_count', sync_row.checked_count,
    'ready_count', sync_row.ready_count,
    'pending_count', sync_row.pending_count,
    'enqueued_count', sync_row.enqueued_count,
    'trigger_source', sync_row.trigger_source,
    'last_error', sync_row.last_error
  );
end;
$$;

create or replace function public.lbb_enqueue_notion_webhook_event(
  p_tenant_id uuid,
  p_connection_id uuid,
  p_owner_user_id uuid,
  p_external_event_id text,
  p_external_page_id text,
  p_event_type text,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  event_id uuid;
  inserted boolean := false;
begin
  if length(trim(coalesce(p_external_event_id, ''))) not between 1 and 320
    or length(trim(coalesce(p_event_type, ''))) not between 1 and 120
    or p_payload_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid Notion webhook event' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.integration_connections connection
    join public.tenant_members member
      on member.tenant_id = connection.tenant_id
      and member.user_id = connection.user_id
      and member.status = 'active'
      and member.role = 'owner'
    where connection.tenant_id = p_tenant_id
      and connection.id = p_connection_id
      and connection.user_id = p_owner_user_id
      and connection.provider = 'notion'
      and connection.status = 'active'
  ) then
    raise exception 'active owner Notion connection required' using errcode = '42501';
  end if;

  insert into public.notion_webhook_events (
    tenant_id, connection_id, owner_user_id, external_event_id,
    external_page_id, event_type, payload_sha256, metadata
  ) values (
    p_tenant_id, p_connection_id, p_owner_user_id,
    left(trim(p_external_event_id), 320),
    nullif(left(trim(coalesce(p_external_page_id, '')), 320), ''),
    left(trim(p_event_type), 120), p_payload_sha256,
    jsonb_build_object('raw_payload_stored', false)
  )
  on conflict (connection_id, external_event_id) do nothing
  returning id into event_id;
  inserted := event_id is not null;
  if event_id is null then
    select id into event_id
    from public.notion_webhook_events
    where connection_id = p_connection_id
      and external_event_id = left(trim(p_external_event_id), 320);
  end if;
  return jsonb_build_object('id', event_id, 'duplicate', not inserted);
end;
$$;

create or replace function public.lbb_capture_notion_webhook_token(
  p_token text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  config_row public.notion_webhook_config%rowtype;
  secret_id uuid;
begin
  if length(trim(coalesce(p_token, ''))) not between 1 and 4000 then
    raise exception 'invalid Notion webhook verification token' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('notion-webhook-token', 0));
  select * into config_row
  from public.notion_webhook_config
  where singleton
  for update;

  if config_row.verification_token_secret_id is null then
    secret_id := vault.create_secret(
      p_token,
      'lbb-notion-webhook-verification',
      'Little Black Book Notion webhook verification token'
    );
  else
    secret_id := config_row.verification_token_secret_id;
    perform vault.update_secret(
      secret_id,
      p_token,
      'lbb-notion-webhook-verification',
      'Little Black Book Notion webhook verification token'
    );
  end if;

  insert into public.notion_webhook_config (
    singleton, verification_token_secret_id, captured_at
  ) values (
    true, secret_id, now()
  ) on conflict (singleton) do update set
    verification_token_secret_id = excluded.verification_token_secret_id,
    captured_at = now();

  return true;
end;
$$;

create or replace function public.lbb_notion_webhook_token()
returns text
language sql
security definer
set search_path = pg_catalog, public, vault
as $$
  select secret.decrypted_secret
  from public.notion_webhook_config config
  join vault.decrypted_secrets secret
    on secret.id = config.verification_token_secret_id
  where config.singleton;
$$;

create or replace function app_private.delete_notion_webhook_secret()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, vault
as $$
begin
  delete from vault.secrets where id = old.verification_token_secret_id;
  return old;
end;
$$;

revoke all on function app_private.delete_notion_webhook_secret()
  from public, anon, authenticated;

create trigger delete_notion_webhook_secret
after delete on public.notion_webhook_config
for each row execute function app_private.delete_notion_webhook_secret();

create or replace function public.lbb_route_recording_followup(
  p_tenant_id uuid,
  p_followup_id uuid,
  p_actor_user_id uuid,
  p_route text,
  p_contact_id uuid default null,
  p_due_on date default null,
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  followup_row public.recording_followups%rowtype;
  transcript_row public.transcripts%rowtype;
  created_target_id uuid;
  created_target_table text;
  next_status text;
  clean_note text := nullif(left(trim(coalesce(p_note, '')), 4000), '');
begin
  if p_route not in (
    'action', 'owner_promise', 'contact_promise', 'context', 'dismiss'
  ) then
    raise exception 'unsupported recording follow-up route' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id = p_tenant_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and member.role = 'owner'
  ) then
    raise exception 'active recording owner access required' using errcode = '42501';
  end if;

  select * into followup_row
  from public.recording_followups
  where tenant_id = p_tenant_id
    and id = p_followup_id
    and owner_user_id = p_actor_user_id
  for update;
  if not found then
    raise exception 'recording follow-up not found' using errcode = '22023';
  end if;

  select * into transcript_row
  from public.transcripts
  where tenant_id = p_tenant_id
    and id = followup_row.transcript_id
    and owner_user_id = p_actor_user_id
  for update;
  if not found then
    raise exception 'owned meeting artifact not found' using errcode = '42501';
  end if;

  if followup_row.status <> 'pending' then
    if followup_row.route = p_route then
      return jsonb_build_object(
        'followup_id', followup_row.id,
        'route', followup_row.route,
        'status', followup_row.status,
        'target_table', followup_row.target_table,
        'target_id', followup_row.target_id,
        'duplicate', true
      );
    end if;
    raise exception 'recording follow-up was already resolved' using errcode = '40001';
  end if;
  if transcript_row.processing_status <> 'ready' then
    raise exception 'meeting artifact must be accepted before routing follow-ups'
      using errcode = '22023';
  end if;
  if p_contact_id is not null and not exists (
    select 1 from public.contacts
    where tenant_id = p_tenant_id and id = p_contact_id and archived_at is null
  ) then
    raise exception 'active contact not found in tenant' using errcode = '22023';
  end if;
  if p_route in ('owner_promise', 'contact_promise') and p_contact_id is null then
    raise exception 'an active contact is required for a promise'
      using errcode = '22023';
  end if;

  if p_route = 'action' then
    insert into public.relationship_actions (
      tenant_id, contact_id, title, action_type, status, priority,
      due_on, source, notes, metadata, created_by
    ) values (
      p_tenant_id, p_contact_id, left(followup_row.followup_text, 240),
      'follow_up', 'open', 'normal', p_due_on, 'recording_followup', clean_note,
      jsonb_build_object(
        'recording_followup_id', followup_row.id,
        'transcript_id', followup_row.transcript_id,
        'provider', transcript_row.source
      ),
      p_actor_user_id
    ) returning id into created_target_id;
    created_target_table := 'relationship_actions';
    next_status := 'routed';
  elsif p_route in ('owner_promise', 'contact_promise') then
    insert into public.promises (
      tenant_id, contact_id, interaction_id, direction, promise_text,
      status, due_on, source, evidence
    ) values (
      p_tenant_id, p_contact_id, transcript_row.interaction_id,
      case when p_route = 'owner_promise'
        then 'owner_owes_contact' else 'contact_owes_owner' end,
      followup_row.followup_text, 'open', p_due_on, 'recording_followup',
      jsonb_build_object(
        'recording_followup_id', followup_row.id,
        'transcript_id', followup_row.transcript_id,
        'provider', transcript_row.source,
        'owner_routed', true
      )
    ) returning id into created_target_id;
    created_target_table := 'promises';
    next_status := 'routed';
  elsif p_route = 'context' then
    created_target_id := null;
    created_target_table := null;
    next_status := 'routed';
  else
    created_target_id := null;
    created_target_table := null;
    next_status := 'dismissed';
  end if;

  update public.recording_followups
  set status = next_status,
    route = p_route,
    contact_id = p_contact_id,
    due_on = p_due_on,
    resolution_note = clean_note,
    target_table = created_target_table,
    target_id = created_target_id,
    resolved_by = p_actor_user_id,
    resolved_at = now(),
    metadata = metadata || jsonb_build_object(
      'routed_by_owner', true,
      'route', p_route
    )
  where id = followup_row.id;

  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action,
    table_name, record_id, before, after, metadata
  ) values (
    p_tenant_id, p_actor_user_id, 'client',
    'recording.followup_' || p_route,
    'recording_followups', followup_row.id,
    jsonb_build_object('status', followup_row.status),
    jsonb_build_object(
      'status', next_status, 'route', p_route,
      'target_table', created_target_table, 'target_id', created_target_id
    ),
    jsonb_build_object(
      'transcript_id', followup_row.transcript_id,
      'contact_id', p_contact_id,
      'provider', transcript_row.source
    )
  );

  return jsonb_build_object(
    'followup_id', followup_row.id,
    'route', p_route,
    'status', next_status,
    'target_table', created_target_table,
    'target_id', created_target_id,
    'duplicate', false
  );
end;
$$;

revoke all on function public.lbb_record_notion_sync_result(
  uuid, uuid, uuid, text, integer, integer, integer, integer,
  timestamptz, timestamptz, boolean, text
) from public, anon, authenticated;
revoke all on function public.lbb_enqueue_notion_webhook_event(
  uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.lbb_capture_notion_webhook_token(text)
  from public, anon, authenticated;
revoke all on function public.lbb_notion_webhook_token()
  from public, anon, authenticated;
revoke all on function public.lbb_route_recording_followup(
  uuid, uuid, uuid, text, uuid, date, text
) from public, anon, authenticated;

grant execute on function public.lbb_record_notion_sync_result(
  uuid, uuid, uuid, text, integer, integer, integer, integer,
  timestamptz, timestamptz, boolean, text
) to service_role;
grant execute on function public.lbb_enqueue_notion_webhook_event(
  uuid, uuid, uuid, text, text, text, text
) to service_role;
grant execute on function public.lbb_capture_notion_webhook_token(text)
  to service_role;
grant execute on function public.lbb_notion_webhook_token()
  to service_role;
grant execute on function public.lbb_route_recording_followup(
  uuid, uuid, uuid, text, uuid, date, text
) to service_role;
