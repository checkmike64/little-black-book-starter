-- Require an explicit owner decision for every proposed recording follow-up
-- before the meeting notes can enter relationship history.

alter table public.recording_followups
  drop constraint recording_followups_status_check;

alter table public.recording_followups
  drop constraint recording_followups_resolution_check;

alter table public.recording_followups
  add constraint recording_followups_status_check
  check (status in ('proposed', 'pending', 'routed', 'dismissed'));

alter table public.recording_followups
  add constraint recording_followups_resolution_check check (
    (status in ('proposed', 'pending') and route is null and target_table is null
      and target_id is null and resolved_at is null)
    or
    (status = 'routed' and route in (
      'action', 'owner_promise', 'contact_promise', 'context'
    ) and resolved_at is not null)
    or
    (status = 'dismissed' and route = 'dismiss'
      and target_table is null and target_id is null and resolved_at is not null)
  );

-- Existing unconfirmed meeting items were created as pending by the original
-- inbox migration. Move only review-stage rows into the new proposal state.
update public.recording_followups followup
set status = 'proposed',
  metadata = followup.metadata || jsonb_build_object(
    'review_decision', 'awaiting_owner',
    'review_migrated_at', now()
  )
from public.transcripts transcript
where transcript.tenant_id = followup.tenant_id
  and transcript.id = followup.transcript_id
  and transcript.processing_status = 'review'
  and followup.status = 'pending';

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
  seed_status text := case
    when p_processing_status = 'review' then 'proposed'
    when p_processing_status = 'ready' then 'pending'
    else 'dismissed'
  end;
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
      seed_status,
      case when seed_dismissed then 'dismiss' else null end,
      case when seed_dismissed then 'Meeting artifact dismissed before routing.' else null end,
      case when seed_dismissed then now() else null end,
      'recording_action_item',
      jsonb_build_object(
        'provider', left(coalesce(p_provider, 'unknown'), 80),
        'action_item_source', nullif(left(coalesce(item ->> 'source', ''), 80), ''),
        'action_item_timestamp', nullif(left(coalesce(item ->> 'timestamp', ''), 120), ''),
        'raw_transcript_stored', false,
        'transcript_evidence_grade', p_transcript_metadata ->> 'evidence_grade',
        'review_decision', case
          when seed_status = 'proposed' then 'awaiting_owner'
          when seed_status = 'pending' then 'confirmed'
          else 'dismissed_with_meeting'
        end
      )
    )
    on conflict (transcript_id, source_item_index) do update set
      followup_text = excluded.followup_text,
      assignee = excluded.assignee,
      assignee_email = excluded.assignee_email,
      owner_assigned = excluded.owner_assigned,
      metadata = public.recording_followups.metadata
        || (excluded.metadata - 'review_decision')
        || jsonb_build_object(
          'review_decision', coalesce(
            public.recording_followups.metadata ->> 'review_decision',
            excluded.metadata ->> 'review_decision'
          )
        ),
      status = case
        when public.recording_followups.status in ('proposed', 'pending') and seed_dismissed
          then 'dismissed'
        else public.recording_followups.status
      end,
      route = case
        when public.recording_followups.status in ('proposed', 'pending') and seed_dismissed
          then 'dismiss'
        else public.recording_followups.route
      end,
      resolution_note = case
        when public.recording_followups.status in ('proposed', 'pending') and seed_dismissed
          then 'Meeting artifact dismissed before routing.'
        else public.recording_followups.resolution_note
      end,
      resolved_at = case
        when public.recording_followups.status in ('proposed', 'pending') and seed_dismissed
          then now()
        else public.recording_followups.resolved_at
      end;
  end loop;

  if seed_dismissed then
    update public.recording_followups
    set status = 'dismissed', route = 'dismiss',
      resolution_note = coalesce(
        resolution_note, 'Meeting artifact dismissed before routing.'
      ), resolved_at = coalesce(resolved_at, now()),
      metadata = metadata || jsonb_build_object(
        'review_decision', 'dismissed_with_meeting'
      )
    where tenant_id = p_tenant_id
      and transcript_id = p_transcript_id
      and status in ('proposed', 'pending');
  end if;
