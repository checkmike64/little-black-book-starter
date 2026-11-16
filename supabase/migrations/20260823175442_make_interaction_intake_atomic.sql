-- Make Claude interaction delivery idempotent under concurrent retries.
-- The partial unique index already prevents duplicate rows; this function now
-- turns a losing concurrent insert into the same duplicate response returned by
-- the existing fast-path lookup, before any child rows or telemetry are written.

create or replace function public.lbb_log_interaction(
  p_tenant_id uuid,
  p_idempotency_key text,
  p_occurred_at timestamptz,
  p_interaction_type text,
  p_title text,
  p_summary text,
  p_source text,
  p_source_ref text,
  p_metadata jsonb,
  p_contact_ids uuid[],
  p_update_last_spoke boolean,
  p_promises jsonb,
  p_connection_edges jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  existing_id uuid;
  interaction_id uuid;
  normalized_key text := nullif(trim(p_idempotency_key), '');
  normalized_source text := coalesce(nullif(trim(p_source), ''), 'client_claude_project');
  occurred_date date := p_occurred_at::date;
  may_advance_last_spoke boolean :=
    coalesce(p_update_last_spoke, true)
    and p_occurred_at <= now() + interval '5 minutes';
  last_spoke_updated uuid[] := array[]::uuid[];
  promise_count integer := 0;
  connection_count integer := 0;
  strength_refresh jsonb := '{}'::jsonb;
begin
  if normalized_key is not null then
    select id into existing_id
    from public.interactions
    where tenant_id = p_tenant_id and idempotency_key = normalized_key
    limit 1;

    if existing_id is not null then
      return jsonb_build_object(
        'id', existing_id,
        'duplicate', true,
        'last_spoke_updated', '[]'::jsonb,
        'promise_count', 0,
        'connection_count', 0,
        'strength_updated_count', 0
      );
    end if;
  end if;

  if array_length(p_contact_ids, 1) is null then
    raise exception 'contact_ids are required.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Tenant does not exist.' using errcode = '22023';
  end if;

  if (
    select count(*)
    from public.contacts
    where tenant_id = p_tenant_id and id = any(p_contact_ids)
  ) <> array_length(p_contact_ids, 1) then
    raise exception 'Every contact_id must belong to this tenant.' using errcode = '22023';
  end if;

  insert into public.interactions (
    tenant_id,
    occurred_at,
    interaction_type,
    title,
    summary,
    source,
    source_ref,
    metadata,
    idempotency_key
  ) values (
    p_tenant_id,
    p_occurred_at,
    trim(p_interaction_type),
    nullif(trim(p_title), ''),
    trim(p_summary),
    normalized_source,
    nullif(trim(p_source_ref), ''),
    coalesce(p_metadata, '{}'::jsonb),
    normalized_key
  )
  on conflict (tenant_id, idempotency_key)
    where idempotency_key is not null
  do nothing
  returning id into interaction_id;

  if interaction_id is null then
    select id into existing_id
    from public.interactions
    where tenant_id = p_tenant_id and idempotency_key = normalized_key
    limit 1;

    if existing_id is not null then
      return jsonb_build_object(
        'id', existing_id,
        'duplicate', true,
        'last_spoke_updated', '[]'::jsonb,
        'promise_count', 0,
        'connection_count', 0,
        'strength_updated_count', 0
      );
    end if;

    raise exception 'Interaction could not be recorded.' using errcode = '40001';
  end if;

  insert into public.interaction_contacts (interaction_id, contact_id, tenant_id, role)
  select interaction_id, contact_id, p_tenant_id, 'participant'
  from unnest(p_contact_ids) as contact_id;

  if may_advance_last_spoke then
    with updated_contacts as (
      update public.contacts
      set last_spoke = occurred_date,
          updated_at = now()
      where tenant_id = p_tenant_id
        and id = any(p_contact_ids)
        and (last_spoke is null or last_spoke < occurred_date)
      returning id
    )
    select coalesce(array_agg(id), array[]::uuid[])
    into last_spoke_updated
    from updated_contacts;
  end if;

  if jsonb_array_length(coalesce(p_promises, '[]'::jsonb)) > 0 then
    insert into public.promises (
      tenant_id,
      contact_id,
      interaction_id,
      direction,
      promise_text,
      due_on,
      source,
      evidence
    )
    select
      p_tenant_id,
      promise.contact_id,
      interaction_id,
      promise.direction,
      promise.promise_text,
      promise.due_on,
      normalized_source,
      coalesce(promise.evidence, '{}'::jsonb) || jsonb_build_object('interaction_id', interaction_id)
    from jsonb_to_recordset(p_promises) as promise(
      contact_id uuid,
      direction text,
      promise_text text,
      due_on date,
      evidence jsonb
    );

    get diagnostics promise_count = row_count;
  end if;

  if jsonb_array_length(coalesce(p_connection_edges, '[]'::jsonb)) > 0 then
    insert into public.connections (
      tenant_id,
      contact_a,
      contact_b,
      source,
      evidence,
      confidence
    )
    select
      p_tenant_id,
      edge.contact_a,
      edge.contact_b,
      normalized_source,
      coalesce(edge.evidence, '{}'::jsonb) || jsonb_build_object(
        'interaction_id', interaction_id,
        'occurred_at', p_occurred_at
      ),
      edge.confidence
    from jsonb_to_recordset(p_connection_edges) as edge(
      contact_a uuid,
      contact_b uuid,
      evidence jsonb,
      confidence numeric
    )
    on conflict (tenant_id, contact_a, contact_b) do update
      set source = excluded.source,
          evidence = public.connections.evidence || excluded.evidence,
          confidence = coalesce(excluded.confidence, public.connections.confidence);

    get diagnostics connection_count = row_count;
  end if;

  strength_refresh := public.lbb_refresh_relationship_strength(p_tenant_id);

  insert into public.audit_log (
    tenant_id,
    actor_type,
    action,
    table_name,
    record_id,
    after
  ) values (
    p_tenant_id,
    'claude',
    'interaction.logged',
    'interactions',
    interaction_id,
    jsonb_build_object(
      'contact_ids', to_jsonb(p_contact_ids),
      'occurred_at', p_occurred_at,
      'interaction_type', trim(p_interaction_type),
      'title', nullif(trim(p_title), ''),
      'summary', trim(p_summary),
      'source', normalized_source,
      'source_ref', nullif(trim(p_source_ref), ''),
      'last_spoke_update_requested', coalesce(p_update_last_spoke, true),
      'last_spoke_update_suppressed', coalesce(p_update_last_spoke, true) and not may_advance_last_spoke,
      'last_spoke_updated', to_jsonb(last_spoke_updated),
      'promise_count', promise_count,
      'connection_count', connection_count,
      'relationship_strength_refresh', strength_refresh,
      'idempotency_key', normalized_key
    )
  );

  insert into public.usage_events (
    tenant_id,
    actor_type,
    event_type,
    quantity,
    unit,
    metadata
  ) values (
    p_tenant_id,
    'claude',
    'interaction_logged',
    1,
    'interaction',
    jsonb_build_object(
      'source', normalized_source,
      'contact_count', array_length(p_contact_ids, 1),
      'promise_count', promise_count,
      'connection_count', connection_count,
      'strength_updated_count', coalesce((strength_refresh->>'updated_count')::integer, 0),
      'last_spoke_update_suppressed', coalesce(p_update_last_spoke, true) and not may_advance_last_spoke,
      'idempotency_key', normalized_key
    )
  );

  return jsonb_build_object(
    'id', interaction_id,
    'duplicate', false,
    'last_spoke_updated', to_jsonb(last_spoke_updated),
    'last_spoke_update_suppressed', coalesce(p_update_last_spoke, true) and not may_advance_last_spoke,
    'promise_count', promise_count,
    'connection_count', connection_count,
    'strength_updated_count', coalesce((strength_refresh->>'updated_count')::integer, 0)
  );
end;
$$;

revoke execute on function public.lbb_log_interaction(
  uuid, text, timestamptz, text, text, text, text, text, jsonb, uuid[], boolean, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.lbb_log_interaction(
  uuid, text, timestamptz, text, text, text, text, text, jsonb, uuid[], boolean, jsonb, jsonb
) to service_role;
