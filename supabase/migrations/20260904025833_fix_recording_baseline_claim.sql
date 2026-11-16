-- Forward-only repair for the production claim path.
-- Qualify cancellation CTE fields that collide with RETURNS TABLE output names.

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
  select cancelled.tenant_id, 'system', 'recording.baseline_cancelled_source_ineligible',
    'jobs', cancelled.id,
    jsonb_build_object(
      'transcript_id', cancelled.payload -> 'transcript_id',
      'contact_id', cancelled.payload -> 'contact_id'
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