end;
$$;

revoke all on function app_private.seed_recording_followups(
  uuid, uuid, uuid, text, text, jsonb, jsonb
) from public, anon, authenticated;

create or replace function public.lbb_review_recording_followup(
  p_tenant_id uuid,
  p_followup_id uuid,
  p_actor_user_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  transcript_id uuid;
  transcript_row public.transcripts%rowtype;
  followup_row public.recording_followups%rowtype;
  next_status text;
begin
  if p_decision not in ('confirm', 'dismiss') then
    raise exception 'unsupported recording follow-up decision' using errcode = '22023';
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

  select followup.transcript_id into transcript_id
  from public.recording_followups followup
  where followup.tenant_id = p_tenant_id
    and followup.id = p_followup_id
    and followup.owner_user_id = p_actor_user_id;
  if transcript_id is null then
    raise exception 'recording follow-up not found' using errcode = '22023';
  end if;

  select * into transcript_row
  from public.transcripts transcript
  where transcript.tenant_id = p_tenant_id
    and transcript.id = transcript_id
    and transcript.owner_user_id = p_actor_user_id
  for update;
  if not found then
    raise exception 'owned meeting artifact not found' using errcode = '42501';
  end if;

  select * into followup_row
  from public.recording_followups followup
  where followup.tenant_id = p_tenant_id
    and followup.id = p_followup_id
    and followup.owner_user_id = p_actor_user_id
  for update;

  if followup_row.status <> 'proposed' then
    if (p_decision = 'confirm' and followup_row.status = 'pending')
      or (p_decision = 'dismiss' and followup_row.status = 'dismissed'
        and followup_row.metadata ->> 'review_decision' = 'dismissed')
    then
      return jsonb_build_object(
        'followup_id', followup_row.id,
        'decision', p_decision,
        'status', followup_row.status,
        'duplicate', true
      );
    end if;
    raise exception 'recording follow-up was already decided' using errcode = '40001';
  end if;
  if transcript_row.processing_status <> 'review'
    or transcript_row.interaction_id is not null
  then
    raise exception 'meeting artifact is no longer awaiting review' using errcode = '40001';
  end if;

  next_status := case when p_decision = 'confirm' then 'pending' else 'dismissed' end;
  update public.recording_followups
  set status = next_status,
    route = case when p_decision = 'dismiss' then 'dismiss' else null end,
    resolution_note = case
      when p_decision = 'dismiss' then 'Dismissed during meeting review.'
      else null
    end,
    resolved_by = case when p_decision = 'dismiss' then p_actor_user_id else null end,
    resolved_at = case when p_decision = 'dismiss' then now() else null end,
    metadata = metadata || jsonb_build_object(
      'review_decision', case when p_decision = 'confirm' then 'confirmed' else 'dismissed' end,
      'reviewed_by_owner', true,
      'reviewed_at', now()
    )
  where id = followup_row.id;

  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action,
    table_name, record_id, before, after, metadata
  ) values (
    p_tenant_id, p_actor_user_id, 'client',
    'recording.followup_review_' || p_decision,
    'recording_followups', followup_row.id,
    jsonb_build_object('status', followup_row.status),
    jsonb_build_object('status', next_status, 'decision', p_decision),
    jsonb_build_object('transcript_id', followup_row.transcript_id)
  );

  return jsonb_build_object(
    'followup_id', followup_row.id,
    'decision', p_decision,
    'status', next_status,
    'duplicate', false
  );
end;
$$;

revoke all on function public.lbb_review_recording_followup(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.lbb_review_recording_followup(
  uuid, uuid, uuid, text
) to service_role;

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
  if exists (
    select 1 from public.recording_followups followup
    where followup.tenant_id = p_tenant_id
      and followup.transcript_id = p_transcript_id
      and followup.status = 'proposed'
  ) then
    raise exception 'decide every proposed follow-up before confirming the meeting'
      using errcode = '22023';
  end if;
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

revoke all on function public.lbb_accept_meeting_artifact(
  uuid, uuid, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.lbb_accept_meeting_artifact(
  uuid, uuid, uuid, uuid[]
) to service_role;
