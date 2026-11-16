-- Provider-neutral meeting artifact intake. Raw webhook bodies and transcript
-- text never enter these public tables; only hashes, provider references, and
-- distilled relationship notes cross the owner-facing boundary.

alter table public.integration_connections
  add column if not exists webhook_secret_id uuid,
  add column if not exists consent_version text,
  add column if not exists consented_at timestamptz,
  add column if not exists consented_by uuid references auth.users(id) on delete set null,
  add column if not exists authorization_attested_at timestamptz,
  add column if not exists authorization_attested_by uuid references auth.users(id) on delete set null,
  add column if not exists authorized_owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists upstream_revoke_status text not null default 'not_applicable',
  add column if not exists upstream_revoked_at timestamptz,
  add column if not exists disconnected_at timestamptz;

alter table public.integration_connections
  drop constraint if exists integration_connections_upstream_revoke_status_check;

alter table public.integration_connections
  add constraint integration_connections_upstream_revoke_status_check
  check (upstream_revoke_status in ('not_applicable', 'active', 'cleanup_pending', 'revoked'));

alter table public.integration_connections
  drop constraint if exists integration_connections_provider_check;

alter table public.integration_connections
  add constraint integration_connections_provider_check
  check (provider in (
    'google_calendar', 'claude_calendar', 'google_gmail',
    'fireflies', 'fathom', 'google_meet'
  ));

alter table public.transcripts
  add column if not exists connection_id uuid,
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists external_artifact_id text,
  add column if not exists occurred_at timestamptz,
  add column if not exists duration_seconds integer,
  add column if not exists recording_url text,
  add column if not exists processing_status text not null default 'ready',
  add column if not exists action_items jsonb not null default '[]'::jsonb,
  add column if not exists last_error text,
  add column if not exists purged_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.transcripts
  drop constraint if exists transcripts_processing_status_check;

alter table public.transcripts
  add constraint transcripts_processing_status_check
  check (processing_status in ('received', 'processing', 'review', 'ready', 'dismissed', 'failed', 'purged'));

alter table public.transcripts
  drop constraint if exists transcripts_tenant_connection_owner_fkey;

alter table public.transcripts
  add constraint transcripts_tenant_connection_owner_fkey
  foreign key (tenant_id, connection_id, owner_user_id)
  references public.integration_connections(tenant_id, id, user_id)
  on delete set null (connection_id, owner_user_id);

drop policy if exists "members read transcript metadata" on public.transcripts;
drop policy if exists "recording owners read transcript metadata" on public.transcripts;
create policy "recording owners read transcript metadata"
on public.transcripts for select
to authenticated
using (
  tenant_id is not null
  and app_private.is_tenant_member(tenant_id)
  and (
    owner_user_id = (select auth.uid())
    or app_private.has_tenant_role(tenant_id, array['operator'])
    or (
      owner_user_id is null
      and app_private.has_tenant_role(tenant_id, array['owner', 'operator'])
    )
  )
);

create unique index if not exists transcripts_external_artifact_unique_idx
  on public.transcripts (tenant_id, source, external_artifact_id)
  where external_artifact_id is not null;

create index if not exists transcripts_tenant_occurred_idx
  on public.transcripts (tenant_id, occurred_at desc);

create table if not exists public.recording_ingest_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('fireflies', 'fathom', 'google_meet')),
  external_event_id text not null,
  external_artifact_id text,
  event_type text not null,
  payload_sha256 text not null,
  status text not null default 'received'
    check (status in ('received', 'processing', 'succeeded', 'failed', 'ignored')),
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint recording_receipts_connection_fkey
    foreign key (tenant_id, connection_id, owner_user_id)
    references public.integration_connections(tenant_id, id, user_id)
    on delete cascade,
  unique (connection_id, external_event_id)
);

alter table public.recording_ingest_receipts enable row level security;

-- Operational receipts are deliberately service-only. Owners receive health
-- through a narrow server-rendered projection, never direct Data API access.
revoke all on table public.recording_ingest_receipts from public, anon, authenticated;
grant all on table public.recording_ingest_receipts to service_role;

create index if not exists recording_receipts_tenant_received_idx
  on public.recording_ingest_receipts (tenant_id, received_at desc);

create index if not exists recording_receipts_due_idx
  on public.recording_ingest_receipts (next_attempt_at, received_at)
  where status in ('received', 'failed', 'processing');

