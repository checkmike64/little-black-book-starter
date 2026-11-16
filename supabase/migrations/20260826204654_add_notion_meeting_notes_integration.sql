-- Notion AI Meeting Notes joins the existing provider-neutral recording
-- pipeline. OAuth secrets stay in Vault, webhook/transcript bodies are never
-- persisted, and provider AI remains a proposal until the recording owner
-- confirms it.

alter table public.integration_connections
  add column if not exists access_token_secret_id uuid;

alter table public.integration_connections
  drop constraint if exists integration_connections_provider_check;

alter table public.integration_connections
  add constraint integration_connections_provider_check
  check (provider in (
    'google_calendar', 'claude_calendar', 'google_gmail',
    'fireflies', 'fathom', 'google_meet', 'notion'
  ));

alter table public.recording_ingest_receipts
  drop constraint if exists recording_ingest_receipts_provider_check;

alter table public.recording_ingest_receipts
  add constraint recording_ingest_receipts_provider_check
  check (provider in ('fireflies', 'fathom', 'google_meet', 'notion'));

create table public.notion_oauth_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.notion_oauth_transactions enable row level security;
revoke all on table public.notion_oauth_transactions from public, anon, authenticated;
grant all on table public.notion_oauth_transactions to service_role;

create index notion_oauth_transactions_actor_idx
  on public.notion_oauth_transactions (tenant_id, user_id, expires_at);

create or replace function public.lbb_create_notion_oauth_transaction(
  p_tenant_id uuid,
  p_user_id uuid,
  p_state_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  transaction_id uuid := gen_random_uuid();
begin
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id
      and user_id = p_user_id
      and status = 'active'
      and role = 'owner'
  ) then
    raise exception 'recording owner access required';
  end if;
  if p_state_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid Notion OAuth transaction';
  end if;
  delete from public.notion_oauth_transactions
  where tenant_id = p_tenant_id and user_id = p_user_id and expires_at <= now();
  insert into public.notion_oauth_transactions (
    id, tenant_id, user_id, state_hash, expires_at
  ) values (
    transaction_id, p_tenant_id, p_user_id, p_state_hash, now() + interval '10 minutes'
  );
  return transaction_id;
end;
$$;

create or replace function public.lbb_consume_notion_oauth_transaction(
  p_tenant_id uuid,
  p_user_id uuid,
  p_state_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  transaction_id uuid;
begin
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id and user_id = p_user_id
      and status = 'active' and role = 'owner'
  ) then
    raise exception 'recording owner access required';
  end if;
  delete from public.notion_oauth_transactions
  where tenant_id = p_tenant_id
    and user_id = p_user_id
    and state_hash = p_state_hash
    and expires_at > now()
  returning id into transaction_id;
  return transaction_id is not null;
end;
$$;

