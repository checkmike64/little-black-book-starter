-- Owner-confirmed recording baseline intelligence.
--
-- This migration keeps the provider/AI boundary service-role only. Meeting
-- participants are confirmed explicitly by the owning user, baseline jobs are
-- leased atomically, and generated facts can only fill SQL NULL allowlisted
-- fields from an owner-confirmed meeting. Established values are
-- never overwritten: a one-field pending change is created instead.

alter table public.jobs
  add column if not exists idempotency_key text,
  add column if not exists payload_hash text,
  add column if not exists lock_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists contact_updated_at_at_claim timestamptz,
  add column if not exists last_error text;

alter table public.jobs
  drop constraint if exists jobs_idempotency_payload_hash_check,
  add constraint jobs_idempotency_payload_hash_check check (
    (idempotency_key is null and payload_hash is null)
    or (
      nullif(trim(idempotency_key), '') is not null
      and length(idempotency_key) <= 240
      and payload_hash ~ '^[0-9a-f]{64}$'
    )
  );

create unique index if not exists jobs_tenant_type_idempotency_idx
  on public.jobs (tenant_id, job_type, idempotency_key)
  where tenant_id is not null and idempotency_key is not null;

create index if not exists jobs_recording_baseline_lease_idx
  on public.jobs (run_after, lease_expires_at)
  where job_type = 'recording_baseline'
    and status in ('queued', 'running');

create table if not exists app_private.recording_baseline_field_policy (
  field_name text primary key,
  value_kind text not null check (value_kind in ('text', 'text_array', 'date')),
  max_length integer not null check (max_length between 1 and 8000),
  auto_fill_when_sql_null boolean not null default true,
  created_at timestamptz not null default now()
);

alter table app_private.recording_baseline_field_policy enable row level security;
revoke all on table app_private.recording_baseline_field_policy
  from public, anon, authenticated;
grant select on table app_private.recording_baseline_field_policy to service_role;

insert into app_private.recording_baseline_field_policy (
  field_name, value_kind, max_length, auto_fill_when_sql_null
) values
  ('company_name', 'text', 500, true),
  ('company_description', 'text', 4000, true),
  ('role_title', 'text_array', 240, true),
  ('location', 'text_array', 500, true),
  ('time_zone', 'text', 100, true),
  ('phone', 'text', 120, true),
  ('linkedin', 'text', 1000, true),
  ('instagram', 'text', 1000, true),
  ('facebook', 'text', 1000, true),
  ('x_twitter', 'text', 1000, true),
  ('youtube', 'text', 1000, true),
  ('podcast_url', 'text', 1000, true),
  ('website', 'text', 1000, true),
  ('current_asks', 'text', 4000, true),
  ('wants_help_with', 'text', 4000, true),
  ('services_offered', 'text_array', 500, true),
  ('ideal_referral', 'text', 4000, true)
on conflict (field_name) do update set
  value_kind = excluded.value_kind,
  max_length = excluded.max_length,
  auto_fill_when_sql_null = excluded.auto_fill_when_sql_null;