-- Webhooks persist only routing metadata. The provider payload itself is never
-- queued; workers use the artifact ID to refetch with the Vault-held API key.
create or replace function public.lbb_enqueue_recording_receipt(
  p_tenant_id uuid,
  p_connection_id uuid,
  p_owner_user_id uuid,
  p_provider text,
  p_external_event_id text,
  p_external_artifact_id text,
  p_event_type text,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  receipt_id uuid;
  inserted boolean := false;
begin
  if p_provider not in ('fireflies', 'fathom', 'google_meet')
    or nullif(trim(coalesce(p_external_event_id, '')), '') is null
    or nullif(trim(coalesce(p_external_artifact_id, '')), '') is null
  then
    raise exception 'invalid recording receipt';
  end if;
  if not exists (
    select 1 from public.integration_connections
    where tenant_id = p_tenant_id
      and id = p_connection_id
      and user_id = p_owner_user_id
      and provider = p_provider
      and status = 'active'
  ) then
    raise exception 'active recording connection not found';
  end if;

  insert into public.recording_ingest_receipts (
    tenant_id, connection_id, owner_user_id, provider,
    external_event_id, external_artifact_id, event_type, payload_sha256,
    status, next_attempt_at, metadata
  ) values (
    p_tenant_id, p_connection_id, p_owner_user_id, p_provider,
    left(p_external_event_id, 320), left(p_external_artifact_id, 320),
    left(p_event_type, 120), left(p_payload_sha256, 128),
    'received', now(),
    jsonb_build_object('raw_payload_stored', false, 'durable_queue', true)
  )
  on conflict (connection_id, external_event_id) do update set
    status = 'received',
    attempts = 0,
    last_error = null,
    next_attempt_at = now(),
    processed_at = null,
    locked_at = null,
    lock_token = null,
    metadata = recording_ingest_receipts.metadata || jsonb_build_object(
      'rearmed_by_reconciliation_at', now()
    )
  where recording_ingest_receipts.status = 'ignored'
    and recording_ingest_receipts.event_type = 'daily.reconcile'
    and excluded.event_type = 'daily.reconcile'
    and not exists (
      select 1 from public.transcripts t
      where t.tenant_id = excluded.tenant_id
        and t.source = excluded.provider
        and t.external_artifact_id = excluded.external_artifact_id
    )
  returning id into receipt_id;

  if receipt_id is not null then
    inserted := true;
  else
    select id into receipt_id
    from public.recording_ingest_receipts
    where connection_id = p_connection_id
      and external_event_id = left(p_external_event_id, 320);
  end if;
  if receipt_id is null then raise exception 'recording receipt could not be resolved'; end if;
  return jsonb_build_object('id', receipt_id, 'duplicate', not inserted);
end;
$$;

create or replace function public.lbb_claim_recording_receipts(
  p_limit integer default 20,
  p_lease_seconds integer default 600
)
returns table (
  id uuid,
  tenant_id uuid,
  connection_id uuid,
  owner_user_id uuid,
  provider text,
  external_artifact_id text,
  event_type text,
  attempts integer,
  lock_token uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  with ranked as (
    select r.id, r.tenant_id, r.next_attempt_at, r.received_at,
      row_number() over (
        partition by r.tenant_id
        order by r.next_attempt_at, r.received_at
      ) as tenant_position
    from public.recording_ingest_receipts r
    join public.integration_connections c
      on c.tenant_id = r.tenant_id and c.id = r.connection_id
    where c.status = 'active'
      and r.attempts < 8
      and (
        (r.status in ('received', 'failed') and r.next_attempt_at <= now())
        or (r.status = 'processing' and r.locked_at < now() - make_interval(secs => greatest(p_lease_seconds, 30)))
      )
  ), due as (
    select r.id
    from public.recording_ingest_receipts r
    join ranked candidate on candidate.id = r.id
    order by candidate.tenant_position, candidate.next_attempt_at, candidate.received_at
    for update of r skip locked
    limit least(greatest(p_limit, 1), 100)
  )
  update public.recording_ingest_receipts r set
    status = 'processing',
    attempts = r.attempts + 1,
    locked_at = now(),
    lock_token = gen_random_uuid(),
    processed_at = null
  from due
  where r.id = due.id
  returning r.id, r.tenant_id, r.connection_id, r.owner_user_id,
    r.provider, r.external_artifact_id, r.event_type, r.attempts, r.lock_token;
end;
$$;

create or replace function public.lbb_finish_recording_receipt(
  p_receipt_id uuid,
  p_lock_token uuid,
  p_status text,
  p_error text default null,
  p_ignore_on_exhaustion boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  receipt public.recording_ingest_receipts%rowtype;
  final_status text;
  exhausted boolean;
begin
  if p_status not in ('succeeded', 'retry', 'ignored') then
    raise exception 'invalid receipt outcome';
  end if;
  select * into receipt
  from public.recording_ingest_receipts
  where id = p_receipt_id and lock_token = p_lock_token and status = 'processing'
  for update;
  if receipt.id is null then raise exception 'recording receipt lease is no longer valid'; end if;

  exhausted := receipt.attempts >= 8;
  final_status := case
    when p_status = 'succeeded' then 'succeeded'
    when p_status = 'ignored' or (exhausted and p_ignore_on_exhaustion) then 'ignored'
    else 'failed'
  end;
  update public.recording_ingest_receipts set
    status = final_status,
    last_error = case when final_status = 'succeeded' then null else left(coalesce(p_error, 'recording import failed'), 400) end,
    next_attempt_at = case
      when final_status = 'failed' and not exhausted
        then now() + make_interval(secs => least(21600, 30 * (2 ^ greatest(receipt.attempts - 1, 0))::integer))
      else next_attempt_at
    end,
    processed_at = case when final_status in ('succeeded', 'ignored') or exhausted then now() else null end,
    locked_at = null,
    lock_token = null
  where id = receipt.id;
  return jsonb_build_object(
    'id', receipt.id,
    'status', final_status,
    'attempts', receipt.attempts,
    'exhausted', exhausted,
    'connection_id', receipt.connection_id,
    'tenant_id', receipt.tenant_id
  );
end;
$$;

create or replace function public.lbb_prepare_recording_connection(
  p_tenant_id uuid,
  p_connection_id uuid,
  p_owner_user_id uuid,
  p_actor_user_id uuid,
  p_provider text,
  p_claim_token uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  connection_row public.integration_connections%rowtype;
begin
  if p_provider not in ('fireflies', 'fathom')
    or p_connection_id is null
    or p_claim_token is null
  then
    raise exception 'invalid recording provisioning request';
  end if;
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
      and role = 'operator'
  ) then
    raise exception 'operator access required';
  end if;
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_owner_user_id
      and status = 'active'
      and role = 'owner'
  ) then
    raise exception 'recording owner must be an active tenant owner';
  end if;

  -- Serialize even when the unique provider row does not exist yet. This makes
  -- a double-click unable to create two upstream provider webhooks.
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || ':' || p_owner_user_id::text || ':' || p_provider,
    0
  ));

  select * into connection_row
  from public.integration_connections
  where tenant_id = p_tenant_id
    and user_id = p_owner_user_id
    and provider = p_provider
  for update;

  if connection_row.id is not null then
    if connection_row.status = 'active' then
      raise exception 'recording source is already active';
    end if;
    if connection_row.upstream_revoke_status = 'cleanup_pending' then
      raise exception 'previous provider webhook cleanup is pending';
    end if;
    if nullif(connection_row.metadata->>'provisioning_token', '') is not null
      and coalesce(
        (connection_row.metadata->>'provisioning_started_at')::timestamptz,
        '-infinity'::timestamptz
      ) > now() - interval '15 minutes'
    then
      raise exception 'recording source provisioning is already in progress';
    end if;

    update public.integration_connections set
      status = 'needs_attention',
      last_error = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'provisioning_token', p_claim_token,
        'provisioning_started_at', now(),
        'raw_media', false
      ),
      updated_at = now()
    where id = connection_row.id
    returning * into connection_row;
  else
    insert into public.integration_connections (
      id, tenant_id, user_id, provider, status, scopes,
      authorized_owner_user_id, upstream_revoke_status, metadata
    ) values (
      p_connection_id, p_tenant_id, p_owner_user_id, p_provider,
      'needs_attention', array['my_recordings'], p_owner_user_id, 'not_applicable',
      jsonb_build_object(
        'provisioning_token', p_claim_token,
        'provisioning_started_at', now(),
        'raw_media', false
      )
    ) returning * into connection_row;
  end if;

  return connection_row.id;