create or replace function public.lbb_save_notion_recording_connection(
  p_tenant_id uuid,
  p_owner_user_id uuid,
  p_external_account_email text,
  p_workspace_id text,
  p_workspace_name text,
  p_access_token text,
  p_refresh_token text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  connection_row public.integration_connections%rowtype;
  connection_id uuid;
  new_access_secret_id uuid;
  new_refresh_secret_id uuid;
  old_access_secret_id uuid;
  old_refresh_secret_id uuid;
begin
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id and user_id = p_owner_user_id
      and status = 'active' and role = 'owner'
  ) then
    raise exception 'recording owner access required';
  end if;
  if p_external_account_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or nullif(trim(coalesce(p_workspace_id, '')), '') is null
    or length(p_workspace_id) > 160
    or nullif(trim(coalesce(p_access_token, '')), '') is null
    or length(p_access_token) > 4000
    or nullif(trim(coalesce(p_refresh_token, '')), '') is null
    or length(coalesce(p_refresh_token, '')) > 4000
  then
    raise exception 'invalid Notion recording authorization';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || ':' || p_owner_user_id::text || ':notion', 0
  ));
  select * into connection_row
  from public.integration_connections
  where tenant_id = p_tenant_id and user_id = p_owner_user_id and provider = 'notion'
  for update;
  old_access_secret_id := connection_row.access_token_secret_id;
  old_refresh_secret_id := connection_row.refresh_token_secret_id;

  if old_access_secret_id is null then
    new_access_secret_id := vault.create_secret(
      p_access_token,
      'lbb-notion-access-' || p_tenant_id::text || '-' || p_owner_user_id::text,
      'Little Black Book Notion OAuth access token'
    );
  else
    new_access_secret_id := old_access_secret_id;
    perform vault.update_secret(
      new_access_secret_id, p_access_token,
      'lbb-notion-access-' || p_tenant_id::text || '-' || p_owner_user_id::text,
      'Little Black Book Notion OAuth access token'
    );
  end if;
  if old_refresh_secret_id is null then
    new_refresh_secret_id := vault.create_secret(
      p_refresh_token,
      'lbb-notion-refresh-' || p_tenant_id::text || '-' || p_owner_user_id::text,
      'Little Black Book Notion OAuth refresh token'
    );
  else
    new_refresh_secret_id := old_refresh_secret_id;
    perform vault.update_secret(
      new_refresh_secret_id, p_refresh_token,
      'lbb-notion-refresh-' || p_tenant_id::text || '-' || p_owner_user_id::text,
      'Little Black Book Notion OAuth refresh token'
    );
  end if;

  insert into public.integration_connections (
    tenant_id, user_id, provider, status, external_account_email, scopes,
    access_token_secret_id, refresh_token_secret_id, consent_version,
    consented_at, consented_by, authorization_attested_at,
    authorization_attested_by, authorized_owner_user_id,
    upstream_revoke_status, disconnected_at, last_error, metadata
  ) values (
    p_tenant_id, p_owner_user_id, 'notion', 'active', lower(p_external_account_email),
    array['my_meeting_notes'], new_access_secret_id, new_refresh_secret_id,
    'notion-meeting-notes-oauth-v1', now(), p_owner_user_id, now(),
    p_owner_user_id, p_owner_user_id, 'not_applicable', null, null,
    jsonb_build_object(
      'connection_mode', 'oauth',
      'workspace_id', left(p_workspace_id, 160),
      'workspace_name', left(coalesce(p_workspace_name, ''), 240),
      'raw_media', false,
      'raw_transcript_stored', false,
      'poll_interval_minutes', 5
    )
  )
  on conflict (tenant_id, user_id, provider) do update set
    status = 'active',
    external_account_email = excluded.external_account_email,
    scopes = excluded.scopes,
    access_token_secret_id = excluded.access_token_secret_id,
    refresh_token_secret_id = excluded.refresh_token_secret_id,
    consent_version = excluded.consent_version,
    consented_at = now(),
    consented_by = p_owner_user_id,
    authorization_attested_at = now(),
    authorization_attested_by = p_owner_user_id,
    authorized_owner_user_id = p_owner_user_id,
    upstream_revoke_status = 'not_applicable',
    upstream_revoked_at = null,
    disconnected_at = null,
    last_error = null,
    metadata = excluded.metadata,
    updated_at = now()
  returning id into connection_id;

  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action, table_name, record_id, metadata
  ) values (
    p_tenant_id, p_owner_user_id, 'client', 'recording.notion_connected',
    'integration_connections', connection_id,
    jsonb_build_object(
      'provider', 'notion',
      'scope', 'my_meeting_notes',
      'content_recorded', false
    )
  );
  return connection_id;
end;
$$;

create or replace function public.lbb_notion_recording_connection_secrets(
  p_connection_id uuid
)
returns table (
  connection_id uuid,
  tenant_id uuid,
  owner_user_id uuid,
  provider text,
  connection_status text,
  api_key text,
  access_token text,
  refresh_token text,
  webhook_secret text,
  scopes text[],
  external_account_email text
)
language sql
security definer
set search_path = pg_catalog, public, vault
as $$
  select c.id, c.tenant_id, c.user_id, c.provider, c.status,
    null::text, access.decrypted_secret, refresh.decrypted_secret, null::text,
    c.scopes, c.external_account_email
  from public.integration_connections c
  left join vault.decrypted_secrets access on access.id = c.access_token_secret_id
  left join vault.decrypted_secrets refresh on refresh.id = c.refresh_token_secret_id
  where c.id = p_connection_id and c.provider = 'notion';
