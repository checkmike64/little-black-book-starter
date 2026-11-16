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
      'ask_answer'
    ) then
    raise exception 'Invalid AI ledger task.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_metadata -> 'feature') <> 'string'
    or p_metadata ->> 'feature' not in ('engagement', 'networking', 'ask') then
    raise exception 'Invalid AI ledger feature.' using errcode = '22023';
  end if;
  if (p_metadata ->> 'task' = 'engagement_rank' and p_metadata ->> 'feature' <> 'engagement')
    or (p_metadata ->> 'task' in ('networking_rank', 'introduction_draft') and p_metadata ->> 'feature' <> 'networking')
    or (p_metadata ->> 'task' = 'ask_answer' and p_metadata ->> 'feature' <> 'ask') then
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