end;
$$;

create or replace function public.lbb_upsert_recording_connection(
  p_tenant_id uuid,
  p_connection_id uuid,
  p_claim_token uuid,
  p_owner_user_id uuid,
  p_actor_user_id uuid,
  p_provider text,
  p_api_key text,
  p_webhook_secret text,
  p_external_account_email text,
  p_upstream_webhook_id text,
  p_consent_version text,
  p_scope text default 'my_recordings'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  connection_row public.integration_connections%rowtype;
  api_secret_id uuid;
  hook_secret_id uuid;
begin
  if p_provider not in ('fireflies', 'fathom') then
    raise exception 'unsupported recording provider';
  end if;
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
      and role = 'operator'
  ) then
    raise exception 'operator access required';
  end if;
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_owner_user_id
      and status = 'active'
      and role = 'owner'
  ) then
    raise exception 'recording owner must be an active tenant owner';
  end if;
  if nullif(trim(coalesce(p_api_key, '')), '') is null
    or nullif(trim(coalesce(p_webhook_secret, '')), '') is null
    or nullif(trim(coalesce(p_consent_version, '')), '') is null
    or p_scope <> 'my_recordings'
  then
    raise exception 'invalid recording connection configuration';
  end if;
  if p_connection_id is null or p_claim_token is null then
    raise exception 'connection id and provisioning claim are required';
  end if;

  select * into connection_row
  from public.integration_connections
  where tenant_id = p_tenant_id
    and id = p_connection_id
    and user_id = p_owner_user_id
    and provider = p_provider
  for update;

  if connection_row.id is null
    or connection_row.status <> 'needs_attention'
    or connection_row.metadata->>'provisioning_token' <> p_claim_token::text
  then
    raise exception 'recording provisioning claim is invalid or stale';
  end if;

  if connection_row.refresh_token_secret_id is null then
    api_secret_id := vault.create_secret(
      p_api_key,
      'lbb-' || p_provider || '-api-' || connection_row.id::text,
      'Little Black Book recording provider API credential'
    );
  else
    api_secret_id := connection_row.refresh_token_secret_id;
    perform vault.update_secret(api_secret_id, p_api_key);
  end if;
  if connection_row.webhook_secret_id is null then
    hook_secret_id := vault.create_secret(
      p_webhook_secret,
      'lbb-' || p_provider || '-webhook-' || connection_row.id::text,
      'Little Black Book recording webhook signing secret'
    );
  else
    hook_secret_id := connection_row.webhook_secret_id;
    perform vault.update_secret(hook_secret_id, p_webhook_secret);
  end if;
  update public.integration_connections set
    status = 'active',
    external_account_email = nullif(trim(coalesce(p_external_account_email, '')), ''),
    scopes = array[p_scope],
    refresh_token_secret_id = api_secret_id,
    webhook_secret_id = hook_secret_id,
    consent_version = p_consent_version,
    authorization_attested_at = now(),
    authorization_attested_by = p_actor_user_id,
    authorized_owner_user_id = p_owner_user_id,
    upstream_revoke_status = 'active',
    upstream_revoked_at = null,
    disconnected_at = null,
    last_error = null,
    metadata = jsonb_build_object(
      'authorized_scope', p_scope,
      'raw_media', false,
      'upstream_webhook_id', nullif(trim(coalesce(p_upstream_webhook_id, '')), ''),
      'authorization_basis', 'operator_attestation_of_documented_owner_authority'
    ),
    updated_at = now()
  where id = connection_row.id
    and status = 'needs_attention'
    and metadata->>'provisioning_token' = p_claim_token::text
  returning * into connection_row;

  if connection_row.id is null then
    raise exception 'recording provisioning claim was lost';
  end if;

  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action, table_name, record_id, metadata
  ) values (
    p_tenant_id, p_actor_user_id, 'operator', 'recording.connection_configured',
    'integration_connections', connection_row.id,
    jsonb_build_object('provider', p_provider, 'scope', p_scope, 'consent_version', p_consent_version)
  );
  return connection_row.id;
