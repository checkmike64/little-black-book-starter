-- Atomically update one operator-held production signoff and its audit receipt.
-- Evidence content remains in the restricted external record system; this
-- function stores only a bounded opaque identifier.

create function public.lbb_update_production_check(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_expected_version integer,
  p_check_key text,
  p_confirmed boolean,
  p_evidence_ref text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  allowed_keys constant text[] := array[
    'supabase_project_isolated',
    'rls_data_api_reviewed',
    'preview_protection_enabled',
    'claude_token_scoped',
    'auth_email_template_ready',
    'commercial_agreement_signed',
    'billing_owner_and_collection_ready',
    'support_contact_and_process_ready',
    'backup_and_restore_proven',
    'retention_and_offboarding_ready',
    'owner_acceptance_recorded'
  ];
  previous_settings jsonb;
  current_check jsonb;
  next_check jsonb;
  next_settings jsonb;
  normalized_evidence_ref text;
  current_version integer;
  next_version integer;
  actor_role text;
begin
  if p_tenant_id is null
    or p_actor_user_id is null
    or p_expected_version is null
    or p_expected_version < 1
    or p_check_key is null
    or p_confirmed is null
  then
    raise exception 'Production check parameters are required.'
      using errcode = '22023';
  end if;

  if not (p_check_key = any (allowed_keys)) then
    raise exception 'Unknown production check.' using errcode = '22023';
  end if;

  normalized_evidence_ref := nullif(btrim(p_evidence_ref), '');
  if p_confirmed then
    if normalized_evidence_ref is null
      or char_length(normalized_evidence_ref) not between 6 and 500
      or normalized_evidence_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
      or normalized_evidence_ref ~* '^(https?|file)://'
    then
      raise exception 'A bounded opaque external evidence ID is required.'
        using errcode = '22023';
    end if;
  elsif normalized_evidence_ref is not null then
    raise exception 'Cleared production checks cannot retain evidence IDs.'
      using errcode = '22023';
  end if;

  select member.role
  into actor_role
  from public.tenant_members member
  where member.tenant_id = p_tenant_id
    and member.user_id = p_actor_user_id
    and member.status = 'active'
    and member.role in ('owner', 'operator')
  limit 1;

  if actor_role is null then
    raise exception 'Only an active tenant owner or operator can update production evidence.'
      using errcode = '42501';
  end if;

  select coalesce(tenant.settings, '{}'::jsonb), tenant.settings_version
  into previous_settings, current_version
  from public.tenants tenant
  where tenant.id = p_tenant_id
  for update;

  if not found then
    raise exception 'Tenant does not exist.' using errcode = '22023';
  end if;

  current_check := coalesce(
    previous_settings #> array['delivery', 'production_checks', p_check_key],
    '{}'::jsonb
  );

  if (
    p_confirmed
    and current_check ->> 'confirmed' = 'true'
    and current_check ->> 'confirmed_at' is not null
    and current_check ->> 'confirmed_by' = p_actor_user_id::text
    and current_check ->> 'evidence_ref' = normalized_evidence_ref
  ) or (
    not p_confirmed
    and current_check ->> 'confirmed' = 'false'
    and current_check ->> 'confirmed_at' is null
    and current_check ->> 'confirmed_by' is null
    and current_check ->> 'evidence_ref' is null
  ) then
    return jsonb_build_object(
      'settings_version', current_version,
      'production_check', current_check,
      'idempotent', true
    );
  end if;

  if current_version <> p_expected_version then
    raise exception 'Production evidence changed in another session.'
      using errcode = '40001';
  end if;

  if p_confirmed then
    next_check := jsonb_build_object(
      'confirmed', true,
      'confirmed_at', now(),
      'confirmed_by', p_actor_user_id,
      'evidence_ref', normalized_evidence_ref
    );
  else
    next_check := jsonb_build_object(
      'confirmed', false,
      'confirmed_at', null,
      'confirmed_by', null,
      'evidence_ref', null
    );
  end if;

  next_settings := jsonb_set(
    previous_settings,
    '{delivery}',
    coalesce(previous_settings -> 'delivery', '{}'::jsonb),
    true
  );
  next_settings := jsonb_set(
    next_settings,
    '{delivery,production_checks}',
    coalesce(next_settings #> '{delivery,production_checks}', '{}'::jsonb),
    true
  );
  next_settings := jsonb_set(
    next_settings,
    array['delivery', 'production_checks', p_check_key],
    next_check,
    true
  );

  update public.tenants tenant
  set settings = next_settings
  where tenant.id = p_tenant_id
  returning tenant.settings_version into next_version;

  insert into public.audit_log (
    tenant_id,
    actor_user_id,
    actor_type,
    action,
    table_name,
    record_id,
    before,
    after,
    metadata
  ) values (
    p_tenant_id,
    p_actor_user_id,
    'operator',
    case
      when p_confirmed then 'deployment.production_check_confirmed'
      else 'deployment.production_check_cleared'
    end,
    'tenants',
    p_tenant_id,
    jsonb_build_object(
      'production_check', current_check,
      'settings_version', current_version
    ),
    jsonb_build_object(
      'production_check', next_check,
      'settings_version', next_version
    ),
    jsonb_build_object('key', p_check_key)
  );

  return jsonb_build_object(
    'settings_version', next_version,
    'production_check', next_check,
    'idempotent', false
  );
end;
$$;

revoke all on function public.lbb_update_production_check(
  uuid, uuid, integer, text, boolean, text
) from public, anon, authenticated;

grant execute on function public.lbb_update_production_check(
  uuid, uuid, integer, text, boolean, text
) to service_role;
