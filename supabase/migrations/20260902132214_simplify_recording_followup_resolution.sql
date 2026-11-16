-- Replace internal routing choices with a single owner decision about state.
-- "Already done" is retained as auditable meeting evidence without creating a
-- synthetic completed task or promise in the active relationship ledgers.

alter table public.recording_followups
  drop constraint if exists recording_followups_status_check;
alter table public.recording_followups
  drop constraint if exists recording_followups_route_check;
alter table public.recording_followups
  drop constraint if exists recording_followups_resolution_check;
alter table public.recording_followups
  drop constraint if exists recording_followups_target_check;

alter table public.recording_followups
  add constraint recording_followups_status_check
  check (status in ('proposed', 'pending', 'routed', 'completed', 'dismissed'));

alter table public.recording_followups
  add constraint recording_followups_route_check
  check (route in (
    'action', 'owner_promise', 'contact_promise', 'context',
    'already_done', 'dismiss'
  ));

alter table public.recording_followups
  add constraint recording_followups_resolution_check check (
    (status in ('proposed', 'pending') and route is null
      and target_table is null and target_id is null and resolved_at is null)
    or
    (status = 'routed' and route is not null and route in (
      'action', 'owner_promise', 'contact_promise', 'context'
    ) and resolved_at is not null)
    or
    (status = 'completed' and route is not null and route = 'already_done'
      and target_table is null and target_id is null and due_on is null
      and resolved_at is not null)
    or
    (status = 'dismissed' and route is not null and route = 'dismiss'
      and target_table is null and target_id is null and resolved_at is not null)
  );

alter table public.recording_followups
  add constraint recording_followups_target_check check (
    (route is not null and route = 'action'
      and target_table is not null and target_table = 'relationship_actions'
      and target_id is not null)
    or
    (route is not null and route in ('owner_promise', 'contact_promise')
      and target_table is not null and target_table = 'promises'
      and target_id is not null)
    or
    (route is not null and route in ('context', 'already_done', 'dismiss')
      and target_table is null and target_id is null)
    or
    (route is null and target_table is null and target_id is null)
  );

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
  clean_note text := nullif(left(trim(coalesce(p_note, '')), 1000), '');
begin
  if p_outcome = 'keep_open'
    and (
      p_classification is null
      or p_classification not in ('action', 'owner_promise', 'contact_promise')
    )
  then
    raise exception 'unsupported recording follow-up classification' using errcode = '22023';
  end if;
  if p_outcome is null
    or p_outcome not in ('keep_open', 'already_done', 'not_followup')
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
    when p_outcome = 'already_done' then 'already_done'
    when p_outcome = 'not_followup' then 'dismiss'
    else p_classification
  end;
  persisted_classification := case
    when p_outcome = 'keep_open' then p_classification
    else null
  end;
  next_status := case
    when p_outcome = 'already_done' then 'completed'
    when p_outcome = 'not_followup' then 'dismissed'
    else 'routed'
  end;

  if followup_row.status <> 'pending' then
    if followup_row.status = next_status
      and followup_row.route = persisted_route
      and followup_row.contact_id is not distinct from (
        case when p_outcome = 'not_followup' then null else p_contact_id end
      )
      and followup_row.due_on is not distinct from (
        case when p_outcome = 'keep_open' then p_due_on else null end
      )
      and followup_row.resolution_note is not distinct from clean_note
      and nullif(followup_row.metadata->>'classification', '')
        is not distinct from persisted_classification
    then
      return jsonb_build_object(
        'followup_id', followup_row.id,
        'outcome', p_outcome,
        'classification', persisted_classification,
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
    raise exception 'meeting artifact must be accepted before deciding follow-ups'
      using errcode = '22023';
  end if;
  if p_outcome = 'keep_open' and p_contact_id is null then
    raise exception 'an active contact is required for this follow-up'
      using errcode = '22023';
  end if;
  if p_contact_id is not null and not exists (
    select 1 from public.contacts
    where tenant_id = p_tenant_id and id = p_contact_id and archived_at is null
  ) then
    raise exception 'active contact not found in tenant' using errcode = '22023';
  end if;

  if p_outcome = 'keep_open' and p_classification = 'action' then
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
  elsif p_outcome = 'keep_open'
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
        'owner_routed', true
      )
    ) returning id into created_target_id;
    created_target_table := 'promises';
  end if;

  update public.recording_followups
  set status = next_status,
    route = persisted_route,
    contact_id = case when p_outcome = 'not_followup' then null else p_contact_id end,
    due_on = case when p_outcome = 'keep_open' then p_due_on else null end,
    resolution_note = clean_note,
    target_table = created_target_table,
    target_id = created_target_id,
    resolved_by = p_actor_user_id,
    resolved_at = now(),
    metadata = metadata || jsonb_build_object(
      'decided_by_owner', true,
      'resolution_outcome', p_outcome,
      'classification', persisted_classification
    )
  where id = followup_row.id;

  insert into public.audit_log (
    tenant_id, actor_user_id, actor_type, action,
    table_name, record_id, before, after, metadata
  ) values (
    p_tenant_id, p_actor_user_id, 'client',
    'recording.followup_' || p_outcome,
    'recording_followups', followup_row.id,
    jsonb_build_object('status', followup_row.status),
    jsonb_build_object(
      'status', next_status, 'route', persisted_route,
      'target_table', created_target_table, 'target_id', created_target_id
    ),
    jsonb_build_object(
      'transcript_id', followup_row.transcript_id,
      'contact_id', case when p_outcome = 'not_followup' then null else p_contact_id end,
      'classification', persisted_classification,
      'outcome', p_outcome,
      'provider', transcript_row.source
    )
  );

  return jsonb_build_object(
    'followup_id', followup_row.id,
    'outcome', p_outcome,
    'classification', persisted_classification,
    'route', persisted_route,
    'status', next_status,
    'target_table', created_target_table,
    'target_id', created_target_id,
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