end;
$$;

create or replace function public.lbb_abandon_recording_connection_provisioning(
  p_tenant_id uuid,
  p_connection_id uuid,
  p_actor_user_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
      and role = 'operator'
  ) then
    raise exception 'operator access required';
  end if;

  update public.integration_connections set
    status = 'disconnected',
    upstream_revoke_status = 'revoked',
    upstream_revoked_at = now(),
    disconnected_at = now(),
    last_error = 'Provider setup did not complete.',
    metadata = (coalesce(metadata, '{}'::jsonb)
      - 'provisioning_token'
      - 'provisioning_started_at')
      || jsonb_build_object('provisioning_abandoned_at', now()),
    updated_at = now()
  where tenant_id = p_tenant_id
    and id = p_connection_id
    and status = 'needs_attention'
    and metadata->>'provisioning_token' = p_claim_token::text;

  return found;
end;
$$;

create or replace function public.lbb_mark_recording_provisioning_cleanup_pending(
  p_tenant_id uuid,
  p_connection_id uuid,
  p_actor_user_id uuid,
  p_claim_token uuid,
  p_api_key text,
  p_upstream_webhook_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  connection_row public.integration_connections%rowtype;
  api_secret_id uuid;
begin
  if nullif(trim(coalesce(p_api_key, '')), '') is null
    or nullif(trim(coalesce(p_upstream_webhook_id, '')), '') is null
  then
    raise exception 'cleanup credential and webhook id are required';
  end if;
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
      and role = 'operator'
  ) then
    raise exception 'operator access required';
  end if;

  select * into connection_row
  from public.integration_connections
  where tenant_id = p_tenant_id
    and id = p_connection_id
    and provider = 'fathom'
    and status = 'needs_attention'
    and metadata->>'provisioning_token' = p_claim_token::text
  for update;
  if connection_row.id is null then return false; end if;

  api_secret_id := vault.create_secret(
    p_api_key,
    'lbb-fathom-cleanup-' || connection_row.id::text,
    'Temporary Fathom credential retained only for upstream webhook cleanup'
  );
  update public.integration_connections set
    status = 'disconnected',
    refresh_token_secret_id = api_secret_id,
    webhook_secret_id = null,
    upstream_revoke_status = 'cleanup_pending',
    disconnected_at = now(),
    last_error = 'Fathom setup failed after webhook creation; upstream cleanup is pending.',
    metadata = (coalesce(metadata, '{}'::jsonb)
      - 'provisioning_token'
      - 'provisioning_started_at')
      || jsonb_build_object(
        'upstream_webhook_id', left(p_upstream_webhook_id, 320),
        'upstream_webhook_cleanup_required', true,
        'provisioning_cleanup_started_at', now(),
        'raw_media', false
      ),
    updated_at = now()
  where id = connection_row.id;
  return true;