$$;

create or replace function public.lbb_rotate_notion_recording_tokens(
  p_connection_id uuid,
  p_access_token text,
  p_refresh_token text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  connection_row public.integration_connections%rowtype;
  new_access_secret_id uuid;
  new_refresh_secret_id uuid;
begin
  if nullif(trim(coalesce(p_access_token, '')), '') is null
    or nullif(trim(coalesce(p_refresh_token, '')), '') is null
    or length(p_access_token) > 4000
    or length(p_refresh_token) > 4000
  then raise exception 'invalid Notion token refresh'; end if;
  select * into connection_row
  from public.integration_connections
  where id = p_connection_id and provider = 'notion' and status = 'active'
  for update;
  if connection_row.id is null then return false; end if;
  if connection_row.access_token_secret_id is null then
    new_access_secret_id := vault.create_secret(
      p_access_token, 'lbb-notion-access-' || connection_row.tenant_id::text || '-' || connection_row.user_id::text,
      'Little Black Book Notion OAuth access token'
    );
  else
    new_access_secret_id := connection_row.access_token_secret_id;
    perform vault.update_secret(
      new_access_secret_id, p_access_token,
      'lbb-notion-access-' || connection_row.tenant_id::text || '-' || connection_row.user_id::text,
      'Little Black Book Notion OAuth access token'
    );
  end if;
  if connection_row.refresh_token_secret_id is null then
    new_refresh_secret_id := vault.create_secret(
      p_refresh_token, 'lbb-notion-refresh-' || connection_row.tenant_id::text || '-' || connection_row.user_id::text,
      'Little Black Book Notion OAuth refresh token'
    );
  else
    new_refresh_secret_id := connection_row.refresh_token_secret_id;
    perform vault.update_secret(
      new_refresh_secret_id, p_refresh_token,
      'lbb-notion-refresh-' || connection_row.tenant_id::text || '-' || connection_row.user_id::text,
      'Little Black Book Notion OAuth refresh token'
    );
  end if;
  update public.integration_connections set
    access_token_secret_id = new_access_secret_id,
    refresh_token_secret_id = new_refresh_secret_id,
    last_error = null,
    updated_at = now()
  where id = connection_row.id;
  return true;
end;
$$;

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
  if p_provider not in ('fireflies', 'fathom', 'google_meet', 'notion')
    or nullif(trim(coalesce(p_external_event_id, '')), '') is null
    or nullif(trim(coalesce(p_external_artifact_id, '')), '') is null
  then raise exception 'invalid recording receipt'; end if;
  if not exists (
    select 1 from public.integration_connections
    where tenant_id = p_tenant_id and id = p_connection_id
      and user_id = p_owner_user_id and provider = p_provider and status = 'active'
  ) then raise exception 'active recording connection not found'; end if;
  insert into public.recording_ingest_receipts (
    tenant_id, connection_id, owner_user_id, provider,
    external_event_id, external_artifact_id, event_type, payload_sha256,
    status, next_attempt_at, metadata
  ) values (
    p_tenant_id, p_connection_id, p_owner_user_id, p_provider,
    left(p_external_event_id, 320), left(p_external_artifact_id, 320),
    left(p_event_type, 120), left(p_payload_sha256, 128), 'received', now(),
    jsonb_build_object('raw_payload_stored', false, 'durable_queue', true)
  )
  on conflict (connection_id, external_event_id) do update set
    status = 'received', attempts = 0, last_error = null, next_attempt_at = now(),
    processed_at = null, locked_at = null, lock_token = null,
    metadata = recording_ingest_receipts.metadata || jsonb_build_object(
      'rearmed_by_reconciliation_at', now()
    )
  where recording_ingest_receipts.status = 'ignored'
    and recording_ingest_receipts.event_type = 'daily.reconcile'
    and excluded.event_type = 'daily.reconcile'
    and not exists (
      select 1 from public.transcripts t
      where t.tenant_id = excluded.tenant_id and t.source = excluded.provider
        and t.external_artifact_id = excluded.external_artifact_id
    )
  returning id into receipt_id;
  if receipt_id is not null then inserted := true;
  else
    select id into receipt_id from public.recording_ingest_receipts
    where connection_id = p_connection_id
      and external_event_id = left(p_external_event_id, 320);
  end if;
  if receipt_id is null then raise exception 'recording receipt could not be resolved'; end if;
  return jsonb_build_object('id', receipt_id, 'duplicate', not inserted);
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
  if p_provider not in ('fireflies', 'fathom', 'google_meet', 'notion')
    or nullif(trim(coalesce(p_external_artifact_id, '')), '') is null
    or p_occurred_at is null
    or nullif(trim(coalesce(p_distilled_summary, '')), '') is null
  then raise exception 'invalid meeting artifact'; end if;
  select * into connection_row from public.integration_connections
  where tenant_id = p_tenant_id and id = p_connection_id
    and user_id = p_owner_user_id and provider = p_provider
  for update;
  if connection_row.id is null or connection_row.status <> 'active' then
    raise exception 'active recording connection not found';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || p_provider || ':' || p_external_artifact_id, 0)
  );
  select id into existing_transcript_id from public.transcripts
  where tenant_id = p_tenant_id and source = p_provider
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
      'provider_generated', true, 'raw_transcript_stored', false,
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
  return jsonb_build_object('id', transcript_id, 'interaction_id', null, 'duplicate', false);
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
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id and user_id = p_actor_user_id
      and status = 'active' and role = 'owner'
  ) then raise exception 'recording owner access required'; end if;
  select * into transcript_row from public.transcripts
  where tenant_id = p_tenant_id and id = p_transcript_id for update;
  if transcript_row.id is null then raise exception 'meeting artifact not found'; end if;
  if transcript_row.owner_user_id <> p_actor_user_id then
    raise exception 'owners may review only their own meeting artifacts';
  end if;
  if transcript_row.interaction_id is not null and transcript_row.processing_status = 'ready' then
    return jsonb_build_object('id', transcript_row.id, 'interaction_id', transcript_row.interaction_id, 'duplicate', true);
  end if;
  if transcript_row.processing_status <> 'review'
    or transcript_row.source not in ('fireflies', 'fathom', 'google_meet', 'notion')
    or nullif(trim(coalesce(transcript_row.distilled_summary, '')), '') is null
  then raise exception 'meeting artifact is not ready for review'; end if;
  insert into public.interactions (
    tenant_id, occurred_at, interaction_type, title, summary, source,
    source_ref, metadata, idempotency_key
  ) values (
    p_tenant_id, coalesce(transcript_row.occurred_at, transcript_row.created_at),
    'meeting', left(coalesce(transcript_row.title, 'Recorded meeting'), 240),
    left(transcript_row.distilled_summary, 8000), transcript_row.source,
    left(coalesce(transcript_row.external_artifact_id, transcript_row.id::text), 240),
    jsonb_build_object(
      'provider_generated', true, 'evidence_grade', 'owner_confirmed',
      'confirmed_by', p_actor_user_id, 'confirmed_at', now(),
      'transcript_id', transcript_row.id, 'recording_url', transcript_row.recording_url
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
    interaction_id = created_interaction_id, processing_status = 'ready',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'evidence_grade', 'owner_confirmed', 'confirmed_by', p_actor_user_id,
      'confirmed_at', now(),
      'confirmed_contact_ids', coalesce(to_jsonb(p_contact_ids), '[]'::jsonb)
    ), updated_at = now()
  where tenant_id = p_tenant_id and id = transcript_row.id;
  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action, table_name, record_id, metadata
  ) values (
    p_tenant_id, p_actor_user_id, 'client', 'recording.artifact_confirmed',
    'transcripts', transcript_row.id,
    jsonb_build_object(
      'interaction_id', created_interaction_id,
      'contact_count', cardinality(coalesce(p_contact_ids, '{}'::uuid[]))
    )
  );
  return jsonb_build_object(
    'id', transcript_row.id, 'interaction_id', created_interaction_id, 'duplicate', false
  );
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
    where member.tenant_id = p_tenant_id and member.user_id = p_actor_user_id
      and member.status = 'active' and (
        member.role = 'operator' or (member.role = 'owner' and exists (
          select 1 from public.integration_connections owned
          where owned.tenant_id = p_tenant_id and owned.id = p_connection_id
            and owned.user_id = p_actor_user_id
        ))
      )
  ) then raise exception 'owner or operator access required'; end if;
  select * into connection_row from public.integration_connections
  where tenant_id = p_tenant_id and id = p_connection_id
    and provider in ('fireflies', 'fathom', 'google_meet', 'notion')
  for update;
  if connection_row.id is null then return false; end if;
  update public.integration_connections set
    status = 'disconnected', disconnected_at = now(), access_token_secret_id = null,
    refresh_token_secret_id = case
      when connection_row.provider = 'fathom' and not p_upstream_revoked
        then connection_row.refresh_token_secret_id
      else null end,
    webhook_secret_id = null, sync_cursor = null,
    upstream_revoke_status = case
      when p_upstream_revoked then 'revoked'
      when connection_row.provider in ('fireflies', 'fathom') then 'cleanup_pending'
      else 'not_applicable' end,
    upstream_revoked_at = case when p_upstream_revoked then now() else null end,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'derived_notes_retained', true,
      'upstream_webhook_cleanup_required',
        connection_row.provider in ('fireflies', 'fathom') and not p_upstream_revoked
    ), updated_at = now()
  where id = connection_row.id;
  if connection_row.access_token_secret_id is not null then
    delete from vault.secrets where id = connection_row.access_token_secret_id;
  end if;
  if connection_row.refresh_token_secret_id is not null
    and (connection_row.provider <> 'fathom' or p_upstream_revoked)
  then delete from vault.secrets where id = connection_row.refresh_token_secret_id; end if;
  if connection_row.webhook_secret_id is not null then
    delete from vault.secrets where id = connection_row.webhook_secret_id;
  end if;
  update public.recording_ingest_receipts
  set status = 'ignored', last_error = 'connection disconnected'
  where connection_id = connection_row.id and status in ('received', 'processing', 'failed');
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
      'provider', connection_row.provider, 'derived_notes_retained', true,
      'upstream_webhook_cleanup_required',
        connection_row.provider in ('fireflies', 'fathom') and not p_upstream_revoked
    )
  );
  return true;
