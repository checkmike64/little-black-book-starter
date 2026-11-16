-- Make raw recording review an operator-only managed-service surface.
-- Operators act as themselves; owner-facing promises and actions remain
-- proposals until the recording owner explicitly reviews them downstream.

alter table public.promises
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists review_status text not null default 'accepted',
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

alter table public.promises
  drop constraint if exists promises_status_check,
  add constraint promises_status_check
    check (status in ('pending_review', 'open', 'completed', 'skipped', 'stopped')),
  drop constraint if exists promises_review_status_check,
  add constraint promises_review_status_check
    check (review_status in ('pending_owner', 'accepted', 'declined')),
  drop constraint if exists promises_owner_review_coherence_check,
  add constraint promises_owner_review_coherence_check check (
    (review_status = 'pending_owner'
      and owner_user_id is not null
      and reviewed_by is null
      and reviewed_at is null
      and status = 'pending_review')
    or
    (review_status = 'accepted'
      and (reviewed_by is null) = (reviewed_at is null))
    or
    (review_status = 'declined'
      and reviewed_by is not null
      and reviewed_at is not null
      and status = 'skipped')
  );

create index if not exists promises_owner_pending_review_idx
  on public.promises (tenant_id, owner_user_id, created_at desc)
  where review_status = 'pending_owner';

-- Browser members retain the legacy editable promise fields but cannot forge
-- the operator-to-owner review receipt columns. Server actions use service_role.
revoke update on table public.promises from authenticated;
grant update (
  contact_id,interaction_id,direction,promise_text,status,due_on,completed_at,
  source,evidence,updated_at
) on table public.promises to authenticated;

alter table public.recording_followups
  drop constraint if exists recording_followups_target_check;
alter table public.recording_followups
  drop constraint if exists recording_followups_target_table_check;
alter table public.recording_followups
  add constraint recording_followups_target_table_check
    check (target_table is null or target_table in ('relationship_actions', 'promises', 'pending_changes'));
alter table public.recording_followups
  add constraint recording_followups_target_check check (
    (route = 'action'
      and target_table in ('relationship_actions', 'pending_changes')
      and target_id is not null)
    or
    (route in ('owner_promise', 'contact_promise')
      and target_table = 'promises'
      and target_id is not null)
    or
    (route in ('context', 'already_done', 'dismiss')
      and target_table is null and target_id is null)
    or (route is null and target_table is null and target_id is null)
  );

-- Existing owner RLS remains intact. Managed installs may promote a stored
-- owner through the server-side OPERATOR_EMAILS override, which SQL cannot see.
-- The application must guard the page/action first and only then use a
-- tenant-filtered service-role read; browser grants are not expanded here.

create index if not exists jobs_operator_recording_baseline_lease_idx
  on public.jobs (run_after, lease_expires_at)
  where job_type = 'recording_baseline_operator'
    and status in ('queued', 'running');

create or replace function public.lbb_enqueue_operator_recording_baseline(
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
    where member.tenant_id=p_tenant_id and member.user_id=p_actor_user_id
      and member.status='active' and member.role in ('owner','operator')
  ) then
    raise exception 'active recording operator access required' using errcode='42501';
  end if;
  select * into transcript_row
  from public.transcripts transcript
  where transcript.tenant_id=p_tenant_id and transcript.id=p_transcript_id
  for update;
  if not found or transcript_row.owner_user_id is null
    or transcript_row.processing_status<>'ready'
    or transcript_row.interaction_id is null
    or transcript_row.metadata->>'evidence_grade'<>'operator_reviewed'
    or transcript_row.metadata->>'reviewed_by_operator'<>p_actor_user_id::text then
    raise exception 'operator-reviewed meeting is required' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.tenant_members owner_member
    where owner_member.tenant_id=p_tenant_id
      and owner_member.user_id=transcript_row.owner_user_id
      and owner_member.status='active' and owner_member.role='owner'
  ) then
    raise exception 'recording owner is not an active tenant owner' using errcode='42501';
  end if;
  select * into interaction_row
  from public.interactions interaction
  where interaction.tenant_id=p_tenant_id and interaction.id=transcript_row.interaction_id
    and interaction.interaction_type='meeting'
    and interaction.metadata->>'evidence_grade'='operator_reviewed'
    and interaction.metadata->>'reviewed_by_operator'=p_actor_user_id::text
    and interaction.metadata->>'transcript_id'=transcript_row.id::text
  for update;
  if not found then
    raise exception 'operator-reviewed meeting interaction is required' using errcode='22023';
  end if;
  select coalesce(array_agg(value::uuid order by value::uuid),'{}'::uuid[])
  into confirmed_ids
  from jsonb_array_elements_text(
    case when jsonb_typeof(transcript_row.metadata->'confirmed_contact_ids')='array'
      then transcript_row.metadata->'confirmed_contact_ids' else '[]'::jsonb end
  ) ids(value)
  where value~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  if cardinality(confirmed_ids)=0 then
    raise exception 'explicit reviewed meeting contacts are required' using errcode='22023';
  end if;

  for contact_row in
    select contact.id
    from public.contacts contact
    join public.interaction_contacts link
      on link.tenant_id=contact.tenant_id and link.contact_id=contact.id
      and link.interaction_id=interaction_row.id
    where contact.tenant_id=p_tenant_id and contact.id=any(confirmed_ids)
      and contact.archived_at is null
    order by contact.id
  loop
    eligible_count := eligible_count + 1;
    job_key := left('recording-baseline-operator:'||transcript_row.id::text||':'||contact_row.id::text,240);
    job_payload := jsonb_build_object(
      'trigger','recording_operator_reviewed_baseline',
      'review_mode','owner_proposal_only',
      'transcript_id',transcript_row.id,
      'interaction_id',interaction_row.id,
      'contact_id',contact_row.id,
      'owner_user_id',transcript_row.owner_user_id,
      'requested_by_operator',p_actor_user_id
    );
    job_hash := encode(extensions.digest(job_payload::text,'sha256'),'hex');
    insert into public.jobs (
      tenant_id,job_type,status,payload,result,attempts,run_after,idempotency_key,payload_hash
    ) values (
      p_tenant_id,'recording_baseline_operator','queued',job_payload,'{}'::jsonb,0,now(),job_key,job_hash
    )
    on conflict (tenant_id,job_type,idempotency_key)
      where tenant_id is not null and idempotency_key is not null
    do nothing;
    if found then
      enqueued_count := enqueued_count + 1;
    else
      select * into existing_job from public.jobs job
      where job.tenant_id=p_tenant_id and job.job_type='recording_baseline_operator'
        and job.idempotency_key=job_key
      for update;
      if existing_job.payload_hash is distinct from job_hash
        or existing_job.payload is distinct from job_payload then
        raise exception 'operator recording baseline idempotency conflict' using errcode='40001';
      end if;
      if existing_job.status='cancelled'
        and existing_job.result->>'error_code'='meeting_contact_unconfirmed' then
        update public.jobs set status='queued',attempts=0,run_after=now(),result='{}'::jsonb,
          locked_at=null,lock_token=null,lease_expires_at=null,
          contact_updated_at_at_claim=null,last_error=null
        where id=existing_job.id;
        enqueued_count := enqueued_count + 1;
      else
        duplicate_count := duplicate_count + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('transcript_id',transcript_row.id,'eligible_count',eligible_count,
    'enqueued_count',enqueued_count,'duplicate_count',duplicate_count);
end;
$$;