end;
$$;

create or replace function public.lbb_recording_connection_secrets(p_connection_id uuid)
returns table (
  connection_id uuid,
  tenant_id uuid,
  owner_user_id uuid,
  provider text,
  connection_status text,
  api_key text,
  webhook_secret text,
  scopes text[],
  external_account_email text
)
language sql
security definer
set search_path = pg_catalog, public, vault
as $$
  select c.id, c.tenant_id, c.user_id, c.provider, c.status,
    api.decrypted_secret, hook.decrypted_secret, c.scopes, c.external_account_email
  from public.integration_connections c
  left join vault.decrypted_secrets api on api.id = c.refresh_token_secret_id
  left join vault.decrypted_secrets hook on hook.id = c.webhook_secret_id
  where c.id = p_connection_id
    and c.provider in ('fireflies', 'fathom', 'google_meet');
$$;

create or replace function public.lbb_ensure_manual_recording_connection(
  p_tenant_id uuid,
  p_owner_user_id uuid,
  p_actor_user_id uuid,
  p_provider text,
  p_consent_version text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  connection_id uuid;
begin
  if p_provider <> 'google_meet' then
    raise exception 'manual import is limited to Google Meet';
  end if;
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id and user_id = p_actor_user_id
      and status = 'active' and role = 'operator'
  ) or not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id and user_id = p_owner_user_id
      and status = 'active'
      and role = 'owner'
  ) then
    raise exception 'operator and owner membership required';
  end if;
  insert into public.integration_connections (
    tenant_id, user_id, provider, status, scopes, consent_version,
    authorization_attested_at, authorization_attested_by,
    authorized_owner_user_id, upstream_revoke_status, metadata
  ) values (
    p_tenant_id, p_owner_user_id, p_provider, 'active', array['manual_notes'],
    p_consent_version, now(), p_actor_user_id, p_owner_user_id, 'not_applicable',
    jsonb_build_object('connection_mode', 'manual', 'raw_media', false)
  )
  on conflict (tenant_id, user_id, provider)
  do update set
    status = 'active', scopes = array['manual_notes'],
    consent_version = excluded.consent_version,
    authorization_attested_at = now(),
    authorization_attested_by = p_actor_user_id,
    authorized_owner_user_id = p_owner_user_id,
    upstream_revoke_status = 'not_applicable',
    disconnected_at = null,
    metadata = jsonb_build_object('connection_mode', 'manual', 'raw_media', false),
    updated_at = now()
  returning id into connection_id;
  return connection_id;
end;
$$;

create or replace function public.lbb_disconnect_recording_connection(
  p_tenant_id uuid,
  p_connection_id uuid,
  p_actor_user_id uuid,
  p_upstream_revoked boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  connection_row public.integration_connections%rowtype;
begin
  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id = p_tenant_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and (
        member.role = 'operator'
        or (member.role = 'owner' and exists (
          select 1 from public.integration_connections owned
          where owned.tenant_id = p_tenant_id
            and owned.id = p_connection_id
            and owned.user_id = p_actor_user_id
        ))
      )
  ) then
    raise exception 'owner or operator access required';
  end if;
  select * into connection_row
  from public.integration_connections
  where tenant_id = p_tenant_id
    and id = p_connection_id
    and provider in ('fireflies', 'fathom', 'google_meet')
  for update;
  if connection_row.id is null then return false; end if;

  update public.integration_connections set
    status = 'disconnected',
    disconnected_at = now(),
    refresh_token_secret_id = case
      when connection_row.provider = 'fathom' and not p_upstream_revoked
        then connection_row.refresh_token_secret_id
      else null
    end,
    webhook_secret_id = null,
    sync_cursor = null,
    upstream_revoke_status = case
      when p_upstream_revoked then 'revoked'
      when connection_row.provider in ('fireflies', 'fathom') then 'cleanup_pending'
      else 'not_applicable'
    end,
    upstream_revoked_at = case when p_upstream_revoked then now() else null end,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'derived_notes_retained', true,
      'upstream_webhook_cleanup_required',
        connection_row.provider in ('fireflies', 'fathom') and not p_upstream_revoked
    ),
    updated_at = now()
  where id = connection_row.id;
  if connection_row.refresh_token_secret_id is not null
    and (connection_row.provider <> 'fathom' or p_upstream_revoked)
  then
    delete from vault.secrets where id = connection_row.refresh_token_secret_id;
  end if;
  if connection_row.webhook_secret_id is not null then
    delete from vault.secrets where id = connection_row.webhook_secret_id;
  end if;
  update public.recording_ingest_receipts
  set status = 'ignored', last_error = 'connection disconnected'
  where connection_id = connection_row.id
    and status in ('received', 'processing', 'failed');
  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action, table_name, record_id, metadata
  ) values (
    p_tenant_id, p_actor_user_id,
    case when exists (
      select 1 from public.tenant_members where tenant_id = p_tenant_id
        and user_id = p_actor_user_id and role = 'operator'
    ) then 'operator' else 'client' end,
    'recording.connection_disconnected', 'integration_connections', connection_row.id,
    jsonb_build_object(
      'provider', connection_row.provider,
      'derived_notes_retained', true,
      'upstream_webhook_cleanup_required',
        connection_row.provider in ('fireflies', 'fathom') and not p_upstream_revoked
    )
  );
  return true;