end;
$$;

revoke all on function public.lbb_create_notion_oauth_transaction(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.lbb_consume_notion_oauth_transaction(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.lbb_save_notion_recording_connection(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.lbb_notion_recording_connection_secrets(uuid) from public, anon, authenticated;
revoke all on function public.lbb_rotate_notion_recording_tokens(uuid, text, text) from public, anon, authenticated;
revoke all on function public.lbb_enqueue_recording_receipt(uuid, uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.lbb_record_meeting_artifact(uuid, uuid, uuid, text, text, text, timestamptz, integer, text, text, text, date, uuid[], jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.lbb_accept_meeting_artifact(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.lbb_disconnect_recording_connection(uuid, uuid, uuid, boolean) from public, anon, authenticated;

grant execute on function public.lbb_create_notion_oauth_transaction(uuid, uuid, text) to service_role;
grant execute on function public.lbb_consume_notion_oauth_transaction(uuid, uuid, text) to service_role;
grant execute on function public.lbb_save_notion_recording_connection(uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function public.lbb_notion_recording_connection_secrets(uuid) to service_role;
grant execute on function public.lbb_rotate_notion_recording_tokens(uuid, text, text) to service_role;
grant execute on function public.lbb_enqueue_recording_receipt(uuid, uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function public.lbb_record_meeting_artifact(uuid, uuid, uuid, text, text, text, timestamptz, integer, text, text, text, date, uuid[], jsonb, jsonb) to service_role;
grant execute on function public.lbb_accept_meeting_artifact(uuid, uuid, uuid, uuid[]) to service_role;
grant execute on function public.lbb_disconnect_recording_connection(uuid, uuid, uuid, boolean) to service_role;