revoke all on function public.lbb_enqueue_operator_recording_baseline(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.lbb_enqueue_operator_recording_baseline(uuid,uuid,uuid)
  to service_role;

create or replace function public.lbb_claim_operator_recording_baseline_jobs(
  p_limit integer default 5,
  p_lease_seconds integer default 300
)
returns table (
  job_id uuid, tenant_id uuid, transcript_id uuid, interaction_id uuid,
  contact_id uuid, owner_user_id uuid, operator_user_id uuid,
  attempts integer, lock_token uuid,
  contact_updated_at timestamptz, is_first_confirmed_meeting boolean,
  meeting_title text, interaction_occurred_at timestamptz,
  interaction_summary text, meeting_action_items jsonb,
  contact_snapshot jsonb, transcript_sha256 text, provider text, source_ref text
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare candidate record; next_lock_token uuid;
begin
  if p_limit not between 1 and 25 or p_lease_seconds not between 30 and 900 then
    raise exception 'invalid operator recording baseline claim bounds' using errcode='22023';
  end if;
  with cancelled as (
    update public.jobs invalid_job
    set status='cancelled',result=jsonb_build_object(
        'outcome','cancelled','error_kind','conflict','error_code','recording_baseline_source_ineligible'),
      lock_token=null,locked_at=null,lease_expires_at=null,
      contact_updated_at_at_claim=null,last_error='operator recording baseline source is no longer eligible'
    where invalid_job.job_type='recording_baseline_operator'
      and invalid_job.status in ('queued','running')
      and not exists (
        select 1
        from public.transcripts transcript
        join public.interactions interaction
          on interaction.tenant_id=transcript.tenant_id and interaction.id=transcript.interaction_id
          and interaction.interaction_type='meeting'
          and interaction.metadata->>'evidence_grade'='operator_reviewed'
        join public.contacts contact
          on contact.tenant_id=invalid_job.tenant_id
          and contact.id=case when invalid_job.payload->>'contact_id'
            ~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (invalid_job.payload->>'contact_id')::uuid else null end
          and contact.archived_at is null
        join public.interaction_contacts link
          on link.tenant_id=invalid_job.tenant_id and link.interaction_id=interaction.id
          and link.contact_id=contact.id
        join public.tenant_members owner_member
          on owner_member.tenant_id=invalid_job.tenant_id
          and owner_member.user_id=transcript.owner_user_id
          and owner_member.status='active' and owner_member.role='owner'
        join public.tenant_members operator_member
          on operator_member.tenant_id=invalid_job.tenant_id
          and operator_member.user_id=case when invalid_job.payload->>'requested_by_operator'
            ~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (invalid_job.payload->>'requested_by_operator')::uuid else null end
          and operator_member.status='active' and operator_member.role in ('owner','operator')
        where transcript.tenant_id=invalid_job.tenant_id
          and transcript.id=case when invalid_job.payload->>'transcript_id'
            ~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (invalid_job.payload->>'transcript_id')::uuid else null end
          and transcript.processing_status='ready'
          and transcript.metadata->>'evidence_grade'='operator_reviewed'
          and transcript.owner_user_id::text=invalid_job.payload->>'owner_user_id'
          and transcript.metadata->>'reviewed_by_operator'=invalid_job.payload->>'requested_by_operator'
      )
    returning invalid_job.tenant_id,invalid_job.id,invalid_job.payload
  )
  insert into public.audit_log (tenant_id,actor_type,action,table_name,record_id,metadata)
  select cancelled.tenant_id,'system','recording.operator_baseline_cancelled_source_ineligible',
    'jobs',cancelled.id,jsonb_build_object('transcript_id',cancelled.payload->'transcript_id','contact_id',cancelled.payload->'contact_id')
  from cancelled;

  update public.jobs exhausted
  set status='failed',lock_token=null,locked_at=null,lease_expires_at=null,
    last_error='operator recording baseline attempt limit reached',
    result=jsonb_build_object('outcome','failed','error_kind','attempt_limit','error_code','recording_baseline_attempt_limit')
  where exhausted.job_type='recording_baseline_operator' and exhausted.status='running'
    and exhausted.attempts>=5 and exhausted.lease_expires_at<=now();

  for candidate in
    select queued.id job_id,queued.tenant_id,queued.attempts,
      transcript.id transcript_id,transcript.interaction_id,transcript.owner_user_id,
      (queued.payload->>'requested_by_operator')::uuid operator_user_id,
      transcript.title meeting_title,coalesce(transcript.occurred_at,transcript.created_at) interaction_occurred_at,
      interaction.summary interaction_summary,
      coalesce((select jsonb_agg(resolved.followup_text order by resolved.source_item_index,resolved.id)
        from public.recording_followups resolved
        where resolved.tenant_id=queued.tenant_id and resolved.transcript_id=transcript.id
          and resolved.contact_id=contact.id and resolved.status in ('routed','completed')),'[]'::jsonb) meeting_action_items,
      transcript.transcript_sha256,transcript.source provider,transcript.source_ref,
      contact.id contact_id,contact.updated_at contact_updated_at,
      jsonb_build_object(
        'id',contact.id,'full_name',contact.full_name,'company_name',contact.company_name,
        'company_description',contact.company_description,'role_title',contact.role_title,
        'location',contact.location,'time_zone',contact.time_zone,'phone',contact.phone,
        'linkedin',contact.linkedin,'instagram',contact.instagram,'facebook',contact.facebook,
        'x_twitter',contact.x_twitter,'youtube',contact.youtube,'podcast_url',contact.podcast_url,
        'website',contact.website,'current_asks',contact.current_asks,
        'wants_help_with',contact.wants_help_with,'services_offered',contact.services_offered,
        'ideal_referral',contact.ideal_referral) contact_snapshot
    from public.jobs queued
    join public.transcripts transcript on transcript.tenant_id=queued.tenant_id
      and transcript.id=(queued.payload->>'transcript_id')::uuid
    join public.interactions interaction on interaction.tenant_id=transcript.tenant_id
      and interaction.id=transcript.interaction_id
    join public.contacts contact on contact.tenant_id=queued.tenant_id
      and contact.id=(queued.payload->>'contact_id')::uuid
    join public.interaction_contacts link on link.tenant_id=queued.tenant_id
      and link.interaction_id=interaction.id and link.contact_id=contact.id
    where queued.job_type='recording_baseline_operator' and queued.attempts<5
      and ((queued.status='queued' and queued.run_after<=now())
        or (queued.status='running' and queued.lease_expires_at is not null and queued.lease_expires_at<=now()))
      and transcript.processing_status='ready'
      and transcript.metadata->>'evidence_grade'='operator_reviewed'
      and transcript.owner_user_id::text=queued.payload->>'owner_user_id'
      and transcript.metadata->>'reviewed_by_operator'=queued.payload->>'requested_by_operator'
      and interaction.interaction_type='meeting'
      and interaction.metadata->>'evidence_grade'='operator_reviewed'
      and contact.archived_at is null
    order by queued.run_after,queued.created_at,queued.id
    for update of queued skip locked limit p_limit
  loop
    next_lock_token:=gen_random_uuid();
    update public.jobs claimed set status='running',attempts=claimed.attempts+1,
      locked_at=now(),lock_token=next_lock_token,
      lease_expires_at=now()+make_interval(secs=>p_lease_seconds),
      contact_updated_at_at_claim=candidate.contact_updated_at,last_error=null
    where claimed.id=candidate.job_id;
    job_id:=candidate.job_id;tenant_id:=candidate.tenant_id;transcript_id:=candidate.transcript_id;
    interaction_id:=candidate.interaction_id;contact_id:=candidate.contact_id;
    owner_user_id:=candidate.owner_user_id;operator_user_id:=candidate.operator_user_id;
    attempts:=candidate.attempts+1;lock_token:=next_lock_token;
    contact_updated_at:=candidate.contact_updated_at;
    is_first_confirmed_meeting:=not exists (
      select 1 from public.transcripts prior
      join public.interaction_contacts prior_link on prior_link.tenant_id=prior.tenant_id
        and prior_link.interaction_id=prior.interaction_id and prior_link.contact_id=candidate.contact_id
      where prior.tenant_id=candidate.tenant_id and prior.owner_user_id=candidate.owner_user_id
        and prior.processing_status='ready'
        and prior.metadata->>'evidence_grade' in ('owner_confirmed','operator_reviewed')
        and (coalesce(prior.occurred_at,prior.created_at),prior.id)
          < (candidate.interaction_occurred_at,candidate.transcript_id));
    meeting_title:=candidate.meeting_title;interaction_occurred_at:=candidate.interaction_occurred_at;
    interaction_summary:=candidate.interaction_summary;meeting_action_items:=candidate.meeting_action_items;
    contact_snapshot:=candidate.contact_snapshot;transcript_sha256:=candidate.transcript_sha256;
    provider:=candidate.provider;source_ref:=candidate.source_ref;return next;
  end loop;
end;
$$;

revoke all on function public.lbb_claim_operator_recording_baseline_jobs(integer,integer)
  from public, anon, authenticated;
grant execute on function public.lbb_claim_operator_recording_baseline_jobs(integer,integer)
  to service_role;

-- The recordings cron has one AI budget slot. Select the oldest due mode first,
-- then delegate to that mode's existing SKIP LOCKED claimant. A structurally
-- invalid oldest row may be cancelled by its claimant; in that case try the
-- other mode without ever leasing two jobs.
create or replace function public.lbb_claim_next_recording_baseline_job(
  p_lease_seconds integer default 300
)
returns table (
  job_type text,
  job_id uuid, tenant_id uuid, transcript_id uuid, interaction_id uuid,
  contact_id uuid, owner_user_id uuid, actor_user_id uuid,
  attempts integer, lock_token uuid,
  contact_updated_at timestamptz, is_first_confirmed_meeting boolean,
  meeting_title text, interaction_occurred_at timestamptz,
  interaction_summary text, meeting_action_items jsonb,
  contact_snapshot jsonb, transcript_sha256 text, provider text, source_ref text
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  selected_job record;
  claimed_job record;
begin
  if p_lease_seconds not between 30 and 900 then
    raise exception 'recording baseline lease must be between 30 and 900 seconds'
      using errcode='22023';
  end if;

  loop
    select job.job_type,job.id into selected_job
    from public.jobs job
    where job.job_type in ('recording_baseline','recording_baseline_operator')
      and job.attempts<5
      and ((job.status='queued' and job.run_after<=now())
        or (job.status='running' and job.lease_expires_at is not null
          and job.lease_expires_at<=now()))
    order by job.run_after,job.created_at,job.id
    limit 1;
    if not found then return; end if;

    if selected_job.job_type='recording_baseline_operator' then
      select * into claimed_job
      from public.lbb_claim_operator_recording_baseline_jobs(1,p_lease_seconds);
    else
      select * into claimed_job
      from public.lbb_claim_recording_baseline_jobs(1,p_lease_seconds);
    end if;
    if not found then continue; end if;

    -- A mode claimant may cancel an invalid oldest row before selecting its
    -- next valid row. Requeue that later lease inside this transaction and
    -- re-arbitrate globally so the other mode cannot be skipped.
    if claimed_job.job_id<>selected_job.id then
      update public.jobs job set status='queued',attempts=greatest(job.attempts-1,0),
        locked_at=null,lock_token=null,lease_expires_at=null,
        contact_updated_at_at_claim=null,last_error=null
      where job.id=claimed_job.job_id and job.lock_token=claimed_job.lock_token
        and job.status='running';
      continue;
    end if;

    job_type:=selected_job.job_type;job_id:=claimed_job.job_id;
    tenant_id:=claimed_job.tenant_id;transcript_id:=claimed_job.transcript_id;
    interaction_id:=claimed_job.interaction_id;contact_id:=claimed_job.contact_id;
    owner_user_id:=claimed_job.owner_user_id;
    actor_user_id:=case when selected_job.job_type='recording_baseline_operator'
      then claimed_job.operator_user_id else claimed_job.owner_user_id end;
    attempts:=claimed_job.attempts;lock_token:=claimed_job.lock_token;
    contact_updated_at:=claimed_job.contact_updated_at;
    is_first_confirmed_meeting:=claimed_job.is_first_confirmed_meeting;
    meeting_title:=claimed_job.meeting_title;
    interaction_occurred_at:=claimed_job.interaction_occurred_at;
    interaction_summary:=claimed_job.interaction_summary;
    meeting_action_items:=claimed_job.meeting_action_items;
    contact_snapshot:=claimed_job.contact_snapshot;
    transcript_sha256:=claimed_job.transcript_sha256;
    provider:=claimed_job.provider;source_ref:=claimed_job.source_ref;
    return next;
    return;
  end loop;
end;
$$;

revoke all on function public.lbb_claim_next_recording_baseline_job(integer)
  from public, anon, authenticated;
grant execute on function public.lbb_claim_next_recording_baseline_job(integer)
  to service_role;

create or replace function public.lbb_fail_operator_recording_baseline_job(
  p_job_id uuid,p_lock_token uuid,p_error_kind text,p_error_code text,
  p_error text,p_retry_after_seconds integer default 300
)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare job_row public.jobs%rowtype; next_status text;
  retry_seconds integer:=greatest(30,least(coalesce(p_retry_after_seconds,300),21600));
  next_run_after timestamptz;
begin
  if p_error_kind not in ('budget','rate_limit','timeout','unavailable','configuration','invalid_output','conflict')
    or p_error_code is null or p_error_code!~'^[A-Za-z0-9._:-]{1,96}$' then
    raise exception 'invalid operator recording baseline error receipt' using errcode='22023';
  end if;
  select * into job_row from public.jobs job
  where job.id=p_job_id and job.job_type='recording_baseline_operator' for update;
  if not found then raise exception 'operator recording baseline job not found' using errcode='22023'; end if;
  if job_row.status in ('queued','failed') and job_row.result->>'error_kind'=p_error_kind
    and job_row.result->>'error_code'=p_error_code then
    return jsonb_build_object('job_id',job_row.id,'status',job_row.status,'attempts',job_row.attempts,'run_after',job_row.run_after,'duplicate',true);
  end if;
  if job_row.status<>'running' or job_row.lock_token is distinct from p_lock_token then
    raise exception 'operator recording baseline lease conflict' using errcode='40001';
  end if;
  next_status:=case when job_row.attempts>=5 then 'failed' else 'queued' end;
  next_run_after:=case when next_status='queued' then now()+make_interval(secs=>retry_seconds) else job_row.run_after end;
  update public.jobs set status=next_status,run_after=next_run_after,locked_at=null,
    lock_token=null,lease_expires_at=null,last_error=nullif(left(trim(coalesce(p_error,'')),500),''),
    result=jsonb_build_object('outcome',next_status,'error_kind',p_error_kind,'error_code',p_error_code)
  where id=job_row.id;
  insert into public.audit_log (tenant_id,actor_type,action,table_name,record_id,metadata)
  values (job_row.tenant_id,'system','recording.operator_baseline_'||next_status,'jobs',job_row.id,
    jsonb_build_object('attempts',job_row.attempts,'error_kind',p_error_kind,'error_code',p_error_code,
      'retry_after_seconds',case when next_status='queued' then retry_seconds else null end));
  return jsonb_build_object('job_id',job_row.id,'status',next_status,'attempts',job_row.attempts,
    'run_after',next_run_after,'duplicate',false);
end;
$$;

revoke all on function public.lbb_fail_operator_recording_baseline_job(uuid,uuid,text,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.lbb_fail_operator_recording_baseline_job(uuid,uuid,text,text,text,integer)
  to service_role;

create or replace function public.lbb_apply_operator_recording_baseline(
  p_job_id uuid,p_lock_token uuid,p_prompt_version text,
  p_gateway_generation_id text,p_suggestions jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path=pg_catalog,public
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
  actual_keys text[];
  suggestions_hash text;
  pending_change_id uuid;
  pending_ids jsonb:='[]'::jsonb;
  proposal_hashes jsonb:='{}'::jsonb;
  proposal_hash text;
  proposal_count integer:=0;
  unchanged_count integer:=0;
  skipped_low_confidence_count integer:=0;
  transcript_id_value uuid;
  contact_id_value uuid;
  owner_user_id_value uuid;
  operator_user_id_value uuid;
  result_payload jsonb;
begin
  if p_prompt_version is null or p_prompt_version!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$'
    or p_gateway_generation_id is null or p_gateway_generation_id!~'^gen_[A-Za-z0-9._:-]+$' then
    raise exception 'invalid operator recording baseline generation receipt' using errcode='22023';
  end if;
  if p_suggestions is null or jsonb_typeof(p_suggestions)<>'object'
    or (select count(*) from jsonb_object_keys(p_suggestions))>17 then
    raise exception 'operator recording baseline suggestions must be an allowlisted object' using errcode='22023';
  end if;
  suggestions_hash:=encode(extensions.digest(p_suggestions::text,'sha256'),'hex');
  select * into job_row from public.jobs job
  where job.id=p_job_id and job.job_type='recording_baseline_operator' for update;
  if not found then raise exception 'operator recording baseline job not found' using errcode='22023'; end if;
  if job_row.status='succeeded' and job_row.lock_token=p_lock_token then
    if job_row.result->>'suggestions_hash'=suggestions_hash
      and job_row.result->>'prompt_version'=p_prompt_version
      and job_row.result->>'gateway_generation_id'=p_gateway_generation_id then
      return job_row.result||jsonb_build_object('duplicate',true);
    end if;
    raise exception 'operator recording baseline completion idempotency conflict' using errcode='40001';
  end if;
  if job_row.status<>'running' or job_row.lock_token is distinct from p_lock_token
    or job_row.lease_expires_at is null or job_row.lease_expires_at<=now()
    or job_row.contact_updated_at_at_claim is null then
    raise exception 'operator recording baseline lease conflict' using errcode='40001';
  end if;
  begin
    transcript_id_value:=(job_row.payload->>'transcript_id')::uuid;
    contact_id_value:=(job_row.payload->>'contact_id')::uuid;
    owner_user_id_value:=(job_row.payload->>'owner_user_id')::uuid;
    operator_user_id_value:=(job_row.payload->>'requested_by_operator')::uuid;
  exception when others then
    raise exception 'operator recording baseline job payload is invalid' using errcode='22023';
  end;
  if job_row.payload->>'review_mode'<>'owner_proposal_only'
    or not exists (select 1 from public.tenant_members member
      where member.tenant_id=job_row.tenant_id and member.user_id=owner_user_id_value
        and member.status='active' and member.role='owner')
    or not exists (select 1 from public.tenant_members member
      where member.tenant_id=job_row.tenant_id and member.user_id=operator_user_id_value
        and member.status='active' and member.role in ('owner','operator')) then
    raise exception 'active owner and operator are required' using errcode='42501';
  end if;
  select * into transcript_row from public.transcripts transcript
  where transcript.tenant_id=job_row.tenant_id and transcript.id=transcript_id_value
    and transcript.owner_user_id=owner_user_id_value and transcript.processing_status='ready'
    and transcript.metadata->>'evidence_grade'='operator_reviewed'
    and transcript.metadata->>'reviewed_by_operator'=operator_user_id_value::text
  for update;
  if not found or transcript_row.interaction_id is null then
    raise exception 'operator-reviewed meeting is required' using errcode='22023';
  end if;
  select * into interaction_row from public.interactions interaction
  where interaction.tenant_id=job_row.tenant_id and interaction.id=transcript_row.interaction_id
    and interaction.interaction_type='meeting'
    and interaction.metadata->>'evidence_grade'='operator_reviewed'
    and interaction.metadata->>'reviewed_by_operator'=operator_user_id_value::text
    and interaction.metadata->>'transcript_id'=transcript_row.id::text
  for update;
  if not found or interaction_row.id::text<>job_row.payload->>'interaction_id' then
    raise exception 'operator recording baseline interaction mismatch' using errcode='22023';
  end if;
  select * into contact_row from public.contacts contact
  where contact.tenant_id=job_row.tenant_id and contact.id=contact_id_value
    and contact.archived_at is null for update;
  if not found or not exists (select 1 from public.interaction_contacts link
    where link.tenant_id=job_row.tenant_id and link.interaction_id=interaction_row.id
      and link.contact_id=contact_row.id) then
    raise exception 'reviewed meeting contact is required' using errcode='22023';
  end if;
  if contact_row.updated_at is distinct from job_row.contact_updated_at_at_claim then
    raise exception 'recording baseline contact changed after claim' using errcode='40001';
  end if;

  for suggestion in select key,value from jsonb_each(p_suggestions) order by key loop
    select * into policy_row from app_private.recording_baseline_field_policy policy
    where policy.field_name=suggestion.key;
    if not found then
      raise exception 'recording baseline field is not allowlisted: %',suggestion.key using errcode='22023';
    end if;
    if jsonb_typeof(suggestion.value)<>'object' then
      raise exception 'recording baseline suggestion must be an object' using errcode='22023';
    end if;
    select array_agg(key order by key) into actual_keys from jsonb_object_keys(suggestion.value) keys(key);
    if actual_keys is distinct from array['confidence','evidence_summary','value']::text[]
      or jsonb_typeof(suggestion.value->'confidence')<>'number'
      or (suggestion.value->>'confidence')::numeric<0
      or (suggestion.value->>'confidence')::numeric>1 then
      raise exception 'recording baseline suggestion contract is invalid' using errcode='22023';
    end if;
    suggestion_confidence:=(suggestion.value->>'confidence')::numeric;
    if jsonb_typeof(suggestion.value->'evidence_summary')<>'string'
      or length(trim(suggestion.value->>'evidence_summary')) not between 1 and 1000 then
      raise exception 'recording baseline evidence summary is required' using errcode='22023';
    end if;
    evidence_summary:=trim(suggestion.value->>'evidence_summary');
    if not ((interaction_row.summary is not null and position(
        lower(regexp_replace(trim(evidence_summary),'\s+',' ','g'))
        in lower(regexp_replace(trim(interaction_row.summary),'\s+',' ','g'))) > 0)
      or exists (select 1 from public.recording_followups resolved
        where resolved.tenant_id=job_row.tenant_id and resolved.transcript_id=transcript_row.id
          and resolved.contact_id=contact_row.id and resolved.status in ('routed','completed')
          and position(lower(regexp_replace(trim(evidence_summary),'\s+',' ','g'))
            in lower(regexp_replace(trim(resolved.followup_text),'\s+',' ','g'))) > 0)) then
      raise exception 'recording baseline evidence must be a literal reviewed meeting excerpt' using errcode='22023';
    end if;
    suggestion_value:=suggestion.value->'value';
    if not app_private.recording_baseline_value_is_valid(
      suggestion.key,policy_row.value_kind,suggestion_value,policy_row.max_length) then
      raise exception 'recording baseline value is invalid for field: %',suggestion.key using errcode='22023';
    end if;
    execute format('select coalesce(to_jsonb(%I), ''null''::jsonb) from public.contacts where tenant_id=$1 and id=$2',suggestion.key)
      into current_value using job_row.tenant_id,contact_row.id;
    current_normalized:=app_private.normalize_recording_baseline_value(suggestion.key,policy_row.value_kind,current_value);
    suggested_normalized:=app_private.normalize_recording_baseline_value(suggestion.key,policy_row.value_kind,suggestion_value);
    if current_normalized is not distinct from suggested_normalized then
      unchanged_count:=unchanged_count+1;
      continue;
    end if;
    if suggestion_confidence<0.90 then
      skipped_low_confidence_count:=skipped_low_confidence_count+1;
      continue;
    end if;
    pending_change_id:=null;
    proposal_hash:=encode(extensions.digest(jsonb_build_object(
      'field',suggestion.key,
      'suggestion',suggestion.value,
      'expected_current_value',current_value
    )::text,'sha256'),'hex');
    insert into public.pending_changes (
      tenant_id,contact_id,change_type,summary,payload,status,risk_level,source,proposed_by,idempotency_key
    ) values (
      job_row.tenant_id,contact_row.id,'field_update',
      left('Operator-reviewed meeting evidence suggests an update to '||replace(suggestion.key,'_',' ')||'.',500),
      jsonb_build_object(
        'fields',jsonb_build_object(suggestion.key,suggestion_value),
        'field',suggestion.key,'proposed_value',suggestion_value,
        'expected_current_value',current_value,'confidence',suggestion_confidence,
        'source_ref',coalesce(transcript_row.source_ref,transcript_row.id::text),
        'evidence',jsonb_build_object(
          'meeting_title',transcript_row.title,
          'meeting_occurred_at',coalesce(transcript_row.occurred_at,transcript_row.created_at),
          'transcript_id',transcript_row.id,'interaction_id',interaction_row.id,
          'transcript_sha256',transcript_row.transcript_sha256,
          'provider',transcript_row.source,'evidence_summary',evidence_summary),
        'baseline',jsonb_build_object(
          'job_id',job_row.id,'prompt_version',p_prompt_version,
          'gateway_generation_id',p_gateway_generation_id,
          'contact_updated_at_at_claim',job_row.contact_updated_at_at_claim,
          'expected_contact_updated_at',contact_row.updated_at,
          'review_mode','owner_proposal_only',
          'reviewed_by_operator',operator_user_id_value,
          'proposal_sha256',proposal_hash)
      ),
      'pending',case when suggestion.key='ideal_referral' then 'high' else 'low' end,
      'recording_baseline','claude',
      left('recording-baseline-operator-proposal:'||job_row.id::text||':'||suggestion.key,240)
    ) on conflict (tenant_id,idempotency_key) where idempotency_key is not null
      do nothing returning id into pending_change_id;
    if pending_change_id is null then
      select change.id into pending_change_id from public.pending_changes change
      where change.tenant_id=job_row.tenant_id
        and change.idempotency_key=left('recording-baseline-operator-proposal:'||job_row.id::text||':'||suggestion.key,240)
      for update;
    else
      insert into public.audit_log (tenant_id,actor_user_id,actor_type,action,table_name,record_id,metadata)
      values (job_row.tenant_id,operator_user_id_value,'operator',
        'recording.operator_baseline_change_proposed','pending_changes',pending_change_id,
        jsonb_build_object('job_id',job_row.id,'transcript_id',transcript_row.id,
          'contact_id',contact_row.id,'field_name',suggestion.key,'owner_user_id',owner_user_id_value));
    end if;
    proposal_count:=proposal_count+1;
    pending_ids:=pending_ids||jsonb_build_array(pending_change_id);
    proposal_hashes:=proposal_hashes||jsonb_build_object(suggestion.key,proposal_hash);
  end loop;

  result_payload:=jsonb_build_object(
    'job_id',job_row.id,'status','succeeded','outcome','proposed_for_owner_review',
    'auto_filled_count',0,'contradiction_count',proposal_count,
    'unchanged_count',unchanged_count,'skipped_low_confidence_count',skipped_low_confidence_count,
    'auto_filled_fields','[]'::jsonb,'contradiction_change_ids',pending_ids,
    'proposal_hashes',proposal_hashes,
    'prompt_version',p_prompt_version,'gateway_generation_id',p_gateway_generation_id,
    'suggestions_hash',suggestions_hash,'review_mode','owner_proposal_only','duplicate',false);
  update public.jobs set status='succeeded',result=result_payload,locked_at=null,
    lease_expires_at=null,last_error=null where id=job_row.id;
  insert into public.audit_log (tenant_id,actor_user_id,actor_type,action,table_name,record_id,metadata)
  values (job_row.tenant_id,operator_user_id_value,'operator','recording.operator_baseline_proposed',
    'jobs',job_row.id,jsonb_build_object('transcript_id',transcript_row.id,
      'contact_id',contact_row.id,'owner_user_id',owner_user_id_value,
      'proposal_count',proposal_count,'unchanged_count',unchanged_count,
      'skipped_low_confidence_count',skipped_low_confidence_count,
      'auto_filled_count',0,'prompt_version',p_prompt_version,
      'gateway_generation_id',p_gateway_generation_id));
  return result_payload;
end;
$$;

revoke all on function public.lbb_apply_operator_recording_baseline(uuid,uuid,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.lbb_apply_operator_recording_baseline(uuid,uuid,text,text,jsonb)
  to service_role;

alter function public.lbb_review_recording_baseline_change(uuid,uuid,uuid,text)
  rename to lbb_review_owner_recording_baseline_change;

create or replace function public.lbb_review_operator_recording_baseline_change(
  p_tenant_id uuid,p_change_id uuid,p_actor_user_id uuid,p_decision text
)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
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
  reconstructed_proposal_hash text;
  exact_duplicate boolean:=false;
begin
  if p_decision is null or p_decision not in ('approve','dismiss') then
    raise exception 'recording baseline review decision must be approve or dismiss' using errcode='22023';
  end if;
  if not exists (select 1 from public.tenant_members member
    where member.tenant_id=p_tenant_id and member.user_id=p_actor_user_id
      and member.status='active' and member.role='owner') then
    raise exception 'active recording owner access required' using errcode='42501';
  end if;
  select * into change_row from public.pending_changes change
  where change.tenant_id=p_tenant_id and change.id=p_change_id for update;
  if not found or change_row.source<>'recording_baseline'
    or change_row.change_type<>'field_update' or change_row.contact_id is null
    or change_row.payload->'baseline'->>'review_mode'<>'owner_proposal_only' then
    raise exception 'operator recording baseline change not found' using errcode='22023';
  end if;
  exact_duplicate:=change_row.status=case when p_decision='approve' then 'approved' else 'dismissed' end;
  if change_row.superseded_at is not null or change_row.replaced_by_pending_change_id is not null
    or (not exact_duplicate and change_row.status<>'pending') then
    raise exception 'recording baseline change was already resolved or superseded' using errcode='40001';
  end if;
  if jsonb_typeof(change_row.payload->'fields')<>'object'
    or (select count(*) from jsonb_object_keys(change_row.payload->'fields'))<>1
    or jsonb_typeof(change_row.payload->'field')<>'string'
    or not (change_row.payload?'expected_current_value')
    or coalesce(change_row.payload->'baseline'->>'job_id','')
      !~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(change_row.payload->'evidence'->>'transcript_id','')
      !~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(change_row.payload->'evidence'->>'interaction_id','')
      !~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'recording baseline change payload is invalid' using errcode='22023';
  end if;
  baseline_job_id:=(change_row.payload->'baseline'->>'job_id')::uuid;
  evidence_payload:=change_row.payload->'evidence';
  evidence_transcript_id:=(evidence_payload->>'transcript_id')::uuid;
  evidence_interaction_id:=(evidence_payload->>'interaction_id')::uuid;
  select * into baseline_job from public.jobs job
  where job.tenant_id=p_tenant_id and job.id=baseline_job_id
    and job.job_type='recording_baseline_operator' and job.status='succeeded'
    and job.payload->>'owner_user_id'=p_actor_user_id::text
    and job.payload->>'contact_id'=change_row.contact_id::text
    and job.payload->>'transcript_id'=evidence_transcript_id::text
    and job.payload->>'interaction_id'=evidence_interaction_id::text
    and job.result->'contradiction_change_ids'@>jsonb_build_array(change_row.id)
  for share;
  if not found then
    raise exception 'recording baseline change is not linked to its completed operator job' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.transcripts transcript
    join public.interactions interaction on interaction.tenant_id=transcript.tenant_id
      and interaction.id=transcript.interaction_id and interaction.interaction_type='meeting'
      and interaction.metadata->>'evidence_grade'='operator_reviewed'
      and interaction.metadata->>'transcript_id'=transcript.id::text
    join public.interaction_contacts link on link.tenant_id=transcript.tenant_id
      and link.interaction_id=interaction.id and link.contact_id=change_row.contact_id
    where transcript.tenant_id=p_tenant_id and transcript.id=evidence_transcript_id
      and transcript.owner_user_id=p_actor_user_id
      and transcript.interaction_id=evidence_interaction_id
      and transcript.processing_status='ready'
      and transcript.metadata->>'evidence_grade'='operator_reviewed'
      and coalesce(transcript.transcript_sha256,'')=coalesce(evidence_payload->>'transcript_sha256','')
  ) then
    raise exception 'operator recording baseline evidence linkage is invalid' using errcode='22023';
  end if;
  field_name_value:=change_row.payload->>'field';
  select * into policy_row from app_private.recording_baseline_field_policy policy
  where policy.field_name=field_name_value;
  if not found or not (change_row.payload->'fields'?field_name_value)
    or change_row.payload->'fields'->field_name_value
      is distinct from change_row.payload->'proposed_value' then
    raise exception 'recording baseline change field is not allowlisted' using errcode='22023';
  end if;
  proposed_value:=change_row.payload->'proposed_value';
  expected_current_value:=change_row.payload->'expected_current_value';
  reconstructed_proposal_hash:=encode(extensions.digest(jsonb_build_object(
    'field',field_name_value,
    'suggestion',jsonb_build_object(
      'confidence',change_row.payload->'confidence',
      'evidence_summary',evidence_payload->'evidence_summary',
      'value',proposed_value
    ),
    'expected_current_value',expected_current_value
  )::text,'sha256'),'hex');
  if reconstructed_proposal_hash is distinct from
      change_row.payload->'baseline'->>'proposal_sha256'
    or reconstructed_proposal_hash is distinct from
      baseline_job.result->'proposal_hashes'->>field_name_value then
    raise exception 'operator recording baseline proposal integrity check failed' using errcode='22023';
  end if;
  if exact_duplicate then
    return jsonb_build_object('change_id',change_row.id,'contact_id',change_row.contact_id,
      'status',change_row.status,'duplicate',true);
  end if;
  if not app_private.recording_baseline_value_is_valid(
    field_name_value,policy_row.value_kind,proposed_value,policy_row.max_length) then
    raise exception 'recording baseline proposed value is invalid' using errcode='22023';
  end if;
  select * into contact_row from public.contacts contact
  where contact.tenant_id=p_tenant_id and contact.id=change_row.contact_id
    and contact.archived_at is null for update;
  if not found then raise exception 'active recording baseline contact not found' using errcode='22023'; end if;
  execute format('select coalesce(to_jsonb(%I), ''null''::jsonb) from public.contacts where tenant_id=$1 and id=$2',field_name_value)
    into current_value using p_tenant_id,contact_row.id;
  if p_decision='approve' then
    if current_value is distinct from expected_current_value then
      raise exception 'contact field changed after this meeting proposal was created' using errcode='40001';
    end if;
    if policy_row.value_kind='text' then
      execute format('update public.contacts set %I=$1 where tenant_id=$2 and id=$3 and coalesce(to_jsonb(%I), ''null''::jsonb) is not distinct from $4',field_name_value,field_name_value)
        using trim(proposed_value#>>'{}'),p_tenant_id,contact_row.id,expected_current_value;
    elsif policy_row.value_kind='text_array' then
      execute format('update public.contacts set %I=array(select trim(value) from jsonb_array_elements_text($1) values_(value)) where tenant_id=$2 and id=$3 and coalesce(to_jsonb(%I), ''null''::jsonb) is not distinct from $4',field_name_value,field_name_value)
        using proposed_value,p_tenant_id,contact_row.id,expected_current_value;
    elsif policy_row.value_kind='date' then
      execute format('update public.contacts set %I=($1#>>''{}'')::date where tenant_id=$2 and id=$3 and coalesce(to_jsonb(%I), ''null''::jsonb) is not distinct from $4',field_name_value,field_name_value)
        using proposed_value,p_tenant_id,contact_row.id,expected_current_value;
    end if;
    if not found then raise exception 'contact field changed during meeting proposal approval' using errcode='40001'; end if;
    select updated_at into updated_contact_at from public.contacts
    where tenant_id=p_tenant_id and id=contact_row.id;
    insert into public.field_provenance (
      tenant_id,table_name,record_id,field_name,source_type,source_ref,summary,confidence,metadata
    ) values (
      p_tenant_id,'contacts',contact_row.id,field_name_value,'transcript',
      left(coalesce(change_row.payload->>'source_ref',p_change_id::text),500),
      nullif(left(trim(coalesce(evidence_payload->>'evidence_summary','')),1000),''),
      case when jsonb_typeof(change_row.payload->'confidence')='number'
        then (change_row.payload->>'confidence')::numeric else null end,
      jsonb_build_object('pending_change_id',change_row.id,'approved_by',p_actor_user_id,
        'expected_current_value',expected_current_value,'applied_value',proposed_value,
        'contact_updated_at',updated_contact_at,'evidence',evidence_payload,
        'baseline',change_row.payload->'baseline','operator_reviewed_source',true)
    );
  end if;
  update public.pending_changes change
  set status=case when p_decision='approve' then 'approved' else 'dismissed' end,
    reviewed_by=p_actor_user_id,reviewed_at=now()
  where change.tenant_id=p_tenant_id and change.id=change_row.id and change.status='pending';
  if not found then raise exception 'recording baseline change changed during review' using errcode='40001'; end if;
  insert into public.audit_log (
    tenant_id,actor_user_id,actor_type,action,table_name,record_id,before,after,metadata
  ) values (
    p_tenant_id,p_actor_user_id,'client',
    'recording.operator_baseline_change_'||case when p_decision='approve' then 'approved' else 'dismissed' end,
    'pending_changes',change_row.id,
    jsonb_build_object('status',change_row.status,'field',field_name_value,'current_value',current_value),
    jsonb_build_object('status',case when p_decision='approve' then 'approved' else 'dismissed' end,
      'field',field_name_value,'value',case when p_decision='approve' then proposed_value else current_value end),
    jsonb_build_object('contact_id',contact_row.id,'expected_current_value',expected_current_value,
      'reviewed_source','operator_reviewed')
  );
  return jsonb_build_object('change_id',change_row.id,'contact_id',contact_row.id,
    'field',field_name_value,'status',case when p_decision='approve' then 'approved' else 'dismissed' end,
    'contact_updated_at',updated_contact_at,'duplicate',false);
end;
$$;

revoke all on function public.lbb_review_operator_recording_baseline_change(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.lbb_review_operator_recording_baseline_change(uuid,uuid,uuid,text)
  to service_role;

create function public.lbb_review_recording_baseline_change(
  p_tenant_id uuid,p_change_id uuid,p_actor_user_id uuid,p_decision text
)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare job_type_value text; owner_user_id_value text;
begin
  select job.job_type,job.payload->>'owner_user_id'
  into job_type_value,owner_user_id_value
  from public.pending_changes change
  join public.jobs job on job.tenant_id=change.tenant_id
    and job.id=case when coalesce(change.payload->'baseline'->>'job_id','')
      ~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (change.payload->'baseline'->>'job_id')::uuid else null end
  where change.tenant_id=p_tenant_id and change.id=p_change_id;
  if job_type_value is null or owner_user_id_value is distinct from p_actor_user_id::text then
    raise exception 'recording baseline change does not belong to this owner' using errcode='42501';
  end if;
  if job_type_value='recording_baseline_operator' then
    return public.lbb_review_operator_recording_baseline_change(
      p_tenant_id,p_change_id,p_actor_user_id,p_decision);
  elsif job_type_value='recording_baseline' then
    return public.lbb_review_owner_recording_baseline_change(
      p_tenant_id,p_change_id,p_actor_user_id,p_decision);
  end if;
  raise exception 'unsupported recording baseline review source' using errcode='22023';
end;
$$;

revoke all on function public.lbb_review_owner_recording_baseline_change(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.lbb_review_owner_recording_baseline_change(uuid,uuid,uuid,text)
  to service_role;
revoke all on function public.lbb_review_recording_baseline_change(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.lbb_review_recording_baseline_change(uuid,uuid,uuid,text)
  to service_role;

create or replace function public.lbb_operator_confirm_meeting_contacts(
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
  interaction_row public.interactions%rowtype;
  requested_ids uuid[] := '{}'::uuid[];
  stored_ids uuid[] := '{}'::uuid[];
  existing_ids uuid[] := '{}'::uuid[];
  owner_user_id_value uuid;
  interaction_id_value uuid;
  contact_id_value uuid;
  cancelled_job_id uuid;
  exact_duplicate boolean := false;
  enqueue_result jsonb := '{}'::jsonb;
begin
  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id = p_tenant_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and member.role in ('owner', 'operator')
  ) then
    raise exception 'active recording operator access required' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct requested_id order by requested_id), '{}'::uuid[])
  into requested_ids
  from unnest(coalesce(p_contact_ids, '{}'::uuid[])) requested(requested_id)
  where requested_id is not null;
  if cardinality(requested_ids) = 0 or cardinality(requested_ids) > 25 then
    raise exception 'between one and twenty-five confirmed meeting contacts are required'
      using errcode = '22023';
  end if;
  if exists (
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
  from public.transcripts transcript
  where transcript.tenant_id = p_tenant_id
    and transcript.id = p_transcript_id
  for update;
  if not found or transcript_row.owner_user_id is null then
    raise exception 'recording artifact not found' using errcode = '22023';
  end if;
  owner_user_id_value := transcript_row.owner_user_id;
  if not exists (
    select 1 from public.tenant_members owner_member
    where owner_member.tenant_id = p_tenant_id
      and owner_member.user_id = owner_user_id_value
      and owner_member.status = 'active'
      and owner_member.role = 'owner'
  ) then
    raise exception 'recording owner is not an active tenant owner' using errcode = '42501';
  end if;
  if transcript_row.processing_status not in ('review', 'ready')
    or transcript_row.source not in ('fireflies', 'fathom', 'google_meet', 'notion')
    or nullif(trim(coalesce(transcript_row.distilled_summary, '')), '') is null then
    raise exception 'recording artifact is not ready for managed review' using errcode = '22023';
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
    raise exception 'recording participants changed after the page loaded'
      using errcode = '40001';
  end if;

  if transcript_row.processing_status = 'review' and exists (
    select 1 from public.recording_followups unresolved
    where unresolved.tenant_id = p_tenant_id
      and unresolved.transcript_id = p_transcript_id
      and unresolved.status in ('proposed', 'pending')
  ) then
    if stored_ids = requested_ids then
      return jsonb_build_object(
        'transcript_id', p_transcript_id,
        'owner_user_id', owner_user_id_value,
        'interaction_id', transcript_row.interaction_id,
        'confirmed_contact_ids', to_jsonb(requested_ids),
        'processing_status', 'review',
        'duplicate', true
      );
    end if;
    update public.transcripts
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'confirmed_contact_ids', to_jsonb(requested_ids),
        'contacts_reviewed_at', now(),
        'contacts_reviewed_by_operator', p_actor_user_id,
        'recording_owner_user_id', owner_user_id_value
      ),
      updated_at = now()
    where tenant_id = p_tenant_id and id = p_transcript_id;
    insert into public.audit_log (
      tenant_id, actor_user_id, actor_type, action,
      table_name, record_id, before, after, metadata
    ) values (
      p_tenant_id, p_actor_user_id, 'operator',
      'recording.meeting_contacts_staged_by_operator', 'transcripts', p_transcript_id,
      jsonb_build_object('confirmed_contact_ids', to_jsonb(stored_ids)),
      jsonb_build_object('confirmed_contact_ids', to_jsonb(requested_ids)),
      jsonb_build_object('owner_user_id', owner_user_id_value, 'contact_count', cardinality(requested_ids))
    );
    return jsonb_build_object(
      'transcript_id', p_transcript_id,
      'owner_user_id', owner_user_id_value,
      'interaction_id', transcript_row.interaction_id,
      'confirmed_contact_ids', to_jsonb(requested_ids),
      'processing_status', 'review',
      'duplicate', false
    );
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
        'evidence_grade', 'operator_reviewed',
        'reviewed_by_operator', p_actor_user_id,
        'recording_owner_user_id', owner_user_id_value,
        'reviewed_at', now(),
        'transcript_id', transcript_row.id,
        'recording_url', transcript_row.recording_url
      ),
      left('recording-confirmed:' || transcript_row.id::text, 160)
    )
    on conflict (tenant_id, idempotency_key) where idempotency_key is not null
    do nothing returning id into interaction_id_value;
    if interaction_id_value is null then
      select interaction.id into interaction_id_value
      from public.interactions interaction
      where interaction.tenant_id = p_tenant_id
        and interaction.idempotency_key = left('recording-confirmed:' || transcript_row.id::text, 160)
      for update;
    end if;
  else
    interaction_id_value := transcript_row.interaction_id;
  end if;

  select * into interaction_row
  from public.interactions interaction
  where interaction.tenant_id = p_tenant_id
    and interaction.id = interaction_id_value
    and interaction.interaction_type = 'meeting'
    and interaction.metadata ->> 'transcript_id' = transcript_row.id::text
  for update;
  if not found then
    raise exception 'meeting interaction does not match the recording artifact'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(link.contact_id order by link.contact_id), '{}'::uuid[])
  into existing_ids
  from public.interaction_contacts link
  where link.tenant_id = p_tenant_id and link.interaction_id = interaction_id_value;
  exact_duplicate := transcript_row.processing_status = 'ready'
    and existing_ids = requested_ids
    and transcript_row.metadata -> 'confirmed_contact_ids' = to_jsonb(requested_ids);

  if exact_duplicate then
    return jsonb_build_object(
      'transcript_id', transcript_row.id,
      'owner_user_id', owner_user_id_value,
      'interaction_id', interaction_id_value,
      'confirmed_contact_ids', to_jsonb(requested_ids),
      'processing_status', 'ready',
      'baseline_enqueued', false,
      'duplicate', true
    );
  end if;

  -- A changed operator review cannot inherit a queued owner-confirmed baseline
  -- decision. Successful historical work is never silently reversed.
  for cancelled_job_id in
    update public.jobs job
      set status = 'cancelled',
        result = jsonb_build_object('outcome','cancelled','error_kind','conflict','error_code','meeting_contact_unconfirmed'),
        locked_at = null, lock_token = null, lease_expires_at = null,
        contact_updated_at_at_claim = null,
        last_error = 'meeting contacts were changed by an operator'
      where job.tenant_id = p_tenant_id
        and job.job_type in ('recording_baseline', 'recording_baseline_operator')
        and job.payload ->> 'transcript_id' = transcript_row.id::text
        and job.status in ('queued', 'running')
      returning job.id
  loop
    insert into public.audit_log (
      tenant_id, actor_user_id, actor_type, action, table_name, record_id, metadata
    ) values (
      p_tenant_id, p_actor_user_id, 'operator',
      'recording.baseline_cancelled_operator_review', 'jobs', cancelled_job_id,
      jsonb_build_object('transcript_id', transcript_row.id)
    );
  end loop;

  delete from public.interaction_contacts link
  where link.tenant_id = p_tenant_id
    and link.interaction_id = interaction_id_value
    and not (link.contact_id = any(requested_ids));
  foreach contact_id_value in array requested_ids loop
    insert into public.interaction_contacts (tenant_id, interaction_id, contact_id, role)
    values (p_tenant_id, interaction_id_value, contact_id_value, 'participant')
    on conflict (interaction_id, contact_id) do update
      set tenant_id = excluded.tenant_id, role = excluded.role;
  end loop;

  update public.transcripts
  set interaction_id = interaction_id_value,
    processing_status = 'ready',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'evidence_grade', case
          when metadata ->> 'evidence_grade' = 'owner_confirmed' then 'owner_confirmed'
          else 'operator_reviewed' end,
        'reviewed_by_operator', p_actor_user_id,
        'recording_owner_user_id', owner_user_id_value,
        'reviewed_at', now(),
        'confirmed_contact_ids', to_jsonb(requested_ids),
        'contacts_reviewed_at', now(),
        'contacts_reviewed_by_operator', p_actor_user_id
      ),
    updated_at = now()
  where tenant_id = p_tenant_id and id = transcript_row.id;

  if coalesce(transcript_row.metadata ->> 'evidence_grade', '') <> 'owner_confirmed' then
    update public.interactions interaction
    set metadata = coalesce(interaction.metadata, '{}'::jsonb) || jsonb_build_object(
      'evidence_grade', 'operator_reviewed',
      'reviewed_by_operator', p_actor_user_id,
      'recording_owner_user_id', owner_user_id_value,
      'reviewed_at', now(),
      'transcript_id', transcript_row.id
    )
    where interaction.tenant_id = p_tenant_id and interaction.id = interaction_id_value;
  end if;

  insert into public.audit_log (
      tenant_id, actor_user_id, actor_type, action,
      table_name, record_id, before, after, metadata
    ) values (
      p_tenant_id, p_actor_user_id, 'operator',
      'recording.artifact_reviewed_by_operator', 'transcripts', transcript_row.id,
      jsonb_build_object('confirmed_contact_ids', to_jsonb(existing_ids)),
      jsonb_build_object('confirmed_contact_ids', to_jsonb(requested_ids)),
      jsonb_build_object(
        'owner_user_id', owner_user_id_value,
        'interaction_id', interaction_id_value,
        'contact_count', cardinality(requested_ids),
        'baseline_mode', case
          when coalesce(transcript_row.metadata ->> 'evidence_grade', '') = 'owner_confirmed'
            then 'preserve_owner_confirmation'
          else 'owner_proposal_only' end
      )
    );

  if coalesce(transcript_row.metadata ->> 'evidence_grade', '') <> 'owner_confirmed' then
    enqueue_result := public.lbb_enqueue_operator_recording_baseline(
      p_tenant_id, transcript_row.id, p_actor_user_id
    );
  end if;

  return jsonb_build_object(
    'transcript_id', transcript_row.id,
    'owner_user_id', owner_user_id_value,
    'interaction_id', interaction_id_value,
    'confirmed_contact_ids', to_jsonb(requested_ids),
    'processing_status', 'ready',
    'baseline_enqueued', coalesce((enqueue_result ->> 'enqueued_count')::integer, 0) > 0,
    'baseline_enqueued_count', coalesce((enqueue_result ->> 'enqueued_count')::integer, 0),
    'duplicate', false
  );
end;
$$;

revoke all on function public.lbb_operator_confirm_meeting_contacts(
  uuid,uuid,uuid,uuid[],timestamptz
) from public, anon, authenticated;
grant execute on function public.lbb_operator_confirm_meeting_contacts(
  uuid,uuid,uuid,uuid[],timestamptz
) to service_role;

-- Owners may repair the attendee set after an operator-reviewed meeting is
-- ready, but the evidence grade and baseline mode stay operator/proposal-only.
create or replace function public.lbb_owner_repair_operator_meeting_contacts(
  p_tenant_id uuid,
  p_transcript_id uuid,
  p_actor_user_id uuid,
  p_contact_ids uuid[],
  p_expected_transcript_updated_at timestamptz
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
  operator_user_id_value uuid;
  contact_id_value uuid;
  cancelled_job_id uuid;
  enqueue_result jsonb := '{}'::jsonb;
begin
  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id=p_tenant_id and member.user_id=p_actor_user_id
      and member.status='active' and member.role='owner'
  ) then
    raise exception 'active recording owner access required' using errcode='42501';
  end if;
  select coalesce(array_agg(distinct requested_id order by requested_id),'{}'::uuid[])
  into requested_ids
  from unnest(coalesce(p_contact_ids,'{}'::uuid[])) requested(requested_id)
  where requested_id is not null;
  if cardinality(requested_ids)=0 or cardinality(requested_ids)>25 then
    raise exception 'between one and twenty-five confirmed meeting contacts are required'
      using errcode='22023';
  end if;
  if exists (
    select 1 from unnest(requested_ids) requested_id
    where not exists (
      select 1 from public.contacts contact
      where contact.tenant_id=p_tenant_id and contact.id=requested_id
        and contact.archived_at is null
    )
  ) then
    raise exception 'meeting contacts must be active and belong to the tenant'
      using errcode='22023';
  end if;

  select * into transcript_row
  from public.transcripts transcript
  where transcript.tenant_id=p_tenant_id and transcript.id=p_transcript_id
  for update;
  if not found or transcript_row.owner_user_id is distinct from p_actor_user_id
    or transcript_row.processing_status<>'ready'
    or transcript_row.interaction_id is null
    or transcript_row.metadata->>'evidence_grade'<>'operator_reviewed' then
    raise exception 'operator-reviewed recording artifact not found' using errcode='22023';
  end if;
  if transcript_row.metadata->>'reviewed_by_operator'
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'operator review identity is invalid' using errcode='22023';
  end if;
  operator_user_id_value := (transcript_row.metadata->>'reviewed_by_operator')::uuid;
  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id=p_tenant_id and member.user_id=operator_user_id_value
      and member.status='active' and member.role in ('owner','operator')
  ) then
    raise exception 'recording operator is no longer active' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.interactions interaction
    where interaction.tenant_id=p_tenant_id
      and interaction.id=transcript_row.interaction_id
      and interaction.interaction_type='meeting'
      and interaction.metadata->>'evidence_grade'='operator_reviewed'
      and interaction.metadata->>'transcript_id'=transcript_row.id::text
  ) then
    raise exception 'operator-reviewed meeting interaction is required' using errcode='22023';
  end if;
  select coalesce(array_agg(value::uuid order by value::uuid),'{}'::uuid[])
  into stored_ids
  from jsonb_array_elements_text(
    case when jsonb_typeof(transcript_row.metadata->'confirmed_contact_ids')='array'
      then transcript_row.metadata->'confirmed_contact_ids' else '[]'::jsonb end
  ) ids(value)
  where value~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  if stored_ids=requested_ids then
    return jsonb_build_object('transcript_id',transcript_row.id,
      'confirmed_contact_ids',to_jsonb(requested_ids),'baseline_enqueued_count',0,
      'duplicate',true);
  end if;
  if p_expected_transcript_updated_at is null
    or transcript_row.updated_at is distinct from p_expected_transcript_updated_at then
    raise exception 'recording participants changed after the page loaded' using errcode='40001';
  end if;

  for cancelled_job_id in
    update public.jobs job set status='cancelled',
      result=jsonb_build_object('outcome','cancelled','error_kind','conflict',
        'error_code','meeting_contact_unconfirmed'),
      locked_at=null,lock_token=null,lease_expires_at=null,
      contact_updated_at_at_claim=null,last_error='meeting contacts were changed by the owner'
    where job.tenant_id=p_tenant_id
      and job.job_type in ('recording_baseline','recording_baseline_operator')
      and job.payload->>'transcript_id'=transcript_row.id::text
      and job.status in ('queued','running')
    returning job.id
  loop
    insert into public.audit_log (
      tenant_id,actor_user_id,actor_type,action,table_name,record_id,metadata
    ) values (
      p_tenant_id,p_actor_user_id,'client','recording.baseline_cancelled_owner_contact_repair',
      'jobs',cancelled_job_id,jsonb_build_object('transcript_id',transcript_row.id)
    );
  end loop;
  delete from public.interaction_contacts link
  where link.tenant_id=p_tenant_id and link.interaction_id=transcript_row.interaction_id
    and not (link.contact_id=any(requested_ids));
  foreach contact_id_value in array requested_ids loop
    insert into public.interaction_contacts (tenant_id,interaction_id,contact_id,role)
    values (p_tenant_id,transcript_row.interaction_id,contact_id_value,'participant')
    on conflict (interaction_id,contact_id) do update
      set tenant_id=excluded.tenant_id,role=excluded.role;
  end loop;
  update public.transcripts transcript set
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'confirmed_contact_ids',to_jsonb(requested_ids),
      'contacts_reviewed_at',now(),
      'contacts_reviewed_by_owner',p_actor_user_id
    ),updated_at=now()
  where transcript.tenant_id=p_tenant_id and transcript.id=transcript_row.id;
  insert into public.audit_log (
    tenant_id,actor_user_id,actor_type,action,table_name,record_id,before,after,metadata
  ) values (
    p_tenant_id,p_actor_user_id,'client','recording.meeting_contacts_repaired_by_owner',
    'transcripts',transcript_row.id,
    jsonb_build_object('confirmed_contact_ids',to_jsonb(stored_ids)),
    jsonb_build_object('confirmed_contact_ids',to_jsonb(requested_ids)),
    jsonb_build_object('evidence_grade','operator_reviewed',
      'baseline_mode','owner_proposal_only','reviewed_by_operator',operator_user_id_value)
  );
  enqueue_result:=public.lbb_enqueue_operator_recording_baseline(
    p_tenant_id,transcript_row.id,operator_user_id_value
  );
  return jsonb_build_object('transcript_id',transcript_row.id,
    'confirmed_contact_ids',to_jsonb(requested_ids),
    'baseline_enqueued_count',coalesce((enqueue_result->>'enqueued_count')::integer,0),
    'duplicate',false);