end;
$$;

create or replace function public.lbb_finalize_recording_revocation(
  p_connection_id uuid,
  p_succeeded boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  connection_row public.integration_connections%rowtype;
begin
  select * into connection_row
  from public.integration_connections
  where id = p_connection_id
    and provider = 'fathom'
  for update;
  if connection_row.id is null then return false; end if;
  if connection_row.status = 'disconnected'
    and connection_row.upstream_revoke_status = 'revoked'
  then
    return true;
  end if;
  if connection_row.status <> 'disconnected'
    or connection_row.upstream_revoke_status <> 'cleanup_pending'
  then
    return false;
  end if;

  if not p_succeeded then
    update public.integration_connections set
      last_error = left(coalesce(p_error, 'Fathom webhook cleanup failed.'), 400),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'upstream_cleanup_last_attempt_at', now()
      ),
      updated_at = now()
    where id = connection_row.id;
    return false;
  end if;

  if connection_row.refresh_token_secret_id is not null then
    delete from vault.secrets where id = connection_row.refresh_token_secret_id;
  end if;
  if connection_row.webhook_secret_id is not null then
    delete from vault.secrets where id = connection_row.webhook_secret_id;
  end if;
  update public.integration_connections set
    refresh_token_secret_id = null,
    webhook_secret_id = null,
    upstream_revoke_status = 'revoked',
    upstream_revoked_at = now(),
    last_error = null,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'upstream_webhook_cleanup_required', false,
      'upstream_cleanup_completed_at', now()
    ),
    updated_at = now()
  where id = connection_row.id;
  return true;
end;
$$;

create or replace function public.lbb_confirm_recording_upstream_revoked(
  p_tenant_id uuid,
  p_connection_id uuid,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and status = 'active'
      and role = 'operator'
  ) then
    raise exception 'operator access required';
  end if;
  update public.integration_connections set
    upstream_revoke_status = 'revoked',
    upstream_revoked_at = now(),
    last_error = null,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'upstream_webhook_cleanup_required', false,
      'upstream_cleanup_confirmed_by', p_actor_user_id,
      'upstream_cleanup_completed_at', now()
    ),
    updated_at = now()
  where tenant_id = p_tenant_id
    and id = p_connection_id
    and provider = 'fireflies'
    and status = 'disconnected'
    and upstream_revoke_status = 'cleanup_pending';
  if not found then return false; end if;
  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action, table_name, record_id
  ) values (
    p_tenant_id, p_actor_user_id, 'operator',
    'recording.upstream_webhook_revoked', 'integration_connections', p_connection_id
  );
  return true;
end;
$$;

