-- Collapse meeting review and follow-up filing into one owner decision per item.
-- The final decision automatically confirms the meeting interaction, so there is
-- no second "finish review" step. Existing callers remain compatible through
-- the legacy outcome aliases.

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
  meeting_processed boolean := false;
begin
  if normalized_outcome = 'approve'
    and (
      p_classification is null
      or p_classification not in ('action', 'owner_promise', 'contact_promise')
    )
  then
    raise exception 'unsupported recording follow-up classification' using errcode = '22023';
  end if;
  if normalized_outcome is null
    or normalized_outcome not in ('approve', 'already_done', 'decline')
  then
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
  persisted_classification := case
    when normalized_outcome = 'approve' then p_classification
    else null
  end;
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
      and nullif(followup_row.metadata->>'classification', '')
        is not distinct from persisted_classification
    then
      return jsonb_build_object(
        'followup_id', followup_row.id,
        'outcome', normalized_outcome,
        'classification', persisted_classification,
        'route', followup_row.route,
        'status', followup_row.status,
        'target_table', followup_row.target_table,
        'target_id', followup_row.target_id,
        'meeting_processed', transcript_row.processing_status = 'ready',
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
      ),
      p_actor_user_id
    ) returning id into created_target_id;
    created_target_table := 'relationship_actions';
  elsif normalized_outcome = 'approve'
    and p_classification in ('owner_promise', 'contact_promise')
  then
    insert into public.promises (
      tenant_id, contact_id, interaction_id, direction, promise_text,
      status, due_on, source, evidence
    ) values (
      p_tenant_id, p_contact_id, transcript_row.interaction_id,
      case when p_classification = 'owner_promise'
        then 'owner_owes_contact' else 'contact_owes_owner' end,
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

  if transcript_row.processing_status = 'review'
    and not exists (
      select 1 from public.recording_followups unresolved
      where unresolved.tenant_id = p_tenant_id
        and unresolved.transcript_id = followup_row.transcript_id
        and unresolved.status in ('proposed', 'pending')
    )
  then
    select coalesce(array_agg(distinct candidate.contact_id), '{}'::uuid[])
    into meeting_contact_ids
    from (
      select decided.contact_id
      from public.recording_followups decided
      where decided.tenant_id = p_tenant_id
        and decided.transcript_id = followup_row.transcript_id
        and decided.contact_id is not null
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

    acceptance_result := public.lbb_accept_meeting_artifact(
      p_tenant_id,
      followup_row.transcript_id,
      p_actor_user_id,
      meeting_contact_ids
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
  elsif transcript_row.processing_status = 'ready' then
    meeting_processed := not exists (
      select 1 from public.recording_followups unresolved
      where unresolved.tenant_id = p_tenant_id
        and unresolved.transcript_id = followup_row.transcript_id
        and unresolved.status in ('proposed', 'pending')
    );
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
    'duplicate', false
  );
end;
$$;

revoke all on function public.lbb_decide_recording_followup(
  uuid, uuid, uuid, text, text, uuid, date, text
) from public, anon, authenticated;
grant execute on function public.lbb_decide_recording_followup(
  uuid, uuid, uuid, text, text, uuid, date, text
) to service_role;

-- Older proposals occasionally stored the contact id inside the payload instead
-- of the indexed column. Repair only active same-tenant references so Changes can
-- show the person's name and the existing value beside the proposed value.
update public.pending_changes change
set contact_id = (change.payload ->> 'contact_id')::uuid
where change.contact_id is null
  and change.status = 'pending'
  and change.payload ->> 'contact_id'
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (
    select 1 from public.contacts contact
    where contact.tenant_id = change.tenant_id
      and contact.id = (change.payload ->> 'contact_id')::uuid
      and contact.archived_at is null
  );