end;
$$;

revoke all on function public.lbb_owner_repair_operator_meeting_contacts(
  uuid,uuid,uuid,uuid[],timestamptz
) from public, anon, authenticated;
grant execute on function public.lbb_owner_repair_operator_meeting_contacts(
  uuid,uuid,uuid,uuid[],timestamptz
) to service_role;

create or replace function public.lbb_operator_dismiss_meeting_artifact(
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
  cancelled_job record;
begin
  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id=p_tenant_id and member.user_id=p_actor_user_id
      and member.status='active' and member.role in ('owner','operator')
  ) then
    raise exception 'active recording operator access required' using errcode='42501';
  end if;
  select * into transcript_row
  from public.transcripts transcript
  where transcript.tenant_id=p_tenant_id and transcript.id=p_transcript_id
  for update;
  if not found or transcript_row.owner_user_id is null then
    raise exception 'recording artifact not found' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.tenant_members owner_member
    where owner_member.tenant_id=p_tenant_id
      and owner_member.user_id=transcript_row.owner_user_id
      and owner_member.status='active' and owner_member.role='owner'
  ) then
    raise exception 'recording owner is not an active tenant owner' using errcode='42501';
  end if;
  if transcript_row.processing_status='dismissed'
    and transcript_row.metadata->>'dismissed_by_operator'=p_actor_user_id::text then
    return jsonb_build_object('transcript_id',transcript_row.id,
      'owner_user_id',transcript_row.owner_user_id,'status','dismissed','duplicate',true);
  end if;
  if transcript_row.processing_status<>'review' or transcript_row.interaction_id is not null then
    raise exception 'only an unaccepted review artifact may be dismissed' using errcode='40001';
  end if;

  update public.recording_followups followup
  set status='dismissed',route='dismiss',contact_id=null,due_on=null,
    resolution_note=null,target_table=null,target_id=null,
    resolved_by=p_actor_user_id,resolved_at=now(),
    metadata=coalesce(followup.metadata,'{}'::jsonb)
      - 'decided_by_owner' - 'owner_approved'
      || jsonb_build_object('decided_by_operator',p_actor_user_id,
        'recording_owner_user_id',transcript_row.owner_user_id,
        'resolution_outcome','decline')
  where followup.tenant_id=p_tenant_id and followup.transcript_id=transcript_row.id
    and followup.status in ('proposed','pending');

  for cancelled_job in
    update public.jobs job
    set status='cancelled',lock_token=null,locked_at=null,lease_expires_at=null,
      contact_updated_at_at_claim=null,last_error='recording artifact dismissed by operator',
      result=jsonb_build_object('outcome','cancelled','error_kind','conflict',
        'error_code','recording_artifact_dismissed')
    where job.tenant_id=p_tenant_id
      and job.job_type in ('recording_baseline','recording_baseline_operator')
      and job.status in ('queued','running')
      and job.payload->>'transcript_id'=transcript_row.id::text
    returning job.id,job.payload
  loop
    insert into public.audit_log (
      tenant_id,actor_user_id,actor_type,action,table_name,record_id,metadata
    ) values (
      p_tenant_id,p_actor_user_id,'operator','recording.baseline_cancelled_operator_dismissal',
      'jobs',cancelled_job.id,jsonb_build_object('transcript_id',transcript_row.id,
        'owner_user_id',transcript_row.owner_user_id,'contact_id',cancelled_job.payload->'contact_id')
    );
  end loop;

  update public.transcripts transcript
  set processing_status='dismissed',interaction_id=null,
    metadata=coalesce(transcript.metadata,'{}'::jsonb) || jsonb_build_object(
      'evidence_grade','dismissed','dismissed_by_operator',p_actor_user_id,
      'recording_owner_user_id',transcript_row.owner_user_id,'dismissed_at',now()),
    updated_at=now()
  where transcript.tenant_id=p_tenant_id and transcript.id=transcript_row.id;
  insert into public.audit_log (
    tenant_id,actor_user_id,actor_type,action,table_name,record_id,metadata
  ) values (
    p_tenant_id,p_actor_user_id,'operator','recording.artifact_dismissed_by_operator',
    'transcripts',transcript_row.id,jsonb_build_object('owner_user_id',transcript_row.owner_user_id)
  );
  return jsonb_build_object('transcript_id',transcript_row.id,
    'owner_user_id',transcript_row.owner_user_id,'status','dismissed','duplicate',false);