create or replace function public.lbb_record_meeting_artifact(
  p_tenant_id uuid,
  p_connection_id uuid,
  p_owner_user_id uuid,
  p_provider text,
  p_external_artifact_id text,
  p_title text,
  p_occurred_at timestamptz,
  p_duration_seconds integer,
  p_recording_url text,
  p_distilled_summary text,
  p_transcript_sha256 text,
  p_retention_until date,
  p_contact_ids uuid[],
  p_action_items jsonb,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  transcript_id uuid;
  existing_transcript_id uuid;
  connection_row public.integration_connections%rowtype;
begin
  if p_provider not in ('fireflies', 'fathom', 'google_meet')
    or nullif(trim(coalesce(p_external_artifact_id, '')), '') is null
    or p_occurred_at is null
    or nullif(trim(coalesce(p_distilled_summary, '')), '') is null
  then
    raise exception 'invalid meeting artifact';
  end if;
  select * into connection_row
  from public.integration_connections
  where tenant_id = p_tenant_id
    and id = p_connection_id
    and user_id = p_owner_user_id
    and provider = p_provider
  for update;
  if connection_row.id is null or connection_row.status <> 'active' then
    raise exception 'active recording connection not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || p_provider || ':' || p_external_artifact_id, 0)
  );
  select id into existing_transcript_id
  from public.transcripts
  where tenant_id = p_tenant_id
    and source = p_provider
    and external_artifact_id = p_external_artifact_id;
  if existing_transcript_id is not null then
    return jsonb_build_object('id', existing_transcript_id, 'duplicate', true);
  end if;

  insert into public.transcripts (
    tenant_id, interaction_id, connection_id, owner_user_id, title, source,
    source_ref, external_artifact_id, transcript_sha256, retention_until,
    distilled_summary, occurred_at, duration_seconds, recording_url,
    processing_status, action_items, metadata
  ) values (
    p_tenant_id, null, p_connection_id, p_owner_user_id,
    left(coalesce(p_title, 'Recorded meeting'), 240), p_provider,
    left(p_external_artifact_id, 240), p_external_artifact_id,
    nullif(p_transcript_sha256, ''), null,
    left(p_distilled_summary, 8000), p_occurred_at,
    greatest(coalesce(p_duration_seconds, 0), 0),
    nullif(left(coalesce(p_recording_url, ''), 1000), ''), 'review',
    case when jsonb_typeof(coalesce(p_action_items, '[]'::jsonb)) = 'array'
      then p_action_items else '[]'::jsonb end,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'provider_generated', true,
      'raw_transcript_stored', false,
      'evidence_grade', 'proposal',
      'proposed_contact_ids', coalesce(to_jsonb(p_contact_ids), '[]'::jsonb)
    )
  ) returning id into transcript_id;

  insert into public.audit_log (
    tenant_id, actor_type, action, table_name, record_id, metadata
  ) values (
    p_tenant_id, 'gateway', 'recording.artifact_imported', 'transcripts', transcript_id,
    jsonb_build_object(
      'provider', p_provider,
      'external_artifact_id', left(p_external_artifact_id, 160),
      'proposed_contact_count', cardinality(coalesce(p_contact_ids, '{}'::uuid[])),
      'raw_transcript_stored', false
    )
  );
  update public.integration_connections set
    last_synced_at = now(), last_error = null, updated_at = now()
  where tenant_id = p_tenant_id and id = p_connection_id and status = 'active';
  return jsonb_build_object(
    'id', transcript_id,
    'interaction_id', null,
    'duplicate', false
  );
end;
$$;

create or replace function public.lbb_accept_meeting_artifact(
  p_tenant_id uuid,
  p_transcript_id uuid,
  p_actor_user_id uuid,
  p_contact_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  transcript_row public.transcripts%rowtype;
  created_interaction_id uuid;
  contact_id uuid;
begin
  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id = p_tenant_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and member.role = 'owner'
  ) then
    raise exception 'recording owner access required';
  end if;

  select * into transcript_row
  from public.transcripts
  where tenant_id = p_tenant_id and id = p_transcript_id
  for update;
  if transcript_row.id is null then
    raise exception 'meeting artifact not found';
  end if;
  if transcript_row.owner_user_id <> p_actor_user_id then
    raise exception 'owners may review only their own meeting artifacts';
  end if;
  if transcript_row.interaction_id is not null
    and transcript_row.processing_status = 'ready'
  then
    return jsonb_build_object(
      'id', transcript_row.id,
      'interaction_id', transcript_row.interaction_id,
      'duplicate', true
    );
  end if;
  if transcript_row.processing_status <> 'review'
    or transcript_row.source not in ('fireflies', 'fathom', 'google_meet')
    or nullif(trim(coalesce(transcript_row.distilled_summary, '')), '') is null
  then
    raise exception 'meeting artifact is not ready for review';
  end if;

  insert into public.interactions (
    tenant_id, occurred_at, interaction_type, title, summary, source,
    source_ref, metadata, idempotency_key
  ) values (
    p_tenant_id,
    coalesce(transcript_row.occurred_at, transcript_row.created_at),
    'meeting',
    left(coalesce(transcript_row.title, 'Recorded meeting'), 240),
    left(transcript_row.distilled_summary, 8000),
    transcript_row.source,
    left(coalesce(transcript_row.external_artifact_id, transcript_row.id::text), 240),
    jsonb_build_object(
      'provider_generated', true,
      'evidence_grade', 'owner_confirmed',
      'confirmed_by', p_actor_user_id,
      'confirmed_at', now(),
      'transcript_id', transcript_row.id,
      'recording_url', transcript_row.recording_url
    ),
    left('recording-confirmed:' || transcript_row.id::text, 160)
  ) returning id into created_interaction_id;

  foreach contact_id in array coalesce(p_contact_ids, '{}'::uuid[]) loop
    if exists (
      select 1 from public.contacts
      where tenant_id = p_tenant_id and id = contact_id and archived_at is null
    ) then
      insert into public.interaction_contacts (tenant_id, interaction_id, contact_id, role)
      values (p_tenant_id, created_interaction_id, contact_id, 'participant')
      on conflict do nothing;
    end if;
  end loop;

  update public.transcripts set
    interaction_id = created_interaction_id,
    processing_status = 'ready',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'evidence_grade', 'owner_confirmed',
      'confirmed_by', p_actor_user_id,
      'confirmed_at', now(),
      'confirmed_contact_ids', coalesce(to_jsonb(p_contact_ids), '[]'::jsonb)
    ),
    updated_at = now()
  where tenant_id = p_tenant_id and id = transcript_row.id;

  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action, table_name, record_id, metadata
  ) values (
    p_tenant_id,
    p_actor_user_id,
    case when exists (
      select 1 from public.tenant_members
      where tenant_id = p_tenant_id and user_id = p_actor_user_id and role = 'operator'
    ) then 'operator' else 'client' end,
    'recording.artifact_confirmed',
    'transcripts',
    transcript_row.id,
    jsonb_build_object(
      'interaction_id', created_interaction_id,
      'contact_count', cardinality(coalesce(p_contact_ids, '{}'::uuid[]))
    )
  );

  return jsonb_build_object(
    'id', transcript_row.id,
    'interaction_id', created_interaction_id,
    'duplicate', false
  );