create or replace function app_private.recording_baseline_value_is_valid(
  p_field_name text,
  p_value_kind text,
  p_value jsonb,
  p_max_length integer
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  item jsonb;
  parsed_date date;
begin
  if p_value is null or p_value = 'null'::jsonb then return false; end if;
  if p_value_kind = 'text' then
    if jsonb_typeof(p_value) <> 'string'
      or length(trim(p_value #>> '{}')) not between 1 and p_max_length then
      return false;
    end if;
    if p_field_name in (
      'website', 'linkedin', 'instagram', 'facebook', 'x_twitter', 'youtube', 'podcast_url'
    ) then
      return trim(p_value #>> '{}') ~* '^https://[^[:space:]]+$';
    end if;
    if p_field_name = 'phone' then
      return trim(p_value #>> '{}') ~ '^\+?[0-9 ()-]{7,40}$'
        and length(regexp_replace(p_value #>> '{}', '[^0-9]', '', 'g')) between 7 and 15;
    end if;
    return true;
  elsif p_value_kind = 'text_array' then
    if jsonb_typeof(p_value) <> 'array'
      or jsonb_array_length(p_value) not between 1 and 25 then
      return false;
    end if;
    for item in select value from jsonb_array_elements(p_value) loop
      if jsonb_typeof(item) <> 'string'
        or length(trim(item #>> '{}')) not between 1 and p_max_length then
        return false;
      end if;
    end loop;
    return true;
  elsif p_value_kind = 'date' then
    if jsonb_typeof(p_value) <> 'string'
      or p_value #>> '{}' !~ '^\d{4}-\d{2}-\d{2}$' then
      return false;
    end if;
    parsed_date := (p_value #>> '{}')::date;
    return to_char(parsed_date, 'YYYY-MM-DD') = p_value #>> '{}';
  end if;
  return false;
exception when others then
  return false;
end;
$$;

create or replace function app_private.normalize_recording_baseline_value(
  p_field_name text,
  p_value_kind text,
  p_value jsonb
)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case
    when p_value is null or p_value = 'null'::jsonb then null
    when p_field_name = 'phone' then regexp_replace(p_value #>> '{}', '[^0-9]', '', 'g')
    when p_field_name in (
      'website', 'linkedin', 'instagram', 'facebook', 'x_twitter', 'youtube', 'podcast_url'
    ) then regexp_replace(lower(trim(p_value #>> '{}')), '/+$', '')
    when p_value_kind = 'text' then
      lower(regexp_replace(trim(p_value #>> '{}'), '\s+', ' ', 'g'))
    when p_value_kind = 'date' then p_value #>> '{}'
    when p_value_kind = 'text_array' then (
      select string_agg(normalized, E'\x1f' order by normalized)
      from (
        select distinct lower(regexp_replace(trim(value), '\s+', ' ', 'g')) normalized
        from jsonb_array_elements_text(p_value) values_(value)
      ) normalized_values
    )
    else null
  end;
$$;

revoke all on function app_private.recording_baseline_value_is_valid(text,text,jsonb,integer)
  from public, anon, authenticated;
revoke all on function app_private.normalize_recording_baseline_value(text,text,jsonb)
  from public, anon, authenticated;
grant execute on function app_private.recording_baseline_value_is_valid(text,text,jsonb,integer)
  to service_role;
grant execute on function app_private.normalize_recording_baseline_value(text,text,jsonb)
  to service_role;

create or replace function public.lbb_enqueue_recording_baseline(
  p_tenant_id uuid,
  p_transcript_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  transcript_row public.transcripts%rowtype;
  interaction_row public.interactions%rowtype;
  contact_row record;
  confirmed_ids uuid[] := '{}'::uuid[];
  job_payload jsonb;
  job_key text;
  job_hash text;
  existing_job public.jobs%rowtype;
  eligible_count integer := 0;
  enqueued_count integer := 0;
  duplicate_count integer := 0;
begin
  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id = p_tenant_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and member.role = 'owner'
  ) then
    raise exception 'active recording owner access required' using errcode = '42501';
  end if;

  select * into transcript_row
  from public.transcripts
  where tenant_id = p_tenant_id
    and id = p_transcript_id
    and owner_user_id = p_actor_user_id
  for update;
  if not found or transcript_row.processing_status <> 'ready'
    or transcript_row.interaction_id is null
    or transcript_row.metadata ->> 'evidence_grade' <> 'owner_confirmed' then
    raise exception 'owner-confirmed meeting is required' using errcode = '22023';
  end if;

  select * into interaction_row
  from public.interactions
  where tenant_id = p_tenant_id
    and id = transcript_row.interaction_id
    and interaction_type = 'meeting'
    and metadata ->> 'evidence_grade' = 'owner_confirmed'
    and metadata ->> 'transcript_id' = transcript_row.id::text
  for update;
  if not found then
    raise exception 'owner-confirmed meeting interaction is required' using errcode = '22023';
  end if;

  select coalesce(array_agg(value::uuid order by value::uuid), '{}'::uuid[])
  into confirmed_ids
  from jsonb_array_elements_text(
    case when jsonb_typeof(transcript_row.metadata -> 'confirmed_contact_ids') = 'array'
      then transcript_row.metadata -> 'confirmed_contact_ids' else '[]'::jsonb end
  ) ids(value)
  where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  if cardinality(confirmed_ids) = 0 then
    raise exception 'explicit confirmed meeting contacts are required' using errcode = '22023';
  end if;

  for contact_row in
    select contact.id, contact.updated_at
    from public.contacts contact
    join public.interaction_contacts link
      on link.tenant_id = contact.tenant_id
      and link.contact_id = contact.id
      and link.interaction_id = interaction_row.id
    where contact.tenant_id = p_tenant_id
      and contact.id = any(confirmed_ids)
      and contact.archived_at is null
    order by contact.id
  loop
    eligible_count := eligible_count + 1;
    job_key := left('recording-baseline:' || transcript_row.id::text || ':' || contact_row.id::text, 240);
    job_payload := jsonb_build_object(
      'trigger', 'recording_confirmed_meeting_baseline',
      'transcript_id', transcript_row.id,
      'interaction_id', interaction_row.id,
      'contact_id', contact_row.id,
      'owner_user_id', p_actor_user_id,
      'requested_by', p_actor_user_id,
      'meeting_order_key', concat(
        coalesce(transcript_row.occurred_at, transcript_row.created_at)::text,
        ':', transcript_row.id::text
      )
    );
    job_hash := encode(extensions.digest(job_payload::text, 'sha256'), 'hex');

    insert into public.jobs (
      tenant_id, job_type, status, payload, result, attempts, run_after,
      idempotency_key, payload_hash
    ) values (
      p_tenant_id, 'recording_baseline', 'queued', job_payload, '{}'::jsonb,
      0, now(), job_key, job_hash
    )
    on conflict (tenant_id, job_type, idempotency_key)
      where tenant_id is not null and idempotency_key is not null
    do nothing;

    if found then
      enqueued_count := enqueued_count + 1;
    else
      select * into existing_job
      from public.jobs
      where tenant_id = p_tenant_id
        and job_type = 'recording_baseline'
        and idempotency_key = job_key
      for update;
      if existing_job.payload_hash is distinct from job_hash
        or existing_job.payload is distinct from job_payload then
        raise exception 'recording baseline idempotency conflict' using errcode = '40001';
      end if;
      if existing_job.status = 'cancelled'
        and existing_job.result ->> 'error_code' = 'meeting_contact_unconfirmed' then
        update public.jobs
        set status = 'queued', attempts = 0, run_after = now(), result = '{}'::jsonb,
          locked_at = null, lock_token = null, lease_expires_at = null,
          contact_updated_at_at_claim = null, last_error = null
        where id = existing_job.id;
        enqueued_count := enqueued_count + 1;
      else
        duplicate_count := duplicate_count + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'transcript_id', transcript_row.id,
    'eligible_count', eligible_count,
    'enqueued_count', enqueued_count,
    'duplicate_count', duplicate_count
  );
end;
$$;

revoke all on function public.lbb_enqueue_recording_baseline(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.lbb_enqueue_recording_baseline(uuid,uuid,uuid)
  to service_role;

create or replace function public.lbb_claim_recording_baseline_jobs(
  p_limit integer default 5,
  p_lease_seconds integer default 300
)
returns table (
  job_id uuid,
  tenant_id uuid,
  transcript_id uuid,
  interaction_id uuid,
  contact_id uuid,
  owner_user_id uuid,
  attempts integer,
  lock_token uuid,
  contact_updated_at timestamptz,
  is_first_confirmed_meeting boolean,
  meeting_title text,
  interaction_occurred_at timestamptz,
  interaction_summary text,
  meeting_action_items jsonb,
  contact_snapshot jsonb,
  transcript_sha256 text,
  provider text,
  source_ref text
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  candidate record;
  next_lock_token uuid;
begin
  if p_limit not between 1 and 25 then
    raise exception 'recording baseline claim limit must be between 1 and 25'
      using errcode = '22023';
  end if;
  if p_lease_seconds not between 30 and 900 then
    raise exception 'recording baseline lease must be between 30 and 900 seconds'
      using errcode = '22023';
  end if;

  -- Administrative changes (archive, attendee correction, transcript removal)
  -- must not leave permanently unclaimable work looking overdue.
  with cancelled as (
    update public.jobs invalid_job
    set status = 'cancelled',
      result = jsonb_build_object(
        'outcome', 'cancelled',
        'error_kind', 'conflict',
        'error_code', 'recording_baseline_source_ineligible'
      ),
      lock_token = null,
      locked_at = null,
      lease_expires_at = null,
      contact_updated_at_at_claim = null,
      last_error = 'recording baseline source is no longer eligible'
    where invalid_job.job_type = 'recording_baseline'
      and invalid_job.status in ('queued', 'running')
      and not exists (
        select 1
        from public.transcripts transcript
        join public.interactions interaction
          on interaction.tenant_id = transcript.tenant_id
          and interaction.id = transcript.interaction_id
          and interaction.interaction_type = 'meeting'
          and interaction.metadata ->> 'evidence_grade' = 'owner_confirmed'
        join public.contacts contact
          on contact.tenant_id = invalid_job.tenant_id
          and contact.id = case
            when invalid_job.payload ->> 'contact_id'
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (invalid_job.payload ->> 'contact_id')::uuid else null end
          and contact.archived_at is null
        join public.interaction_contacts link
          on link.tenant_id = invalid_job.tenant_id
          and link.interaction_id = interaction.id
          and link.contact_id = contact.id
        join public.tenant_members owner_member
          on owner_member.tenant_id = invalid_job.tenant_id
          and owner_member.user_id = transcript.owner_user_id
          and owner_member.status = 'active'
          and owner_member.role = 'owner'
        where transcript.tenant_id = invalid_job.tenant_id
          and transcript.id = case
            when invalid_job.payload ->> 'transcript_id'
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (invalid_job.payload ->> 'transcript_id')::uuid else null end
          and transcript.owner_user_id::text = invalid_job.payload ->> 'owner_user_id'
          and transcript.processing_status = 'ready'
          and transcript.metadata ->> 'evidence_grade' = 'owner_confirmed'
      )
    returning invalid_job.tenant_id, invalid_job.id, invalid_job.payload
  )
  insert into public.audit_log (
    tenant_id, actor_type, action, table_name, record_id, metadata
  )
  select tenant_id, 'system', 'recording.baseline_cancelled_source_ineligible',
    'jobs', id,
    jsonb_build_object(
      'transcript_id', payload -> 'transcript_id',
      'contact_id', payload -> 'contact_id'
    )
  from cancelled;

  -- Exhausted stale leases are terminal and cannot spin forever.
  update public.jobs exhausted
  set status = 'failed',
    lock_token = null,
    locked_at = null,
    lease_expires_at = null,
    last_error = 'recording baseline attempt limit reached',
    result = jsonb_build_object(
      'outcome', 'failed',
      'error_kind', 'attempt_limit',
      'error_code', 'recording_baseline_attempt_limit'
    )
  where exhausted.job_type = 'recording_baseline'
    and exhausted.status = 'running'
    and exhausted.attempts >= 5
    and exhausted.lease_expires_at <= now();

  for candidate in
    select
      queued.id as job_id,
      queued.tenant_id,
      queued.attempts,
      transcript.id as transcript_id,
      transcript.interaction_id,
      transcript.owner_user_id,
      transcript.title as meeting_title,
      coalesce(transcript.occurred_at, transcript.created_at) as interaction_occurred_at,
      interaction.summary as interaction_summary,
      coalesce((
        select jsonb_agg(resolved.followup_text order by resolved.source_item_index, resolved.id)
        from public.recording_followups resolved
        where resolved.tenant_id = queued.tenant_id
          and resolved.transcript_id = transcript.id
          and resolved.contact_id = contact.id
          and resolved.status in ('routed', 'completed')
      ), '[]'::jsonb) as meeting_action_items,
      transcript.transcript_sha256,
      transcript.source as provider,
      transcript.source_ref,
      contact.id as contact_id,
      contact.updated_at as contact_updated_at,
      jsonb_build_object(
        'id', contact.id,
        'full_name', contact.full_name,
        'company_name', contact.company_name,
        'company_description', contact.company_description,
        'role_title', contact.role_title,
        'location', contact.location,
        'time_zone', contact.time_zone,
        'phone', contact.phone,
        'linkedin', contact.linkedin,
        'instagram', contact.instagram,
        'facebook', contact.facebook,
        'x_twitter', contact.x_twitter,
        'youtube', contact.youtube,
        'podcast_url', contact.podcast_url,
        'website', contact.website,
        'current_asks', contact.current_asks,
        'wants_help_with', contact.wants_help_with,
        'services_offered', contact.services_offered,
        'ideal_referral', contact.ideal_referral
      ) as contact_snapshot
    from public.jobs queued
    join public.transcripts transcript
      on transcript.tenant_id = queued.tenant_id
      and transcript.id = case
        when queued.payload ->> 'transcript_id'
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (queued.payload ->> 'transcript_id')::uuid else null end
    join public.interactions interaction
      on interaction.tenant_id = transcript.tenant_id
      and interaction.id = transcript.interaction_id
    join public.contacts contact
      on contact.tenant_id = queued.tenant_id
      and contact.id = case
        when queued.payload ->> 'contact_id'
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (queued.payload ->> 'contact_id')::uuid else null end
    join public.interaction_contacts link
      on link.tenant_id = queued.tenant_id
      and link.interaction_id = interaction.id
      and link.contact_id = contact.id
    where queued.job_type = 'recording_baseline'
      and queued.attempts < 5
      and (
        (queued.status = 'queued' and queued.run_after <= now())
        or (
          queued.status = 'running'
          and queued.lease_expires_at is not null
          and queued.lease_expires_at <= now()
        )
      )
      and transcript.owner_user_id::text = queued.payload ->> 'owner_user_id'
      and transcript.processing_status = 'ready'
      and transcript.metadata ->> 'evidence_grade' = 'owner_confirmed'
      and interaction.interaction_type = 'meeting'
      and interaction.metadata ->> 'evidence_grade' = 'owner_confirmed'
      and contact.archived_at is null
    order by queued.run_after, queued.created_at, queued.id
    for update of queued skip locked
    limit p_limit
  loop
    next_lock_token := gen_random_uuid();
    update public.jobs claimed
    set status = 'running',
      attempts = claimed.attempts + 1,
      locked_at = now(),
      lock_token = next_lock_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      contact_updated_at_at_claim = candidate.contact_updated_at,
      last_error = null
    where claimed.id = candidate.job_id;

    job_id := candidate.job_id;
    tenant_id := candidate.tenant_id;
    transcript_id := candidate.transcript_id;
    interaction_id := candidate.interaction_id;
    contact_id := candidate.contact_id;
    owner_user_id := candidate.owner_user_id;
    attempts := candidate.attempts + 1;
    lock_token := next_lock_token;
    contact_updated_at := candidate.contact_updated_at;
    is_first_confirmed_meeting := not exists (
      select 1
      from public.transcripts prior_transcript
      join public.interaction_contacts prior_link
        on prior_link.tenant_id = prior_transcript.tenant_id
        and prior_link.interaction_id = prior_transcript.interaction_id
        and prior_link.contact_id = candidate.contact_id
      where prior_transcript.tenant_id = candidate.tenant_id
        and prior_transcript.owner_user_id = candidate.owner_user_id
        and prior_transcript.processing_status = 'ready'
        and prior_transcript.metadata ->> 'evidence_grade' = 'owner_confirmed'
        and (
          coalesce(prior_transcript.occurred_at, prior_transcript.created_at),
          prior_transcript.id
        ) < (candidate.interaction_occurred_at, candidate.transcript_id)
    );
    meeting_title := candidate.meeting_title;
    interaction_occurred_at := candidate.interaction_occurred_at;
    interaction_summary := candidate.interaction_summary;
    meeting_action_items := candidate.meeting_action_items;
    contact_snapshot := candidate.contact_snapshot;
    transcript_sha256 := candidate.transcript_sha256;
    provider := candidate.provider;
    source_ref := candidate.source_ref;
    return next;
  end loop;
end;
$$;

revoke all on function public.lbb_claim_recording_baseline_jobs(integer,integer)
  from public, anon, authenticated;
grant execute on function public.lbb_claim_recording_baseline_jobs(integer,integer)
  to service_role;

create or replace function public.lbb_fail_recording_baseline_job(
  p_job_id uuid,
  p_lock_token uuid,
  p_error_kind text,
  p_error_code text,
  p_error text,
  p_retry_after_seconds integer default 300
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  job_row public.jobs%rowtype;
  next_status text;
  retry_seconds integer := greatest(30, least(coalesce(p_retry_after_seconds, 300), 21600));
  clean_error text := nullif(left(trim(coalesce(p_error, '')), 500), '');
  next_run_after timestamptz;
begin
  if p_error_kind not in ('budget', 'rate_limit', 'timeout', 'unavailable', 'configuration', 'invalid_output', 'conflict')
    or p_error_code is null
    or p_error_code !~ '^[A-Za-z0-9._:-]{1,96}$' then
    raise exception 'invalid recording baseline error receipt' using errcode = '22023';
  end if;

  select * into job_row
  from public.jobs
  where id = p_job_id and job_type = 'recording_baseline'
  for update;
  if not found then
    raise exception 'recording baseline job not found' using errcode = '22023';
  end if;

  if job_row.status in ('queued', 'failed')
    and job_row.result ->> 'error_kind' = p_error_kind
    and job_row.result ->> 'error_code' = p_error_code then
    return jsonb_build_object(
      'job_id', job_row.id, 'status', job_row.status,
      'attempts', job_row.attempts, 'run_after', job_row.run_after,
      'duplicate', true
    );
  end if;
  if job_row.status <> 'running' or job_row.lock_token is distinct from p_lock_token then
    raise exception 'recording baseline lease conflict' using errcode = '40001';
  end if;

  next_status := case when job_row.attempts >= 5 then 'failed' else 'queued' end;
  next_run_after := case when next_status = 'queued'
    then now() + make_interval(secs => retry_seconds) else job_row.run_after end;

  update public.jobs
  set status = next_status,
    run_after = next_run_after,
    locked_at = null,
    lock_token = null,
    lease_expires_at = null,
    last_error = clean_error,
    result = jsonb_build_object(
      'outcome', next_status,
      'error_kind', p_error_kind,
      'error_code', p_error_code
    )
  where id = job_row.id;

  insert into public.audit_log (
    tenant_id, actor_type, action, table_name, record_id, metadata
  ) values (
    job_row.tenant_id, 'system', 'recording.baseline_' || next_status,
    'jobs', job_row.id,
    jsonb_build_object(
      'attempts', job_row.attempts,
      'error_kind', p_error_kind,
      'error_code', p_error_code,
      'retry_after_seconds', case when next_status = 'queued' then retry_seconds else null end
    )
  );

  return jsonb_build_object(
    'job_id', job_row.id, 'status', next_status,
    'attempts', job_row.attempts, 'run_after', next_run_after,
    'duplicate', false
  );
end;
$$;

revoke all on function public.lbb_fail_recording_baseline_job(uuid,uuid,text,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.lbb_fail_recording_baseline_job(uuid,uuid,text,text,text,integer)
  to service_role;

create or replace function public.lbb_apply_recording_baseline(
  p_job_id uuid,
  p_lock_token uuid,
  p_prompt_version text,
  p_gateway_generation_id text,
  p_suggestions jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  job_row public.jobs%rowtype;
  transcript_row public.transcripts%rowtype;
  interaction_row public.interactions%rowtype;
  contact_row public.contacts%rowtype;
  policy_row app_private.recording_baseline_field_policy%rowtype;
  suggestion record;
  suggestion_value jsonb;
  suggestion_confidence numeric;
  evidence_summary text;
  current_value jsonb;
  current_normalized text;
  suggested_normalized text;
  actual_suggestion_keys text[];
  suggestions_hash text;
  pending_change_id uuid;
  pending_ids jsonb := '[]'::jsonb;
  auto_filled_fields jsonb := '[]'::jsonb;
  auto_filled_count integer := 0;
  contradiction_count integer := 0;
  unchanged_count integer := 0;
  skipped_low_confidence_count integer := 0;
  first_confirmed_meeting boolean;
  contact_id_value uuid;
  transcript_id_value uuid;
  owner_user_id_value uuid;
  result_payload jsonb;
begin
  if p_prompt_version is null
    or p_prompt_version !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$'
    or p_gateway_generation_id is null
    or p_gateway_generation_id !~ '^gen_[A-Za-z0-9._:-]+$' then
    raise exception 'invalid recording baseline generation receipt' using errcode = '22023';
  end if;
  if p_suggestions is null or jsonb_typeof(p_suggestions) <> 'object'
    or (select count(*) from jsonb_object_keys(p_suggestions)) > 17 then
    raise exception 'recording baseline suggestions must be an allowlisted object'
      using errcode = '22023';
  end if;
  suggestions_hash := encode(extensions.digest(p_suggestions::text, 'sha256'), 'hex');

  select * into job_row
  from public.jobs
  where id = p_job_id and job_type = 'recording_baseline'
  for update;
  if not found then
    raise exception 'recording baseline job not found' using errcode = '22023';
  end if;

  if job_row.status = 'succeeded' and job_row.lock_token = p_lock_token then
    if job_row.result ->> 'suggestions_hash' = suggestions_hash
      and job_row.result ->> 'prompt_version' = p_prompt_version
      and job_row.result ->> 'gateway_generation_id' = p_gateway_generation_id then
      return job_row.result || jsonb_build_object('duplicate', true);
    end if;
    raise exception 'recording baseline completion idempotency conflict'
      using errcode = '40001';
  end if;
  if job_row.status <> 'running'
    or job_row.lock_token is distinct from p_lock_token
    or job_row.lease_expires_at is null
    or job_row.lease_expires_at <= now() then
    raise exception 'recording baseline lease conflict' using errcode = '40001';
  end if;
  if job_row.contact_updated_at_at_claim is null then
    raise exception 'recording baseline contact version was not captured'
      using errcode = '40001';
  end if;

  begin
    transcript_id_value := (job_row.payload ->> 'transcript_id')::uuid;
    contact_id_value := (job_row.payload ->> 'contact_id')::uuid;
    owner_user_id_value := (job_row.payload ->> 'owner_user_id')::uuid;
  exception when others then
    raise exception 'recording baseline job payload is invalid' using errcode = '22023';
  end;

  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id = job_row.tenant_id
      and member.user_id = owner_user_id_value
      and member.status = 'active'
      and member.role = 'owner'
  ) then
    raise exception 'active recording owner access required' using errcode = '42501';
  end if;

  select * into transcript_row
  from public.transcripts
  where tenant_id = job_row.tenant_id
    and id = transcript_id_value
    and owner_user_id = owner_user_id_value
    and processing_status = 'ready'
    and metadata ->> 'evidence_grade' = 'owner_confirmed'
  for update;
  if not found or transcript_row.interaction_id is null then
    raise exception 'owner-confirmed meeting is required' using errcode = '22023';
  end if;

  select * into interaction_row
  from public.interactions
  where tenant_id = job_row.tenant_id
    and id = transcript_row.interaction_id
    and interaction_type = 'meeting'
    and metadata ->> 'evidence_grade' = 'owner_confirmed'
    and metadata ->> 'transcript_id' = transcript_row.id::text
  for update;
  if not found or interaction_row.id::text <> job_row.payload ->> 'interaction_id' then
    raise exception 'recording baseline interaction mismatch' using errcode = '22023';
  end if;

  select * into contact_row
  from public.contacts
  where tenant_id = job_row.tenant_id
    and id = contact_id_value
    and archived_at is null
  for update;
  if not found or not exists (
    select 1 from public.interaction_contacts link
    where link.tenant_id = job_row.tenant_id
      and link.interaction_id = interaction_row.id
      and link.contact_id = contact_row.id
  ) then
    raise exception 'confirmed meeting contact is required' using errcode = '22023';
  end if;
  if contact_row.updated_at is distinct from job_row.contact_updated_at_at_claim then
    raise exception 'recording baseline contact changed after claim' using errcode = '40001';
  end if;

  first_confirmed_meeting := not exists (
    select 1
    from public.transcripts prior_transcript
    join public.interaction_contacts prior_link
      on prior_link.tenant_id = prior_transcript.tenant_id
      and prior_link.interaction_id = prior_transcript.interaction_id
      and prior_link.contact_id = contact_row.id
    where prior_transcript.tenant_id = job_row.tenant_id
      and prior_transcript.owner_user_id = owner_user_id_value
      and prior_transcript.processing_status = 'ready'
      and prior_transcript.metadata ->> 'evidence_grade' = 'owner_confirmed'
      and (
        coalesce(prior_transcript.occurred_at, prior_transcript.created_at),
        prior_transcript.id
      ) < (
        coalesce(transcript_row.occurred_at, transcript_row.created_at),
        transcript_row.id
      )
  );

  for suggestion in select key, value from jsonb_each(p_suggestions) order by key loop
    select * into policy_row
    from app_private.recording_baseline_field_policy policy
    where policy.field_name = suggestion.key
      and policy.auto_fill_when_sql_null;
    if not found then
      raise exception 'recording baseline field is not allowlisted: %', suggestion.key
        using errcode = '22023';
    end if;
    if jsonb_typeof(suggestion.value) <> 'object' then
      raise exception 'recording baseline suggestion must be an object'
        using errcode = '22023';
    end if;
    select array_agg(key order by key) into actual_suggestion_keys
    from jsonb_object_keys(suggestion.value) keys(key);
    if actual_suggestion_keys is distinct from array['confidence','evidence_summary','value']::text[] then
      raise exception 'recording baseline suggestion keys do not match the contract'
        using errcode = '22023';
    end if;
    if jsonb_typeof(suggestion.value -> 'confidence') <> 'number'
      or (suggestion.value ->> 'confidence')::numeric < 0
      or (suggestion.value ->> 'confidence')::numeric > 1 then
      raise exception 'recording baseline confidence must be between zero and one'
        using errcode = '22023';
    end if;
    suggestion_confidence := (suggestion.value ->> 'confidence')::numeric;
    if jsonb_typeof(suggestion.value -> 'evidence_summary') <> 'string'
      or length(trim(suggestion.value ->> 'evidence_summary')) not between 1 and 1000 then
      raise exception 'recording baseline evidence summary is required'
        using errcode = '22023';
    end if;
    evidence_summary := trim(suggestion.value ->> 'evidence_summary');
    if not (
      (
        interaction_row.summary is not null
        and position(
          lower(regexp_replace(trim(evidence_summary), '\s+', ' ', 'g'))
          in lower(regexp_replace(trim(interaction_row.summary), '\s+', ' ', 'g'))
        ) > 0
      )
      or exists (
        select 1
        from public.recording_followups resolved
        where resolved.tenant_id = job_row.tenant_id
          and resolved.transcript_id = transcript_row.id
          and resolved.contact_id = contact_row.id
          and resolved.status in ('routed', 'completed')
          and position(
            lower(regexp_replace(trim(evidence_summary), '\s+', ' ', 'g'))
            in lower(regexp_replace(trim(resolved.followup_text), '\s+', ' ', 'g'))
          ) > 0
      )
    ) then
      raise exception 'recording baseline evidence must be a literal owner-confirmed meeting excerpt'
        using errcode = '22023';
    end if;
    suggestion_value := suggestion.value -> 'value';
    if not app_private.recording_baseline_value_is_valid(
      suggestion.key, policy_row.value_kind, suggestion_value, policy_row.max_length
    ) then
      raise exception 'recording baseline value is invalid for field: %', suggestion.key
        using errcode = '22023';
    end if;

    execute format(
      'select to_jsonb(%I) from public.contacts where tenant_id = $1 and id = $2',
      suggestion.key
    ) into current_value using job_row.tenant_id, contact_row.id;
    current_normalized := app_private.normalize_recording_baseline_value(
      suggestion.key, policy_row.value_kind, current_value
    );
    suggested_normalized := app_private.normalize_recording_baseline_value(
      suggestion.key, policy_row.value_kind, suggestion_value
    );

    if current_value is null then
      if suggestion_confidence < 0.90 then
        skipped_low_confidence_count := skipped_low_confidence_count + 1;
        continue;
      end if;
      if policy_row.value_kind = 'text' then
        execute format(
          'update public.contacts set %I = $1 where tenant_id = $2 and id = $3 and %I is null',
          suggestion.key, suggestion.key
        ) using trim(suggestion_value #>> '{}'), job_row.tenant_id, contact_row.id;
      elsif policy_row.value_kind = 'text_array' then
        execute format(
          'update public.contacts set %I = array(select trim(value) from jsonb_array_elements_text($1) values_(value)) where tenant_id = $2 and id = $3 and %I is null',
          suggestion.key, suggestion.key
        ) using suggestion_value, job_row.tenant_id, contact_row.id;
      elsif policy_row.value_kind = 'date' then
        execute format(
          'update public.contacts set %I = ($1 #>> ''{}'')::date where tenant_id = $2 and id = $3 and %I is null',
          suggestion.key, suggestion.key
        ) using suggestion_value, job_row.tenant_id, contact_row.id;
      end if;
      if not found then
        raise exception 'recording baseline field changed during finalize'
          using errcode = '40001';
      end if;

      insert into public.field_provenance (
        tenant_id, table_name, record_id, field_name, source_type,
        source_ref, summary, confidence, metadata
      ) values (
        job_row.tenant_id, 'contacts', contact_row.id, suggestion.key, 'transcript',
        left(coalesce(transcript_row.source_ref, transcript_row.id::text), 500),
        evidence_summary, suggestion_confidence,
        jsonb_build_object(
          'job_id', job_row.id,
          'transcript_id', transcript_row.id,
          'interaction_id', interaction_row.id,
          'transcript_sha256', transcript_row.transcript_sha256,
          'provider', transcript_row.source,
          'meeting_occurred_at', coalesce(transcript_row.occurred_at, transcript_row.created_at),
          'previous_value', null,
          'applied_value', suggestion_value,
          'evidence_sha256', encode(extensions.digest(evidence_summary, 'sha256'), 'hex'),
          'prompt_version', p_prompt_version,
          'gateway_generation_id', p_gateway_generation_id,
          'is_first_confirmed_meeting', first_confirmed_meeting,
          'approved_by_policy', 'sql_null_high_confidence'
        )
      );
      auto_filled_count := auto_filled_count + 1;
      auto_filled_fields := auto_filled_fields || to_jsonb(suggestion.key);
    elsif current_normalized is not distinct from suggested_normalized then
      unchanged_count := unchanged_count + 1;
    else
      pending_change_id := null;
      insert into public.pending_changes (
        tenant_id, contact_id, change_type, summary, payload, status,
        risk_level, source, proposed_by, idempotency_key
      ) values (
        job_row.tenant_id,
        contact_row.id,
        'field_update',
        left('Meeting evidence suggests an update to ' || replace(suggestion.key, '_', ' ') || '.', 500),
        jsonb_build_object(
          'fields', jsonb_build_object(suggestion.key, suggestion_value),
          'field', suggestion.key,
          'proposed_value', suggestion_value,
          'expected_current_value', current_value,
          'confidence', suggestion_confidence,
          'source_ref', coalesce(transcript_row.source_ref, transcript_row.id::text),
          'evidence', jsonb_build_object(
            'meeting_title', transcript_row.title,
            'meeting_occurred_at', coalesce(transcript_row.occurred_at, transcript_row.created_at),
            'transcript_id', transcript_row.id,
            'interaction_id', interaction_row.id,
            'transcript_sha256', transcript_row.transcript_sha256,
            'provider', transcript_row.source,
            'evidence_summary', evidence_summary
          ),
          'baseline', jsonb_build_object(
            'job_id', job_row.id,
            'prompt_version', p_prompt_version,
            'gateway_generation_id', p_gateway_generation_id,
            'contact_updated_at_at_claim', job_row.contact_updated_at_at_claim,
            'is_first_confirmed_meeting', first_confirmed_meeting
          )
        ),
        'pending',
        case when suggestion.key = 'ideal_referral' then 'high' else 'low' end,
        'recording_baseline',
        'claude',
        left('recording-baseline-conflict:' || job_row.id::text || ':' || suggestion.key, 240)
      )
      on conflict (tenant_id, idempotency_key)
        where idempotency_key is not null
      do nothing
      returning id into pending_change_id;

      if pending_change_id is null then
        select id into pending_change_id
        from public.pending_changes
        where tenant_id = job_row.tenant_id
          and idempotency_key = left(
            'recording-baseline-conflict:' || job_row.id::text || ':' || suggestion.key,
            240
          )
        for update;
      else
        insert into public.audit_log (
          tenant_id, actor_user_id, actor_type, action,
          table_name, record_id, metadata
        ) values (
          job_row.tenant_id, owner_user_id_value, 'system',
          'recording.baseline_contradiction_proposed',
          'pending_changes', pending_change_id,
          jsonb_build_object(
            'job_id', job_row.id,
            'transcript_id', transcript_row.id,
            'interaction_id', interaction_row.id,
            'contact_id', contact_row.id,
            'field_name', suggestion.key,
            'is_first_confirmed_meeting', first_confirmed_meeting
          )
        );
      end if;
      contradiction_count := contradiction_count + 1;
      pending_ids := pending_ids || jsonb_build_array(pending_change_id);
    end if;
  end loop;

  -- Capture the final contact version after this job's own NULL-only fills.
  -- Review uses field-level expected_current_value as its precise CAS; this
  -- timestamp is retained for diagnostics and provenance.
  update public.pending_changes proposed
  set payload = jsonb_set(
    proposed.payload,
    '{baseline,expected_contact_updated_at}',
    to_jsonb((
      select current_contact.updated_at
      from public.contacts current_contact
      where current_contact.tenant_id = job_row.tenant_id
        and current_contact.id = contact_row.id
    )),
    true
  )
  where proposed.tenant_id = job_row.tenant_id
    and proposed.status = 'pending'
    and proposed.source = 'recording_baseline'
    and proposed.payload -> 'baseline' ->> 'job_id' = job_row.id::text;

  result_payload := jsonb_build_object(
    'job_id', job_row.id,
    'status', 'succeeded',
    'outcome', 'applied',
    'auto_filled_count', auto_filled_count,
    'contradiction_count', contradiction_count,
    'unchanged_count', unchanged_count,
    'skipped_low_confidence_count', skipped_low_confidence_count,
    'auto_filled_fields', auto_filled_fields,
    'contradiction_change_ids', pending_ids,
    'prompt_version', p_prompt_version,
    'gateway_generation_id', p_gateway_generation_id,
    'suggestions_hash', suggestions_hash,
    'is_first_confirmed_meeting', first_confirmed_meeting,
    'duplicate', false
  );

  update public.jobs
  set status = 'succeeded',
    result = result_payload,
    locked_at = null,
    lease_expires_at = null,
    last_error = null
  where id = job_row.id;

  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action,
    table_name, record_id, metadata
  ) values (
    job_row.tenant_id, owner_user_id_value, 'system',
    'recording.baseline_applied', 'jobs', job_row.id,
    jsonb_build_object(
      'transcript_id', transcript_row.id,
      'interaction_id', interaction_row.id,
      'contact_id', contact_row.id,
      'auto_filled_count', auto_filled_count,
      'contradiction_count', contradiction_count,
      'unchanged_count', unchanged_count,
      'skipped_low_confidence_count', skipped_low_confidence_count,
      'is_first_confirmed_meeting', first_confirmed_meeting,
      'prompt_version', p_prompt_version,
      'gateway_generation_id', p_gateway_generation_id
    )
  );

  return result_payload;
end;
$$;

revoke all on function public.lbb_apply_recording_baseline(uuid,uuid,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.lbb_apply_recording_baseline(uuid,uuid,text,text,jsonb)
  to service_role;

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
  interaction_row public.interactions%rowtype;
  created_interaction_id uuid;
  contact_id_value uuid;
  confirmed_ids uuid[] := '{}'::uuid[];
  existing_ids uuid[] := '{}'::uuid[];
  enqueue_result jsonb;
  exact_duplicate boolean := false;
  cancelled_job_id uuid;
begin
  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id = p_tenant_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and member.role = 'owner'
  ) then
    raise exception 'recording owner access required' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct requested_id order by requested_id), '{}'::uuid[])
  into confirmed_ids
  from unnest(coalesce(p_contact_ids, '{}'::uuid[])) requested(requested_id)
  where requested_id is not null;
  if cardinality(confirmed_ids) = 0 then
    raise exception 'at least one explicit confirmed meeting contact is required'
      using errcode = '22023';
  end if;
  if cardinality(confirmed_ids) > 25 then
    raise exception 'too many confirmed meeting contacts' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(confirmed_ids) requested_id
    where not exists (
      select 1 from public.contacts contact
      where contact.tenant_id = p_tenant_id
        and contact.id = requested_id
        and contact.archived_at is null
    )
  ) then
    raise exception 'confirmed meeting contacts must be active and belong to the tenant'
      using errcode = '22023';
  end if;

  select * into transcript_row
  from public.transcripts
  where tenant_id = p_tenant_id
    and id = p_transcript_id
    and owner_user_id = p_actor_user_id
  for update;
  if not found then
    raise exception 'meeting artifact not found' using errcode = '22023';
  end if;
  if transcript_row.processing_status not in ('review', 'ready')
    or transcript_row.source not in ('fireflies', 'fathom', 'google_meet', 'notion')
    or nullif(trim(coalesce(transcript_row.distilled_summary, '')), '') is null then
    raise exception 'meeting artifact is not ready for confirmation' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.recording_followups followup
    where followup.tenant_id = p_tenant_id
      and followup.transcript_id = p_transcript_id
      and followup.status in ('proposed', 'pending')
  ) then
    raise exception 'decide every proposed follow-up before confirming the meeting'
      using errcode = '22023';
  end if;

  if transcript_row.processing_status = 'review' then
    insert into public.interactions (
      tenant_id, occurred_at, interaction_type, title, summary, source,
      source_ref, metadata, idempotency_key
    ) values (
      p_tenant_id, coalesce(transcript_row.occurred_at, transcript_row.created_at),
      'meeting', left(coalesce(transcript_row.title, 'Recorded meeting'), 240),
      left(transcript_row.distilled_summary, 8000), transcript_row.source,
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
    )
    on conflict (tenant_id, idempotency_key)
      where idempotency_key is not null
    do nothing
    returning id into created_interaction_id;

    if created_interaction_id is null then
      select id into created_interaction_id
      from public.interactions
      where tenant_id = p_tenant_id
        and idempotency_key = left('recording-confirmed:' || transcript_row.id::text, 160)
      for update;
    end if;
  else
    created_interaction_id := transcript_row.interaction_id;
  end if;

  select * into interaction_row
  from public.interactions
  where tenant_id = p_tenant_id
    and id = created_interaction_id
    and interaction_type = 'meeting'
    and metadata ->> 'transcript_id' = transcript_row.id::text
  for update;
  if not found then
    raise exception 'meeting interaction does not match the transcript'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(link.contact_id order by link.contact_id), '{}'::uuid[])
  into existing_ids
  from public.interaction_contacts link
  where link.tenant_id = p_tenant_id
    and link.interaction_id = created_interaction_id;
  exact_duplicate := transcript_row.processing_status = 'ready'
    and existing_ids = confirmed_ids
    and transcript_row.metadata -> 'confirmed_contact_ids' = to_jsonb(confirmed_ids);

  foreach contact_id_value in array existing_ids loop
    if not (contact_id_value = any(confirmed_ids)) then
      cancelled_job_id := null;
      update public.jobs
      set status = 'cancelled',
        result = jsonb_build_object(
          'outcome', 'cancelled',
          'error_kind', 'conflict',
          'error_code', 'meeting_contact_unconfirmed'
        ),
        locked_at = null,
        lock_token = null,
        lease_expires_at = null,
        contact_updated_at_at_claim = null,
        last_error = 'meeting contact was removed by the owner'
      where tenant_id = p_tenant_id
        and job_type = 'recording_baseline'
        and payload ->> 'transcript_id' = transcript_row.id::text
        and payload ->> 'contact_id' = contact_id_value::text
        and status in ('queued', 'running')
      returning id into cancelled_job_id;
      if cancelled_job_id is not null then
        insert into public.audit_log (
          tenant_id, actor_user_id, actor_type, action,
          table_name, record_id, metadata
        ) values (
          p_tenant_id, p_actor_user_id, 'client',
          'recording.baseline_cancelled_contact_removed',
          'jobs', cancelled_job_id,
          jsonb_build_object(
            'transcript_id', transcript_row.id,
            'contact_id', contact_id_value
          )
        );
      end if;
    end if;
  end loop;

  delete from public.interaction_contacts link
  where link.tenant_id = p_tenant_id
    and link.interaction_id = created_interaction_id
    and not (link.contact_id = any(confirmed_ids));
  foreach contact_id_value in array confirmed_ids loop
    insert into public.interaction_contacts (tenant_id, interaction_id, contact_id, role)
    values (p_tenant_id, created_interaction_id, contact_id_value, 'participant')
    on conflict (interaction_id, contact_id) do update set
      tenant_id = excluded.tenant_id,
      role = excluded.role;
  end loop;

  update public.transcripts
  set interaction_id = created_interaction_id,
    processing_status = 'ready',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'evidence_grade', 'owner_confirmed',
      'confirmed_by', p_actor_user_id,
      'confirmed_at', coalesce(metadata -> 'confirmed_at', to_jsonb(now())),
      'confirmed_contact_ids', to_jsonb(confirmed_ids),
      'contacts_confirmed_at', now(),
      'contacts_confirmed_by', p_actor_user_id
    ),
    updated_at = case when exact_duplicate then updated_at else now() end
  where tenant_id = p_tenant_id and id = transcript_row.id;

  if not exact_duplicate then
    insert into public.audit_log (
      tenant_id, actor_user_id, actor_type, action,
      table_name, record_id, before, after, metadata
    ) values (
      p_tenant_id, p_actor_user_id, 'client',
      case when transcript_row.processing_status = 'review'
        then 'recording.artifact_confirmed'
        else 'recording.meeting_contacts_confirmed' end,
      'transcripts', transcript_row.id,
      jsonb_build_object('confirmed_contact_ids', to_jsonb(existing_ids)),
      jsonb_build_object('confirmed_contact_ids', to_jsonb(confirmed_ids)),
      jsonb_build_object(
        'interaction_id', created_interaction_id,
        'contact_count', cardinality(confirmed_ids)
      )
    );
  end if;

  enqueue_result := public.lbb_enqueue_recording_baseline(
    p_tenant_id, transcript_row.id, p_actor_user_id
  );
  return jsonb_build_object(
    'id', transcript_row.id,
    'transcript_id', transcript_row.id,
    'interaction_id', created_interaction_id,
    'confirmed_contact_ids', to_jsonb(confirmed_ids),
    'enqueued_count', coalesce((enqueue_result ->> 'enqueued_count')::integer, 0),
    'duplicate', exact_duplicate
  );
end;
$$;

revoke all on function public.lbb_accept_meeting_artifact(uuid,uuid,uuid,uuid[])
  from public, anon, authenticated;
grant execute on function public.lbb_accept_meeting_artifact(uuid,uuid,uuid,uuid[])
  to service_role;

create or replace function public.lbb_confirm_meeting_contacts(
  p_tenant_id uuid,
  p_transcript_id uuid,
  p_actor_user_id uuid,
  p_contact_ids uuid[],
  p_expected_transcript_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  transcript_row public.transcripts%rowtype;
  requested_ids uuid[] := '{}'::uuid[];
  stored_ids uuid[] := '{}'::uuid[];
  accepted jsonb;
begin
  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id = p_tenant_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and member.role = 'owner'
  ) then
    raise exception 'active recording owner access required' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct requested_id order by requested_id), '{}'::uuid[])
  into requested_ids
  from unnest(coalesce(p_contact_ids, '{}'::uuid[])) requested(requested_id)
  where requested_id is not null;
  if cardinality(requested_ids) = 0 then
    raise exception 'at least one explicit confirmed meeting contact is required'
      using errcode = '22023';
  end if;
  if cardinality(requested_ids) > 25
    or exists (
      select 1 from unnest(requested_ids) requested_id
      where not exists (
        select 1 from public.contacts contact
        where contact.tenant_id = p_tenant_id
          and contact.id = requested_id
          and contact.archived_at is null
      )
    ) then
    raise exception 'meeting contacts must be active and belong to the tenant'
      using errcode = '22023';
  end if;

  select * into transcript_row
  from public.transcripts
  where tenant_id = p_tenant_id
    and id = p_transcript_id
    and owner_user_id = p_actor_user_id
  for update;
  if not found then
    raise exception 'owned meeting artifact not found' using errcode = '42501';
  end if;
  if transcript_row.processing_status not in ('review', 'ready') then
    raise exception 'meeting artifact is not available for participant confirmation'
      using errcode = '22023';
  end if;
  select coalesce(array_agg(value::uuid order by value::uuid), '{}'::uuid[])
  into stored_ids
  from jsonb_array_elements_text(
    case when jsonb_typeof(transcript_row.metadata -> 'confirmed_contact_ids') = 'array'
      then transcript_row.metadata -> 'confirmed_contact_ids' else '[]'::jsonb end
  ) ids(value)
  where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  if stored_ids is distinct from requested_ids
    and p_expected_transcript_updated_at is not null
    and transcript_row.updated_at is distinct from p_expected_transcript_updated_at then
    raise exception 'meeting participants changed after the page loaded'
      using errcode = '40001';
  end if;

  if transcript_row.processing_status = 'review'
    and exists (
      select 1 from public.recording_followups unresolved
      where unresolved.tenant_id = p_tenant_id
        and unresolved.transcript_id = p_transcript_id
        and unresolved.status in ('proposed', 'pending')
    ) then
    if stored_ids = requested_ids then
      return jsonb_build_object(
        'transcript_id', p_transcript_id,
        'interaction_id', transcript_row.interaction_id,
        'confirmed_contact_ids', to_jsonb(requested_ids),
        'processing_status', 'review',
        'enqueued_count', 0,
        'duplicate', true
      );
    end if;
    update public.transcripts
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'confirmed_contact_ids', to_jsonb(requested_ids),
        'contacts_confirmed_at', now(),
        'contacts_confirmed_by', p_actor_user_id
      ),
      updated_at = now()
    where tenant_id = p_tenant_id and id = p_transcript_id;
    insert into public.audit_log (
      tenant_id, actor_user_id, actor_type, action,
      table_name, record_id, before, after, metadata
    ) values (
      p_tenant_id, p_actor_user_id, 'client',
      'recording.meeting_contacts_staged', 'transcripts', p_transcript_id,
      jsonb_build_object('confirmed_contact_ids', to_jsonb(stored_ids)),
      jsonb_build_object('confirmed_contact_ids', to_jsonb(requested_ids)),
      jsonb_build_object('contact_count', cardinality(requested_ids))
    );
    return jsonb_build_object(
      'transcript_id', p_transcript_id,
      'interaction_id', transcript_row.interaction_id,
      'confirmed_contact_ids', to_jsonb(requested_ids),
      'processing_status', 'review',
      'enqueued_count', 0,
      'duplicate', false
    );
  end if;

  accepted := public.lbb_accept_meeting_artifact(
    p_tenant_id, p_transcript_id, p_actor_user_id, requested_ids
  );
  return jsonb_build_object(
    'transcript_id', p_transcript_id,
    'interaction_id', accepted -> 'interaction_id',
    'confirmed_contact_ids', accepted -> 'confirmed_contact_ids',
    'processing_status', 'ready',
    'enqueued_count', coalesce((accepted ->> 'enqueued_count')::integer, 0),
    'duplicate', coalesce((accepted ->> 'duplicate')::boolean, false)
  );
end;
$$;

revoke all on function public.lbb_confirm_meeting_contacts(uuid,uuid,uuid,uuid[],timestamptz)
  from public, anon, authenticated;
grant execute on function public.lbb_confirm_meeting_contacts(uuid,uuid,uuid,uuid[],timestamptz)
  to service_role;

-- New callers pass the meeting participant set independently of the selected
-- follow-up's assignee. The legacy eight-argument signature remains below.
create or replace function public.lbb_decide_recording_followup(
  p_tenant_id uuid,
  p_followup_id uuid,
  p_actor_user_id uuid,
  p_classification text,
  p_outcome text,
  p_contact_id uuid,
  p_due_on date,
  p_note text,
  p_meeting_contact_ids uuid[]
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
  persisted_route text;
  persisted_classification text;
  next_status text;
  normalized_outcome text := case
    when p_outcome = 'keep_open' then 'approve'
    when p_outcome = 'not_followup' then 'decline'
    else p_outcome
  end;
  clean_note text := nullif(left(trim(coalesce(p_note, '')), 1000), '');
  acceptance_result jsonb;
  created_interaction_id uuid;
  meeting_contact_ids uuid[] := '{}'::uuid[];
  explicit_contact_ids uuid[] := '{}'::uuid[];
  meeting_processed boolean := false;
begin
  if normalized_outcome = 'approve'
    and (p_classification is null or p_classification not in ('action', 'owner_promise', 'contact_promise')) then
    raise exception 'unsupported recording follow-up classification' using errcode = '22023';
  end if;
  if normalized_outcome is null or normalized_outcome not in ('approve', 'already_done', 'decline') then
    raise exception 'unsupported recording follow-up outcome' using errcode = '22023';
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

  select coalesce(array_agg(distinct contact_id order by contact_id), '{}'::uuid[])
  into explicit_contact_ids
  from unnest(coalesce(p_meeting_contact_ids, '{}'::uuid[])) requested(contact_id)
  where contact_id is not null;
  if cardinality(explicit_contact_ids) > 25
    or exists (
      select 1 from unnest(explicit_contact_ids) requested_id
      where not exists (
        select 1 from public.contacts contact
        where contact.tenant_id = p_tenant_id
          and contact.id = requested_id
          and contact.archived_at is null
      )
    ) then
    raise exception 'meeting contacts must be active and belong to the tenant'
      using errcode = '22023';
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

  persisted_route := case
    when normalized_outcome = 'already_done' then 'already_done'
    when normalized_outcome = 'decline' then 'dismiss'
    else p_classification
  end;
  persisted_classification := case when normalized_outcome = 'approve' then p_classification else null end;
  next_status := case
    when normalized_outcome = 'already_done' then 'completed'
    when normalized_outcome = 'decline' then 'dismissed'
    else 'routed'
  end;

  if followup_row.status not in ('proposed', 'pending') then
    if followup_row.status = next_status
      and followup_row.route = persisted_route
      and followup_row.contact_id is not distinct from (
        case when normalized_outcome = 'decline' then null else p_contact_id end
      )
      and followup_row.due_on is not distinct from (
        case when normalized_outcome = 'approve' then p_due_on else null end
      )
      and followup_row.resolution_note is not distinct from clean_note
      and nullif(followup_row.metadata->>'classification', '') is not distinct from persisted_classification then
      if not exists (
          select 1 from public.recording_followups unresolved
          where unresolved.tenant_id = p_tenant_id
            and unresolved.transcript_id = followup_row.transcript_id
            and unresolved.status in ('proposed', 'pending')
        ) then
        if cardinality(explicit_contact_ids) > 0 then
          meeting_contact_ids := explicit_contact_ids;
        else
          select coalesce(array_agg(distinct candidate.contact_id order by candidate.contact_id), '{}'::uuid[])
          into meeting_contact_ids
          from (
            select decided.contact_id
            from public.recording_followups decided
            where decided.tenant_id = p_tenant_id
              and decided.transcript_id = followup_row.transcript_id
              and decided.contact_id is not null
            union
            select stored.value::uuid
            from jsonb_array_elements_text(
              case when jsonb_typeof(transcript_row.metadata -> 'confirmed_contact_ids') = 'array'
                then transcript_row.metadata -> 'confirmed_contact_ids' else '[]'::jsonb end
            ) stored(value)
            where stored.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            union
            select attendee.matched_contact_id
            from public.calendar_attendees attendee
            where attendee.tenant_id = p_tenant_id
              and attendee.owner_user_id = p_actor_user_id
              and attendee.matched_contact_id is not null
              and transcript_row.metadata ->> 'calendar_match_event_id'
                ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              and attendee.event_id = (transcript_row.metadata ->> 'calendar_match_event_id')::uuid
          ) candidate
          join public.contacts contact
            on contact.tenant_id = p_tenant_id
            and contact.id = candidate.contact_id
            and contact.archived_at is null;
        end if;
        if cardinality(meeting_contact_ids) = 0 then
          raise exception 'confirm at least one meeting contact before finalizing'
            using errcode = '22023';
        end if;
        acceptance_result := public.lbb_accept_meeting_artifact(
          p_tenant_id, followup_row.transcript_id, p_actor_user_id, meeting_contact_ids
        );
        meeting_processed := true;
      end if;
      return jsonb_build_object(
        'followup_id', followup_row.id,
        'outcome', normalized_outcome,
        'classification', persisted_classification,
        'route', followup_row.route,
        'status', followup_row.status,
        'target_table', followup_row.target_table,
        'target_id', followup_row.target_id,
        'meeting_processed', meeting_processed or transcript_row.processing_status = 'ready',
        'confirmed_contact_ids', coalesce(acceptance_result -> 'confirmed_contact_ids', transcript_row.metadata -> 'confirmed_contact_ids', '[]'::jsonb),
        'duplicate', true
      );
    end if;
    raise exception 'recording follow-up was already resolved' using errcode = '40001';
  end if;
  if transcript_row.processing_status not in ('review', 'ready') then
    raise exception 'meeting artifact is not available for decisions' using errcode = '22023';
  end if;
  if normalized_outcome = 'approve' and p_contact_id is null then
    raise exception 'an active contact is required for this promise' using errcode = '22023';
  end if;
  if p_contact_id is not null and not exists (
    select 1 from public.contacts
    where tenant_id = p_tenant_id and id = p_contact_id and archived_at is null
  ) then
    raise exception 'active contact not found in tenant' using errcode = '22023';
  end if;

  if normalized_outcome = 'approve' and p_classification = 'action' then
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
      ), p_actor_user_id
    ) returning id into created_target_id;
    created_target_table := 'relationship_actions';
  elsif normalized_outcome = 'approve' and p_classification in ('owner_promise', 'contact_promise') then
    insert into public.promises (
      tenant_id, contact_id, interaction_id, direction, promise_text,
      status, due_on, source, evidence
    ) values (
      p_tenant_id, p_contact_id, transcript_row.interaction_id,
      case when p_classification = 'owner_promise' then 'owner_owes_contact' else 'contact_owes_owner' end,
      followup_row.followup_text, 'open', p_due_on, 'recording_followup',
      jsonb_build_object(
        'recording_followup_id', followup_row.id,
        'transcript_id', followup_row.transcript_id,
        'provider', transcript_row.source,
        'owner_approved', true
      )
    ) returning id into created_target_id;
    created_target_table := 'promises';
  end if;

  update public.recording_followups
  set status = next_status,
    route = persisted_route,
    contact_id = case when normalized_outcome = 'decline' then null else p_contact_id end,
    due_on = case when normalized_outcome = 'approve' then p_due_on else null end,
    resolution_note = clean_note,
    target_table = created_target_table,
    target_id = created_target_id,
    resolved_by = p_actor_user_id,
    resolved_at = now(),
    metadata = metadata || jsonb_build_object(
      'review_decision', normalized_outcome,
      'decided_by_owner', true,
      'resolution_outcome', normalized_outcome,
      'classification', persisted_classification
    )
  where id = followup_row.id;

  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action,
    table_name, record_id, before, after, metadata
  ) values (
    p_tenant_id, p_actor_user_id, 'client',
    'recording.followup_' || normalized_outcome,
    'recording_followups', followup_row.id,
    jsonb_build_object('status', followup_row.status),
    jsonb_build_object(
      'status', next_status, 'route', persisted_route,
      'target_table', created_target_table, 'target_id', created_target_id
    ),
    jsonb_build_object(
      'transcript_id', followup_row.transcript_id,
      'contact_id', case when normalized_outcome = 'decline' then null else p_contact_id end,
      'classification', persisted_classification,
      'outcome', normalized_outcome,
      'provider', transcript_row.source
    )
  );

  if not exists (
    select 1 from public.recording_followups unresolved
    where unresolved.tenant_id = p_tenant_id
      and unresolved.transcript_id = followup_row.transcript_id
      and unresolved.status in ('proposed', 'pending')
  ) then
    if cardinality(explicit_contact_ids) > 0 then
      meeting_contact_ids := explicit_contact_ids;
    else
      select coalesce(array_agg(distinct candidate.contact_id order by candidate.contact_id), '{}'::uuid[])
      into meeting_contact_ids
      from (
        select decided.contact_id
        from public.recording_followups decided
        where decided.tenant_id = p_tenant_id
          and decided.transcript_id = followup_row.transcript_id
          and decided.contact_id is not null
        union
        select stored.value::uuid
        from jsonb_array_elements_text(
          case when jsonb_typeof(transcript_row.metadata -> 'confirmed_contact_ids') = 'array'
            then transcript_row.metadata -> 'confirmed_contact_ids' else '[]'::jsonb end
        ) stored(value)
        where stored.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        union
        select attendee.matched_contact_id
        from public.calendar_attendees attendee
        where attendee.tenant_id = p_tenant_id
          and attendee.owner_user_id = p_actor_user_id
          and attendee.matched_contact_id is not null
          and transcript_row.metadata ->> 'calendar_match_event_id'
            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and attendee.event_id = (transcript_row.metadata ->> 'calendar_match_event_id')::uuid
      ) candidate
      join public.contacts contact
        on contact.tenant_id = p_tenant_id
        and contact.id = candidate.contact_id
        and contact.archived_at is null
      ;
    end if;

    if cardinality(meeting_contact_ids) = 0 then
      raise exception 'confirm at least one meeting contact before finalizing'
        using errcode = '22023';
    end if;
    acceptance_result := public.lbb_accept_meeting_artifact(
      p_tenant_id, followup_row.transcript_id, p_actor_user_id, meeting_contact_ids
    );
    created_interaction_id := nullif(acceptance_result ->> 'interaction_id', '')::uuid;
    if created_interaction_id is not null then
      update public.promises promise
      set interaction_id = created_interaction_id
      where promise.tenant_id = p_tenant_id
        and promise.interaction_id is null
        and promise.id in (
          select decided.target_id
          from public.recording_followups decided
          where decided.tenant_id = p_tenant_id
            and decided.transcript_id = followup_row.transcript_id
            and decided.target_table = 'promises'
            and decided.target_id is not null
        );
    end if;
    meeting_processed := true;
  end if;

  return jsonb_build_object(
    'followup_id', followup_row.id,
    'outcome', normalized_outcome,
    'classification', persisted_classification,
    'route', persisted_route,
    'status', next_status,
    'target_table', created_target_table,
    'target_id', created_target_id,
    'meeting_processed', meeting_processed,
    'confirmed_contact_ids', coalesce(acceptance_result -> 'confirmed_contact_ids', '[]'::jsonb),
    'duplicate', false
  );
end;
$$;

revoke all on function public.lbb_decide_recording_followup(
  uuid,uuid,uuid,text,text,uuid,date,text,uuid[]
) from public, anon, authenticated;
grant execute on function public.lbb_decide_recording_followup(
  uuid,uuid,uuid,text,text,uuid,date,text,uuid[]
) to service_role;

create or replace function public.lbb_decide_recording_followup(
  p_tenant_id uuid,
  p_followup_id uuid,
  p_actor_user_id uuid,
  p_classification text,
  p_outcome text,
  p_contact_id uuid default null,
  p_due_on date default null,
  p_note text default null
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select public.lbb_decide_recording_followup(
    p_tenant_id, p_followup_id, p_actor_user_id, p_classification, p_outcome,
    p_contact_id, p_due_on, p_note, null::uuid[]
  );
$$;

revoke all on function public.lbb_decide_recording_followup(
  uuid,uuid,uuid,text,text,uuid,date,text
) from public, anon, authenticated;
grant execute on function public.lbb_decide_recording_followup(
  uuid,uuid,uuid,text,text,uuid,date,text
) to service_role;

create or replace function public.lbb_review_recording_baseline_change(
  p_tenant_id uuid,
  p_change_id uuid,
  p_actor_user_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  change_row public.pending_changes%rowtype;
  contact_row public.contacts%rowtype;
  baseline_job public.jobs%rowtype;
  policy_row app_private.recording_baseline_field_policy%rowtype;
  field_name_value text;
  proposed_value jsonb;
  expected_current_value jsonb;
  current_value jsonb;
  evidence_payload jsonb;
  baseline_job_id uuid;
  evidence_transcript_id uuid;
  evidence_interaction_id uuid;
  updated_contact_at timestamptz;
  exact_duplicate boolean := false;
begin
  if p_decision is null or p_decision not in ('approve', 'dismiss') then
    raise exception 'recording baseline review decision must be approve or dismiss'
      using errcode = '22023';
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

  select * into change_row
  from public.pending_changes
  where tenant_id = p_tenant_id and id = p_change_id
  for update;
  if not found
    or change_row.source <> 'recording_baseline'
    or change_row.change_type <> 'field_update'
    or change_row.contact_id is null then
    raise exception 'recording baseline change not found' using errcode = '22023';
  end if;
  exact_duplicate := change_row.status = case
    when p_decision = 'approve' then 'approved' else 'dismissed' end;
  if change_row.superseded_at is not null
    or change_row.replaced_by_pending_change_id is not null
    or (not exact_duplicate and change_row.status <> 'pending') then
    raise exception 'recording baseline change was already resolved or superseded'
      using errcode = '40001';
  end if;
  if jsonb_typeof(change_row.payload -> 'fields') <> 'object'
    or (select count(*) from jsonb_object_keys(change_row.payload -> 'fields')) <> 1
    or jsonb_typeof(change_row.payload -> 'field') <> 'string'
    or not (change_row.payload ? 'expected_current_value')
    or jsonb_typeof(change_row.payload -> 'baseline') <> 'object'
    or jsonb_typeof(change_row.payload -> 'baseline' -> 'job_id') <> 'string'
    or coalesce(change_row.payload -> 'baseline' ->> 'job_id', '')
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(change_row.payload -> 'evidence') <> 'object'
    or jsonb_typeof(change_row.payload -> 'evidence' -> 'transcript_id') <> 'string'
    or coalesce(change_row.payload -> 'evidence' ->> 'transcript_id', '')
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(change_row.payload -> 'evidence' -> 'interaction_id') <> 'string'
    or coalesce(change_row.payload -> 'evidence' ->> 'interaction_id', '')
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'recording baseline change payload is invalid' using errcode = '22023';
  end if;

  baseline_job_id := (change_row.payload -> 'baseline' ->> 'job_id')::uuid;
  evidence_payload := change_row.payload -> 'evidence';
  evidence_transcript_id := (evidence_payload ->> 'transcript_id')::uuid;
  evidence_interaction_id := (evidence_payload ->> 'interaction_id')::uuid;

  select * into baseline_job
  from public.jobs job
  where job.tenant_id = p_tenant_id
    and job.id = baseline_job_id
    and job.job_type = 'recording_baseline'
    and job.status = 'succeeded'
    and job.payload ->> 'contact_id' = change_row.contact_id::text
    and job.payload ->> 'transcript_id' = evidence_transcript_id::text
    and job.payload ->> 'interaction_id' = evidence_interaction_id::text
    and jsonb_typeof(job.result -> 'contradiction_change_ids') = 'array'
    and job.result -> 'contradiction_change_ids' @> jsonb_build_array(change_row.id)
  for share;
  if not found then
    raise exception 'recording baseline change is not linked to its completed job'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.transcripts transcript
    join public.interactions interaction
      on interaction.tenant_id = transcript.tenant_id
      and interaction.id = transcript.interaction_id
      and interaction.interaction_type = 'meeting'
      and interaction.metadata ->> 'evidence_grade' = 'owner_confirmed'
      and interaction.metadata ->> 'transcript_id' = transcript.id::text
    join public.interaction_contacts link
      on link.tenant_id = transcript.tenant_id
      and link.interaction_id = interaction.id
      and link.contact_id = change_row.contact_id
    where transcript.tenant_id = p_tenant_id
      and transcript.id = evidence_transcript_id
      and transcript.interaction_id = evidence_interaction_id
      and transcript.processing_status = 'ready'
      and transcript.metadata ->> 'evidence_grade' = 'owner_confirmed'
      and coalesce(transcript.transcript_sha256, '')
        = coalesce(evidence_payload ->> 'transcript_sha256', '')
  ) then
    raise exception 'recording baseline evidence linkage is invalid'
      using errcode = '22023';
  end if;
  if exact_duplicate then
    return jsonb_build_object(
      'change_id', change_row.id,
      'contact_id', change_row.contact_id,
      'status', change_row.status,
      'duplicate', true
    );
  end if;

  field_name_value := change_row.payload ->> 'field';
  select * into policy_row
  from app_private.recording_baseline_field_policy policy
  where policy.field_name = field_name_value;
  if not found
    or not (change_row.payload -> 'fields' ? field_name_value)
    or change_row.payload -> 'fields' -> field_name_value
      is distinct from change_row.payload -> 'proposed_value' then
    raise exception 'recording baseline change field is not allowlisted'
      using errcode = '22023';
  end if;
  proposed_value := change_row.payload -> 'proposed_value';
  expected_current_value := change_row.payload -> 'expected_current_value';
  if not app_private.recording_baseline_value_is_valid(
    field_name_value, policy_row.value_kind, proposed_value, policy_row.max_length
  ) then
    raise exception 'recording baseline proposed value is invalid' using errcode = '22023';
  end if;

  select * into contact_row
  from public.contacts
  where tenant_id = p_tenant_id
    and id = change_row.contact_id
    and archived_at is null
  for update;
  if not found then
    raise exception 'active recording baseline contact not found' using errcode = '22023';
  end if;

  execute format(
    'select to_jsonb(%I) from public.contacts where tenant_id = $1 and id = $2',
    field_name_value
  ) into current_value using p_tenant_id, contact_row.id;

  if p_decision = 'approve' then
    if current_value is distinct from expected_current_value then
      raise exception 'contact field changed after this meeting proposal was created'
        using errcode = '40001';
    end if;
    if policy_row.value_kind = 'text' then
      execute format(
        'update public.contacts set %I = $1 where tenant_id = $2 and id = $3 and to_jsonb(%I) is not distinct from $4',
        field_name_value, field_name_value
      ) using trim(proposed_value #>> '{}'), p_tenant_id, contact_row.id, expected_current_value;
    elsif policy_row.value_kind = 'text_array' then
      execute format(
        'update public.contacts set %I = array(select trim(value) from jsonb_array_elements_text($1) values_(value)) where tenant_id = $2 and id = $3 and to_jsonb(%I) is not distinct from $4',
        field_name_value, field_name_value
      ) using proposed_value, p_tenant_id, contact_row.id, expected_current_value;
    elsif policy_row.value_kind = 'date' then
      execute format(
        'update public.contacts set %I = ($1 #>> ''{}'')::date where tenant_id = $2 and id = $3 and to_jsonb(%I) is not distinct from $4',
        field_name_value, field_name_value
      ) using proposed_value, p_tenant_id, contact_row.id, expected_current_value;
    end if;
    if not found then
      raise exception 'contact field changed during meeting proposal approval'
        using errcode = '40001';
    end if;

    select updated_at into updated_contact_at
    from public.contacts
    where tenant_id = p_tenant_id and id = contact_row.id;
    insert into public.field_provenance (
      tenant_id, table_name, record_id, field_name, source_type,
      source_ref, summary, confidence, metadata
    ) values (
      p_tenant_id, 'contacts', contact_row.id, field_name_value, 'transcript',
      left(coalesce(change_row.payload ->> 'source_ref', p_change_id::text), 500),
      nullif(left(trim(coalesce(evidence_payload ->> 'evidence_summary', '')), 1000), ''),
      case when jsonb_typeof(change_row.payload -> 'confidence') = 'number'
        then (change_row.payload ->> 'confidence')::numeric else null end,
      jsonb_build_object(
        'pending_change_id', change_row.id,
        'approved_by', p_actor_user_id,
        'expected_current_value', expected_current_value,
        'applied_value', proposed_value,
        'contact_updated_at', updated_contact_at,
        'evidence', evidence_payload,
        'baseline', change_row.payload -> 'baseline'
      )
    );
  end if;

  update public.pending_changes
  set status = case when p_decision = 'approve' then 'approved' else 'dismissed' end,
    reviewed_by = p_actor_user_id,
    reviewed_at = now()
  where tenant_id = p_tenant_id
    and id = change_row.id
    and status = 'pending';
  if not found then
    raise exception 'recording baseline change changed during review'
      using errcode = '40001';
  end if;

  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action,
    table_name, record_id, before, after, metadata
  ) values (
    p_tenant_id, p_actor_user_id, 'client',
    'recording.baseline_change_' || case when p_decision = 'approve' then 'approved' else 'dismissed' end,
    'pending_changes', change_row.id,
    jsonb_build_object(
      'status', change_row.status,
      'field', field_name_value,
      'current_value', current_value
    ),
    jsonb_build_object(
      'status', case when p_decision = 'approve' then 'approved' else 'dismissed' end,
      'field', field_name_value,
      'value', case when p_decision = 'approve' then proposed_value else current_value end
    ),
    jsonb_build_object(
      'contact_id', contact_row.id,
      'expected_current_value', expected_current_value,
      'proposal_contact_updated_at', change_row.payload -> 'baseline' -> 'expected_contact_updated_at'
    )
  );

  return jsonb_build_object(
    'change_id', change_row.id,
    'contact_id', contact_row.id,
    'field', field_name_value,
    'status', case when p_decision = 'approve' then 'approved' else 'dismissed' end,
    'contact_updated_at', updated_contact_at,
    'duplicate', false
  );
end;
$$;

revoke all on function public.lbb_review_recording_baseline_change(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.lbb_review_recording_baseline_change(uuid,uuid,uuid,text)
  to service_role;

-- Keep the full canonical content-free receipt validator and extend only its
-- task/feature allowlist for this worker.
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
  actual_keys text[];
  expected_keys constant text[] := array[
    'content_recorded',
    'error_code',
    'error_kind',
    'fallback_models',
    'feature',
    'final_provider',
    'finish_reason',
    'gateway_generation_id',
    'input_tokens',
    'latency_ms',
    'model_attempt_count',
    'output_tokens',
    'primary_model',
    'prompt_hash',
    'prompt_version',
    'response_id',
    'served_model',
    'task',
    'total_tokens'
  ]::text[];
  forbidden_keys constant text[] := array[
    'completion',
    'content',
    'input',
    'messages',
    'output',
    'prompt',
    'result',
    'system',
    'text'
  ]::text[];
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

  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'AI ledger metadata must be an object.' using errcode = '22023';
  end if;

  select array_agg(key order by key)
  into actual_keys
  from jsonb_object_keys(p_metadata) as keys(key);

  if actual_keys is distinct from expected_keys then
    raise exception 'AI ledger metadata keys do not match the content-free schema.'
      using errcode = '22023';
  end if;
  if p_metadata ?| forbidden_keys then
    raise exception 'AI ledger metadata contains a forbidden content key.'
      using errcode = '22023';
  end if;
  if p_metadata -> 'content_recorded' is distinct from 'false'::jsonb then
    raise exception 'AI ledger metadata must declare content_recorded=false.'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_metadata -> 'task') <> 'string'
    or p_metadata ->> 'task' not in (
      'engagement_rank',
      'networking_rank',
      'introduction_draft',
      'ask_answer',
      'recording_baseline'
    ) then
    raise exception 'Invalid AI ledger task.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_metadata -> 'feature') <> 'string'
    or p_metadata ->> 'feature' not in ('engagement', 'networking', 'ask', 'recordings') then
    raise exception 'Invalid AI ledger feature.' using errcode = '22023';
  end if;
  if (p_metadata ->> 'task' = 'engagement_rank' and p_metadata ->> 'feature' <> 'engagement')
    or (p_metadata ->> 'task' in ('networking_rank', 'introduction_draft') and p_metadata ->> 'feature' <> 'networking')
    or (p_metadata ->> 'task' = 'ask_answer' and p_metadata ->> 'feature' <> 'ask')
    or (p_metadata ->> 'task' = 'recording_baseline' and p_metadata ->> 'feature' <> 'recordings') then
    raise exception 'AI ledger task and feature do not match.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_metadata -> 'prompt_version') <> 'string'
    or p_metadata ->> 'prompt_version' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$' then
    raise exception 'Invalid AI ledger prompt version.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_metadata -> 'prompt_hash') <> 'string'
    or p_metadata ->> 'prompt_hash' !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid AI ledger prompt hash.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_metadata -> 'primary_model') <> 'string'
    or length(p_metadata ->> 'primary_model') > 128
    or p_metadata ->> 'primary_model' !~* '^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9._-]*$' then
    raise exception 'Invalid AI ledger primary model.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_metadata -> 'fallback_models') <> 'array'
    or jsonb_array_length(p_metadata -> 'fallback_models') > 4
    or exists (
      select 1
      from jsonb_array_elements(p_metadata -> 'fallback_models') as fallback(model)
      where jsonb_typeof(model) <> 'string'
        or length(model #>> '{}') > 128
        or model #>> '{}' !~* '^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9._-]*$'
    ) then
    raise exception 'Invalid AI ledger fallback models.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_metadata -> 'served_model') not in ('string', 'null')
    or (
      jsonb_typeof(p_metadata -> 'served_model') = 'string'
      and (
        length(p_metadata ->> 'served_model') > 128
        or p_metadata ->> 'served_model' !~* '^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9._-]*$'
      )
    ) then
    raise exception 'Invalid AI ledger served model.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_metadata -> 'final_provider') not in ('string', 'null')
    or (
      jsonb_typeof(p_metadata -> 'final_provider') = 'string'
      and p_metadata ->> 'final_provider' !~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    ) then
    raise exception 'Invalid AI ledger final provider.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_metadata -> 'response_id') not in ('string', 'null')
    or (
      jsonb_typeof(p_metadata -> 'response_id') = 'string'
      and (
        length(p_metadata ->> 'response_id') > 256
        or p_metadata ->> 'response_id' !~ '^[A-Za-z0-9._:/=+-]+$'
      )
    ) then
    raise exception 'Invalid AI ledger response id.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_metadata -> 'gateway_generation_id') not in ('string', 'null')
    or (
      jsonb_typeof(p_metadata -> 'gateway_generation_id') = 'string'
      and (
        length(p_metadata ->> 'gateway_generation_id') > 256
        or p_metadata ->> 'gateway_generation_id' !~ '^gen_[A-Za-z0-9._:-]+$'
      )
    ) then
    raise exception 'Invalid AI ledger gateway generation id.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_metadata -> 'finish_reason') not in ('string', 'null')
    or (
      jsonb_typeof(p_metadata -> 'finish_reason') = 'string'
      and p_metadata ->> 'finish_reason' not in (
        'stop', 'length', 'content-filter', 'tool-calls', 'error', 'other', 'unknown'
      )
    ) then
    raise exception 'Invalid AI ledger finish reason.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_metadata -> 'error_kind') not in ('string', 'null')
    or (
      jsonb_typeof(p_metadata -> 'error_kind') = 'string'
      and p_metadata ->> 'error_kind' not in (
        'budget', 'rate_limit', 'timeout', 'unavailable', 'configuration', 'invalid_output'
      )
    ) then
    raise exception 'Invalid AI ledger error kind.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_metadata -> 'error_code') not in ('string', 'null')
    or (
      jsonb_typeof(p_metadata -> 'error_code') = 'string'
      and (
        length(p_metadata ->> 'error_code') > 96
        or p_metadata ->> 'error_code' !~ '^[A-Za-z0-9._:-]+$'
      )
    ) then
    raise exception 'Invalid AI ledger error code.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_metadata -> 'latency_ms') <> 'number'
    or (p_metadata ->> 'latency_ms')::numeric < 0
    or (p_metadata ->> 'latency_ms')::numeric <> trunc((p_metadata ->> 'latency_ms')::numeric) then
    raise exception 'Invalid AI ledger latency.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_metadata -> 'model_attempt_count') not in ('number', 'null')
    or (
      jsonb_typeof(p_metadata -> 'model_attempt_count') = 'number'
      and (
        (p_metadata ->> 'model_attempt_count')::numeric < 1
        or (p_metadata ->> 'model_attempt_count')::numeric > 16
        or (p_metadata ->> 'model_attempt_count')::numeric
          <> trunc((p_metadata ->> 'model_attempt_count')::numeric)
      )
    )
    or (
      p_status = 'completed'
      and p_metadata -> 'model_attempt_count' = 'null'::jsonb
    ) then
    raise exception 'Invalid AI ledger model attempt count.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_each(p_metadata) as token(field, value)
    where field in ('input_tokens', 'output_tokens', 'total_tokens')
      and (
        jsonb_typeof(value) not in ('number', 'null')
        or (
          jsonb_typeof(value) = 'number'
          and (
            (value #>> '{}')::numeric < 0
            or (value #>> '{}')::numeric <> trunc((value #>> '{}')::numeric)
          )
        )
      )
  ) then
    raise exception 'Invalid AI ledger token count.' using errcode = '22023';
  end if;
  if (
    p_metadata -> 'total_tokens' = 'null'::jsonb
    and p_total_tokens is not null
  ) or (
    p_metadata -> 'total_tokens' <> 'null'::jsonb
    and p_total_tokens is distinct from (p_metadata ->> 'total_tokens')::integer
  ) then
    raise exception 'AI ledger total token count does not match its receipt.'
      using errcode = '22023';
  end if;

  if p_status = 'completed' then
    if jsonb_typeof(p_metadata -> 'served_model') <> 'string'
      or jsonb_typeof(p_metadata -> 'response_id') <> 'string'
      or jsonb_typeof(p_metadata -> 'gateway_generation_id') <> 'string'
      or jsonb_typeof(p_metadata -> 'model_attempt_count') <> 'number'
      or jsonb_typeof(p_metadata -> 'final_provider') <> 'string'
      or jsonb_typeof(p_metadata -> 'input_tokens') <> 'number'
      or jsonb_typeof(p_metadata -> 'output_tokens') <> 'number'
      or jsonb_typeof(p_metadata -> 'total_tokens') <> 'number'
      or p_metadata -> 'error_kind' <> 'null'::jsonb
      or p_metadata -> 'error_code' <> 'null'::jsonb then
      raise exception 'Completed AI ledger receipt has an invalid state.'
        using errcode = '22023';
    end if;
    if p_metadata ->> 'served_model' <> p_metadata ->> 'primary_model'
      and not exists (
        select 1
        from jsonb_array_elements_text(p_metadata -> 'fallback_models') as fallback(model)
        where model = p_metadata ->> 'served_model'
      ) then
      raise exception 'Completed AI ledger served model is outside its routing policy.'
        using errcode = '22023';
    end if;
  else
    if p_metadata -> 'served_model' <> 'null'::jsonb
      or p_metadata -> 'response_id' <> 'null'::jsonb
      or p_metadata -> 'gateway_generation_id' <> 'null'::jsonb
      or p_metadata -> 'model_attempt_count' <> 'null'::jsonb
      or p_metadata -> 'final_provider' <> 'null'::jsonb
      or p_metadata -> 'input_tokens' <> 'null'::jsonb
      or p_metadata -> 'output_tokens' <> 'null'::jsonb
      or p_metadata -> 'total_tokens' <> 'null'::jsonb
      or p_metadata -> 'finish_reason' <> 'null'::jsonb
      or jsonb_typeof(p_metadata -> 'error_kind') <> 'string'
      or jsonb_typeof(p_metadata -> 'error_code') <> 'string' then
      raise exception 'Failed AI ledger receipt has an invalid state.'
        using errcode = '22023';
    end if;
  end if;

  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action, table_name, metadata
  ) values (
    p_tenant_id,
    p_actor_user_id,
    'system',
    'ai.generation.' || p_status,
    'usage_events',
    p_metadata
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
      p_metadata
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