end;
$$;

revoke all on function public.lbb_operator_dismiss_meeting_artifact(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.lbb_operator_dismiss_meeting_artifact(uuid,uuid,uuid)
  to service_role;

create or replace function public.lbb_operator_decide_recording_followup(
  p_tenant_id uuid,
  p_followup_id uuid,
  p_actor_user_id uuid,
  p_classification text,
  p_outcome text,
  p_contact_id uuid,
  p_due_on date,
  p_note text,
  p_meeting_contact_ids uuid[],
  p_expected_transcript_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  followup_row public.recording_followups%rowtype;
  transcript_row public.transcripts%rowtype;
  owner_user_id_value uuid;
  normalized_outcome text := case
    when p_outcome = 'keep_open' then 'approve'
    when p_outcome = 'not_followup' then 'decline'
    else p_outcome end;
  clean_note text := nullif(left(trim(coalesce(p_note, '')), 1000), '');
  target_id_value uuid;
  target_table_value text;
  route_value text;
  status_value text;
  confirmed_ids uuid[] := '{}'::uuid[];
  confirm_result jsonb;
begin
  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id = p_tenant_id
      and member.user_id = p_actor_user_id
      and member.status = 'active' and member.role in ('owner', 'operator')
  ) then
    raise exception 'active recording operator access required' using errcode = '42501';
  end if;
  if normalized_outcome is null or normalized_outcome not in ('approve','already_done','decline') then
    raise exception 'unsupported recording follow-up outcome' using errcode = '22023';
  end if;
  if normalized_outcome = 'approve'
    and (p_classification is null or p_classification not in ('action','owner_promise','contact_promise')) then
    raise exception 'unsupported recording follow-up classification' using errcode = '22023';
  end if;

  select * into followup_row
  from public.recording_followups followup
  where followup.tenant_id = p_tenant_id and followup.id = p_followup_id
  for update;
  if not found then raise exception 'recording follow-up not found' using errcode = '22023'; end if;
  select * into transcript_row
  from public.transcripts transcript
  where transcript.tenant_id = p_tenant_id and transcript.id = followup_row.transcript_id
  for update;
  if not found or transcript_row.owner_user_id is null then
    raise exception 'recording artifact not found' using errcode = '22023';
  end if;
  owner_user_id_value := transcript_row.owner_user_id;
  if followup_row.owner_user_id is distinct from owner_user_id_value or not exists (
    select 1 from public.tenant_members owner_member
    where owner_member.tenant_id = p_tenant_id
      and owner_member.user_id = owner_user_id_value
      and owner_member.status = 'active' and owner_member.role = 'owner'
  ) then
    raise exception 'recording owner boundary is invalid' using errcode = '42501';
  end if;

  route_value := case
    when normalized_outcome = 'already_done' then 'already_done'
    when normalized_outcome = 'decline' then 'dismiss'
    else p_classification end;
  status_value := case
    when normalized_outcome = 'already_done' then 'completed'
    when normalized_outcome = 'decline' then 'dismissed'
    else 'routed' end;

  if followup_row.status not in ('proposed','pending') then
    if followup_row.status = status_value and followup_row.route = route_value
      and followup_row.contact_id is not distinct from (
        case when normalized_outcome='decline' then null else p_contact_id end
      )
      and followup_row.due_on is not distinct from (
        case when normalized_outcome='approve' then p_due_on else null end
      )
      and followup_row.resolution_note is not distinct from clean_note
      and followup_row.metadata ->> 'decided_by_operator' = p_actor_user_id::text then
      return jsonb_build_object(
        'followup_id', followup_row.id, 'owner_user_id', owner_user_id_value,
        'status', followup_row.status, 'route', followup_row.route,
        'target_table', followup_row.target_table, 'target_id', followup_row.target_id,
        'duplicate', true
      );
    end if;
    raise exception 'recording follow-up was already resolved' using errcode = '40001';
  end if;

  if transcript_row.processing_status not in ('review','ready') then
    raise exception 'recording artifact is not available for decisions' using errcode = '22023';
  end if;
  if normalized_outcome = 'approve' and p_contact_id is null then
    raise exception 'an active contact is required for this follow-up' using errcode = '22023';
  end if;
  if p_contact_id is not null and not exists (
    select 1 from public.contacts contact
    where contact.tenant_id = p_tenant_id and contact.id = p_contact_id and contact.archived_at is null
  ) then
    raise exception 'active contact not found in tenant' using errcode = '22023';
  end if;

  if p_expected_transcript_updated_at is null
    or transcript_row.updated_at is distinct from p_expected_transcript_updated_at then
    raise exception 'recording artifact changed after the page loaded' using errcode = '40001';
  end if;

  if normalized_outcome = 'approve' and p_classification in ('owner_promise','contact_promise') then
    insert into public.promises (
      tenant_id, owner_user_id, contact_id, interaction_id, direction,
      promise_text, status, due_on, source, evidence, review_status
    ) values (
      p_tenant_id, owner_user_id_value, p_contact_id, transcript_row.interaction_id,
      case when p_classification='owner_promise' then 'owner_owes_contact' else 'contact_owes_owner' end,
      followup_row.followup_text, 'pending_review', p_due_on, 'recording_followup',
      jsonb_build_object(
        'recording_followup_id', followup_row.id,
        'transcript_id', transcript_row.id,
        'operator_routed_by', p_actor_user_id,
        'owner_review_pending', true
      ),
      'pending_owner'
    ) returning id into target_id_value;
    target_table_value := 'promises';
  elsif normalized_outcome = 'approve' and p_classification = 'action' then
    insert into public.pending_changes (
      tenant_id, contact_id, change_type, summary, payload, status,
      risk_level, source, proposed_by, idempotency_key
    ) values (
      p_tenant_id, p_contact_id, 'recording_action',
      'Review an operator-classified meeting follow-up.',
      jsonb_build_object(
        'owner_user_id', owner_user_id_value,
        'recording_followup_id', followup_row.id,
        'transcript_id', transcript_row.id,
        'meeting', jsonb_build_object(
          'title', transcript_row.title,
          'occurred_at', transcript_row.occurred_at,
          'source', transcript_row.source
        ),
        'evidence', jsonb_build_object(
          'source_type', 'recording_followup',
          'evidence_summary', followup_row.followup_text
        ),
        'action', jsonb_build_object(
          'title', followup_row.followup_text,
          'due_on', p_due_on,
          'note', clean_note,
          'contact_id', p_contact_id
        ),
        'operator_routed_by', p_actor_user_id,
        'owner_review_pending', true
      ),
      'pending', 'low', 'recording_operator', 'operator',
      left('recording-operator-action:' || followup_row.id::text, 240)
    )
    on conflict (tenant_id, idempotency_key) where idempotency_key is not null
    do nothing returning id into target_id_value;
    if target_id_value is null then
      select change.id into target_id_value
      from public.pending_changes change
      where change.tenant_id = p_tenant_id
        and change.idempotency_key = left('recording-operator-action:' || followup_row.id::text, 240)
      for update;
    end if;
    target_table_value := 'pending_changes';
  end if;

  update public.recording_followups followup
  set status = status_value,
    route = route_value,
    contact_id = case when normalized_outcome='decline' then null else p_contact_id end,
    due_on = case when normalized_outcome='approve' then p_due_on else null end,
    resolution_note = clean_note,
    target_table = target_table_value,
    target_id = target_id_value,
    resolved_by = p_actor_user_id,
    resolved_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb)
      - 'decided_by_owner' - 'owner_approved'
      || jsonb_build_object(
        'review_decision', normalized_outcome,
        'resolution_outcome', normalized_outcome,
        'classification', case when normalized_outcome='approve' then p_classification else null end,
        'decided_by_operator', p_actor_user_id,
        'recording_owner_user_id', owner_user_id_value,
        'owner_review_pending', normalized_outcome='approve'
      )
  where followup.id = followup_row.id;

  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action,
    table_name, record_id, before, after, metadata
  ) values (
    p_tenant_id, p_actor_user_id, 'operator',
    'recording.followup_' || normalized_outcome || '_by_operator',
    'recording_followups', followup_row.id,
    jsonb_build_object('status', followup_row.status),
    jsonb_build_object('status', status_value, 'route', route_value, 'target_table', target_table_value, 'target_id', target_id_value),
    jsonb_build_object('owner_user_id', owner_user_id_value, 'contact_id', case when normalized_outcome='decline' then null else p_contact_id end)
  );

  if not exists (
    select 1 from public.recording_followups unresolved
    where unresolved.tenant_id = p_tenant_id
      and unresolved.transcript_id = transcript_row.id
      and unresolved.status in ('proposed','pending')
  ) then
    select coalesce(array_agg(distinct contact_id order by contact_id), '{}'::uuid[])
    into confirmed_ids
    from unnest(coalesce(p_meeting_contact_ids, '{}'::uuid[])) requested(contact_id)
    where contact_id is not null;
    if cardinality(confirmed_ids) = 0 then
      select coalesce(array_agg(distinct candidate.contact_id order by candidate.contact_id), '{}'::uuid[])
      into confirmed_ids
      from (
        select decided.contact_id
        from public.recording_followups decided
        where decided.tenant_id=p_tenant_id and decided.transcript_id=transcript_row.id and decided.contact_id is not null
        union
        select stored.value::uuid
        from jsonb_array_elements_text(
          case when jsonb_typeof(transcript_row.metadata -> 'confirmed_contact_ids')='array'
            then transcript_row.metadata -> 'confirmed_contact_ids' else '[]'::jsonb end
        ) stored(value)
        where stored.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        union
        select attendee.matched_contact_id
        from public.calendar_attendees attendee
        where attendee.tenant_id=p_tenant_id
          and attendee.owner_user_id=owner_user_id_value
          and attendee.matched_contact_id is not null
          and transcript_row.metadata ->> 'calendar_match_event_id'
            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and attendee.event_id=(transcript_row.metadata ->> 'calendar_match_event_id')::uuid
      ) candidate
      join public.contacts contact on contact.tenant_id=p_tenant_id
        and contact.id=candidate.contact_id and contact.archived_at is null;
    end if;
    if cardinality(confirmed_ids) = 0 then
      raise exception 'confirm at least one meeting contact before finalizing' using errcode = '22023';
    end if;
    confirm_result := public.lbb_operator_confirm_meeting_contacts(
      p_tenant_id, transcript_row.id, p_actor_user_id, confirmed_ids,
      p_expected_transcript_updated_at
    );
    if transcript_row.interaction_id is null then
      update public.promises promise
      set interaction_id = nullif(confirm_result ->> 'interaction_id','')::uuid
      where promise.tenant_id=p_tenant_id
        and promise.interaction_id is null
        and promise.id in (
          select decided.target_id
          from public.recording_followups decided
          where decided.tenant_id=p_tenant_id
            and decided.transcript_id=transcript_row.id
            and decided.target_table='promises'
            and decided.target_id is not null
        );
    end if;
  end if;

  return jsonb_build_object(
    'followup_id', followup_row.id, 'owner_user_id', owner_user_id_value,
    'outcome', normalized_outcome,
    'classification', case when normalized_outcome='approve' then p_classification else null end,
    'route', route_value, 'status', status_value,
    'target_table', target_table_value, 'target_id', target_id_value,
    'owner_review_pending', normalized_outcome='approve',
    'duplicate', false
  );