end;
$$;

create or replace function public.lbb_dismiss_meeting_artifact(
  p_tenant_id uuid,
  p_transcript_id uuid,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id = p_tenant_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and member.role in ('owner', 'operator')
  ) then
    raise exception 'owner or operator access required';
  end if;
  update public.transcripts set
    processing_status = 'dismissed',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'evidence_grade', 'dismissed',
      'dismissed_by', p_actor_user_id,
      'dismissed_at', now()
    ),
    updated_at = now()
  where tenant_id = p_tenant_id
    and id = p_transcript_id
    and processing_status = 'review'
    and interaction_id is null
    and (
      owner_user_id = p_actor_user_id
      or exists (
        select 1 from public.tenant_members
        where tenant_id = p_tenant_id
          and user_id = p_actor_user_id
          and status = 'active'
          and role = 'operator'
      )
    );
  if not found then return false; end if;
  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action, table_name, record_id
  ) values (
    p_tenant_id, p_actor_user_id, 'client',
    'recording.artifact_dismissed', 'transcripts', p_transcript_id
  );
  return true;
end;
$$;

revoke all on function public.lbb_prepare_recording_connection(uuid, uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.lbb_upsert_recording_connection(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.lbb_abandon_recording_connection_provisioning(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.lbb_mark_recording_provisioning_cleanup_pending(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.lbb_recording_connection_secrets(uuid) from public, anon, authenticated;
revoke all on function public.lbb_ensure_manual_recording_connection(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.lbb_disconnect_recording_connection(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.lbb_finalize_recording_revocation(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.lbb_confirm_recording_upstream_revoked(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.lbb_record_meeting_artifact(uuid, uuid, uuid, text, text, text, timestamptz, integer, text, text, text, date, uuid[], jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.lbb_accept_meeting_artifact(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.lbb_dismiss_meeting_artifact(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.lbb_enqueue_recording_receipt(uuid, uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.lbb_claim_recording_receipts(integer, integer) from public, anon, authenticated;
revoke all on function public.lbb_finish_recording_receipt(uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.lbb_prepare_recording_connection(uuid, uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.lbb_upsert_recording_connection(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text) to service_role;
grant execute on function public.lbb_abandon_recording_connection_provisioning(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.lbb_mark_recording_provisioning_cleanup_pending(uuid, uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.lbb_recording_connection_secrets(uuid) to service_role;
grant execute on function public.lbb_ensure_manual_recording_connection(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.lbb_disconnect_recording_connection(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.lbb_finalize_recording_revocation(uuid, boolean, text) to service_role;
grant execute on function public.lbb_confirm_recording_upstream_revoked(uuid, uuid, uuid) to service_role;
grant execute on function public.lbb_record_meeting_artifact(uuid, uuid, uuid, text, text, text, timestamptz, integer, text, text, text, date, uuid[], jsonb, jsonb) to service_role;
grant execute on function public.lbb_accept_meeting_artifact(uuid, uuid, uuid, uuid[]) to service_role;
grant execute on function public.lbb_dismiss_meeting_artifact(uuid, uuid, uuid) to service_role;
grant execute on function public.lbb_enqueue_recording_receipt(uuid, uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function public.lbb_claim_recording_receipts(integer, integer) to service_role;
grant execute on function public.lbb_finish_recording_receipt(uuid, uuid, text, text, boolean) to service_role;