end;
$$;

revoke all on function public.lbb_operator_decide_recording_followup(
  uuid,uuid,uuid,text,text,uuid,date,text,uuid[],timestamptz
) from public, anon, authenticated;
grant execute on function public.lbb_operator_decide_recording_followup(
  uuid,uuid,uuid,text,text,uuid,date,text,uuid[],timestamptz
) to service_role;

create or replace function public.lbb_review_operator_routed_promise(
  p_tenant_id uuid,
  p_promise_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  promise_row public.promises%rowtype;
  next_review_status text;
begin
  if p_decision is null or p_decision not in ('accept','already_done','decline') then
    raise exception 'promise review decision must be accept, already_done, or decline' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id=p_tenant_id and member.user_id=p_actor_user_id
      and member.status='active' and member.role='owner'
  ) then
    raise exception 'active recording owner access required' using errcode = '42501';
  end if;
  next_review_status := case when p_decision in ('accept','already_done') then 'accepted' else 'declined' end;
  select * into promise_row
  from public.promises promise
  where promise.tenant_id=p_tenant_id and promise.id=p_promise_id
    and promise.owner_user_id=p_actor_user_id
    and promise.source='recording_followup'
  for update;
  if not found then raise exception 'operator-routed promise not found' using errcode = '22023'; end if;
  if not exists (
    select 1
    from public.recording_followups followup
    join public.transcripts transcript
      on transcript.tenant_id=followup.tenant_id and transcript.id=followup.transcript_id
    where followup.tenant_id=p_tenant_id
      and followup.target_table='promises' and followup.target_id=promise_row.id
      and followup.owner_user_id=p_actor_user_id
      and followup.contact_id=promise_row.contact_id
      and followup.followup_text=promise_row.promise_text
      and followup.status='routed'
      and followup.route=case when promise_row.direction='owner_owes_contact'
        then 'owner_promise' else 'contact_promise' end
      and transcript.owner_user_id=p_actor_user_id
      and transcript.processing_status='ready'
  ) then
    raise exception 'operator-routed promise evidence linkage is invalid' using errcode='22023';
  end if;
  if promise_row.review_status = next_review_status
    and promise_row.status = (
      case when p_decision='accept' then 'open'
        when p_decision='already_done' then 'completed' else 'skipped' end
    )
    and promise_row.evidence->'owner_review'->>'decision'=p_decision then
    return jsonb_build_object('promise_id',promise_row.id,'review_status',promise_row.review_status,'status',promise_row.status,'duplicate',true);
  end if;
  if promise_row.review_status <> 'pending_owner' then
    raise exception 'operator-routed promise was already reviewed' using errcode = '40001';
  end if;
  if p_expected_updated_at is null or promise_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'promise changed after the page loaded' using errcode = '40001';
  end if;

  update public.promises promise
  set review_status=next_review_status,
    status=case when p_decision='accept' then 'open'
      when p_decision='already_done' then 'completed' else 'skipped' end,
    completed_at=case when p_decision='already_done' then now() else null end,
    reviewed_by=p_actor_user_id,
    reviewed_at=now(),
    evidence=coalesce(evidence,'{}'::jsonb)
      - 'owner_review_pending'
      || jsonb_build_object(
        'owner_review', jsonb_build_object('decision',p_decision,'reviewed_by',p_actor_user_id,'reviewed_at',now())
      )
  where promise.id=promise_row.id and promise.review_status='pending_owner';
  if not found then raise exception 'promise changed during review' using errcode='40001'; end if;

  insert into public.audit_log (
    tenant_id,actor_user_id,actor_type,action,table_name,record_id,before,after,metadata
  ) values (
    p_tenant_id,p_actor_user_id,'client','promise.operator_proposal_' || case
      when p_decision='accept' then 'accepted'
      when p_decision='already_done' then 'completed'
      else 'declined'
    end,
    'promises',promise_row.id,
    jsonb_build_object('review_status',promise_row.review_status,'status',promise_row.status),
    jsonb_build_object('review_status',next_review_status,'status',case when p_decision='accept' then 'open'
      when p_decision='already_done' then 'completed' else 'skipped' end),
    jsonb_build_object('recording_followup_id',promise_row.evidence->'recording_followup_id')
  );
  return jsonb_build_object('promise_id',promise_row.id,'review_status',next_review_status,
    'status',case when p_decision='accept' then 'open'
      when p_decision='already_done' then 'completed' else 'skipped' end,'duplicate',false);
end;
$$;

revoke all on function public.lbb_review_operator_routed_promise(uuid,uuid,uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.lbb_review_operator_routed_promise(uuid,uuid,uuid,text,timestamptz)
  to service_role;

create or replace function public.lbb_review_operator_recording_action(
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
  action_payload jsonb;
  contact_id_value uuid;
  action_id_value uuid;
  next_status text;
begin
  if p_decision is null or p_decision not in ('approve','decline') then
    raise exception 'recording action review decision must be approve or decline' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.tenant_members member
    where member.tenant_id=p_tenant_id and member.user_id=p_actor_user_id
      and member.status='active' and member.role='owner'
  ) then
    raise exception 'active recording owner access required' using errcode='42501';
  end if;
  select * into change_row
  from public.pending_changes change
  where change.tenant_id=p_tenant_id and change.id=p_change_id
    and change.source='recording_operator' and change.change_type='recording_action'
    and change.payload->>'owner_user_id'=p_actor_user_id::text
  for update;
  if not found then raise exception 'operator-routed recording action not found' using errcode='22023'; end if;
  next_status := case when p_decision='approve' then 'approved' else 'dismissed' end;
  if change_row.status=next_status then
    return jsonb_build_object('change_id',change_row.id,'status',change_row.status,
      'action_id',change_row.payload->'owner_review'->'action_id','duplicate',true);
  end if;
  if change_row.status<>'pending' then
    raise exception 'operator-routed recording action was already reviewed' using errcode='40001';
  end if;
  action_payload := change_row.payload->'action';
  if jsonb_typeof(action_payload)<>'object'
    or jsonb_typeof(action_payload->'title')<>'string'
    or length(trim(action_payload->>'title')) not between 1 and 1000
    or coalesce(action_payload->>'contact_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (action_payload->>'due_on' is not null and action_payload->>'due_on' !~ '^\d{4}-\d{2}-\d{2}$') then
    raise exception 'operator-routed recording action payload is invalid' using errcode='22023';
  end if;
  contact_id_value := (action_payload->>'contact_id')::uuid;
  if change_row.contact_id is distinct from contact_id_value or not exists (
    select 1 from public.contacts contact
    where contact.tenant_id=p_tenant_id and contact.id=contact_id_value and contact.archived_at is null
  ) then
    raise exception 'active recording action contact not found in tenant' using errcode='22023';
  end if;
  if not exists (
    select 1
    from public.recording_followups followup
    join public.transcripts transcript
      on transcript.tenant_id=followup.tenant_id and transcript.id=followup.transcript_id
    where followup.tenant_id=p_tenant_id
      and followup.target_table='pending_changes' and followup.target_id=change_row.id
      and followup.owner_user_id=p_actor_user_id
      and followup.contact_id=change_row.contact_id
      and followup.followup_text=action_payload->>'title'
      and followup.due_on is not distinct from nullif(action_payload->>'due_on','')::date
      and followup.resolution_note is not distinct from nullif(action_payload->>'note','')
      and followup.status='routed' and followup.route='action'
      and transcript.owner_user_id=p_actor_user_id
      and transcript.processing_status='ready'
  ) then
    raise exception 'operator-routed recording action evidence linkage is invalid' using errcode='22023';
  end if;

  if p_decision='approve' then
    insert into public.relationship_actions (
      tenant_id,contact_id,title,action_type,status,priority,due_on,source,notes,metadata,created_by
    ) values (
      p_tenant_id,contact_id_value,left(trim(action_payload->>'title'),240),
      'follow_up','open','normal',nullif(action_payload->>'due_on','')::date,
      'recording_followup',nullif(left(trim(coalesce(action_payload->>'note','')),1000),''),
      jsonb_build_object('pending_change_id',change_row.id,'recording_followup_id',change_row.payload->'recording_followup_id'),
      p_actor_user_id
    ) returning id into action_id_value;
  end if;

  update public.pending_changes change
  set status=next_status,reviewed_by=p_actor_user_id,reviewed_at=now(),
    payload=change.payload || jsonb_build_object(
      'owner_review',jsonb_build_object('decision',p_decision,'reviewed_by',p_actor_user_id,'reviewed_at',now(),'action_id',action_id_value)
    )
  where change.id=change_row.id and change.status='pending';
  if not found then raise exception 'recording action changed during review' using errcode='40001'; end if;
  insert into public.audit_log (
    tenant_id,actor_user_id,actor_type,action,table_name,record_id,before,after,metadata
  ) values (
    p_tenant_id,p_actor_user_id,'client','recording.operator_action_' || next_status,
    'pending_changes',change_row.id,
    jsonb_build_object('status',change_row.status),jsonb_build_object('status',next_status,'action_id',action_id_value),
    jsonb_build_object('contact_id',contact_id_value,'recording_followup_id',change_row.payload->'recording_followup_id')
  );
  return jsonb_build_object('change_id',change_row.id,'status',next_status,'action_id',action_id_value,'duplicate',false);
end;
$$;

revoke all on function public.lbb_review_operator_recording_action(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.lbb_review_operator_recording_action(uuid,uuid,uuid,text)
 to service_role;

-- The app may present an allowlisted stored owner in effective operator mode.
-- These RPCs remain service-role-only; broaden only their stored membership
-- predicate so the guarded server caller can preserve the real actor identity.
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
      and role in ('owner', 'operator')
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
      and role in ('owner', 'operator')
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
      and role in ('owner', 'operator')
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
      and role in ('owner', 'operator')
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
      and status = 'active' and role in ('owner', 'operator')
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
      and role in ('owner', 'operator')
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

revoke all on function public.lbb_prepare_recording_connection(uuid,uuid,uuid,uuid,text,uuid)
  from public, anon, authenticated;
revoke all on function public.lbb_upsert_recording_connection(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.lbb_abandon_recording_connection_provisioning(uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.lbb_mark_recording_provisioning_cleanup_pending(uuid,uuid,uuid,uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.lbb_ensure_manual_recording_connection(uuid,uuid,uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.lbb_confirm_recording_upstream_revoked(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.lbb_prepare_recording_connection(uuid,uuid,uuid,uuid,text,uuid)
  to service_role;
grant execute on function public.lbb_upsert_recording_connection(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text)
  to service_role;
grant execute on function public.lbb_abandon_recording_connection_provisioning(uuid,uuid,uuid,uuid)
  to service_role;
grant execute on function public.lbb_mark_recording_provisioning_cleanup_pending(uuid,uuid,uuid,uuid,text,text)
  to service_role;
grant execute on function public.lbb_ensure_manual_recording_connection(uuid,uuid,uuid,text,text)
  to service_role;
grant execute on function public.lbb_confirm_recording_upstream_revoked(uuid,uuid,uuid)
  to service_role;
