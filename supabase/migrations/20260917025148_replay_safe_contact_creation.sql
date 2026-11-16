-- Replay keys are private implementation data. They do not live on contacts,
-- where the existing authenticated table grants would expose writable future
-- columns through the Data API. Email remains mutable and is not an identity key.
create table app_private.contact_creation_requests (
  tenant_id uuid not null,
  request_key text not null,
  payload_hash text not null,
  contact_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint contact_creation_requests_pkey primary key (tenant_id, request_key),
  constraint contact_creation_requests_key_check check (
    request_key = btrim(request_key) and char_length(request_key) between 1 and 240
  ),
  constraint contact_creation_requests_hash_check check (
    payload_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint contact_creation_requests_tenant_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint contact_creation_requests_contact_fkey
    foreign key (tenant_id, contact_id)
    references public.contacts(tenant_id, id) on delete cascade,
  constraint contact_creation_requests_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete restrict
);

alter table app_private.contact_creation_requests enable row level security;
revoke all on table app_private.contact_creation_requests from public, anon, authenticated;
grant select, insert, update on table app_private.contact_creation_requests
  to service_role;

create or replace function public.lbb_create_contact_once(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_creation_request_key text,
  p_contact_fields jsonb,
  p_source text,
  p_extra jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_key text := btrim(coalesce(p_creation_request_key, ''));
  v_hash text;
  v_source text := btrim(coalesce(p_source, ''));
  v_fields jsonb := coalesce(p_contact_fields, '{}'::jsonb);
  v_extra jsonb := coalesce(p_extra, '{}'::jsonb);
  v_contact_id uuid;
  v_existing_hash text;
  v_unexpected_keys text[];
begin
  if not exists (
    select 1
    from public.tenant_members member
    where member.tenant_id = p_tenant_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and member.role in ('owner', 'operator')
  ) then
    raise exception 'Actor is not an active member of this tenant.' using errcode = '42501';
  end if;

  if char_length(v_key) not between 1 and 240 then
    raise exception 'creation_request_key must contain 1 to 240 characters.' using errcode = '22023';
  end if;
  if v_source = '' or char_length(v_source) > 120 then
    raise exception 'source must contain 1 to 120 characters.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_fields) <> 'object' or jsonb_typeof(v_extra) <> 'object' then
    raise exception 'Contact fields and extra metadata must be JSON objects.' using errcode = '22023';
  end if;
  v_hash := encode(
    extensions.digest(
      jsonb_build_object(
        'fields', v_fields,
        'source', v_source,
        'extra', v_extra
      )::text,
      'sha256'
    ),
    'hex'
  );

  select array_agg(key order by key)
  into v_unexpected_keys
  from jsonb_object_keys(v_fields) as keys(key)
  where key <> all (array[
    'full_name', 'email', 'phone', 'company_name', 'company_description',
    'role_title', 'one_line_summary', 'trust_level', 'touch_cadence',
    'relationship_type',
    'relationship_strength', 'relationship_strength_computed',
    'relationship_strength_override', 'relationship_strength_reason',
    'last_spoke', 'met_date', 'how_we_met', 'how_i_know_them',
    'why_stay_in_touch', 'location', 'time_zone', 'linkedin', 'instagram',
    'facebook', 'x_twitter', 'youtube', 'podcast_url', 'website', 'birthday',
    'spouse_partner', 'children', 'important_dates', 'current_asks',
    'wants_help_with', 'what_they_want_more_of', 'services_offered',
    'ideal_referral', 'do_not_refer_for', 'could_refer_me_for',
    'referral_intro_blurb', 'podcast_fit', 'primary_category', 'top_3_tags',
    'keywords', 'recent_activity', 'personal_notes', 'private_notes'
  ]::text[]);
  if coalesce(cardinality(v_unexpected_keys), 0) > 0 then
    raise exception 'Unsupported contact fields: %', array_to_string(v_unexpected_keys, ', ')
      using errcode = '22023';
  end if;

  if char_length(btrim(coalesce(v_fields->>'full_name', ''))) not between 2 and 300 then
    raise exception 'full_name must contain 2 to 300 characters.' using errcode = '22023';
  end if;

  insert into app_private.contact_creation_requests (
    tenant_id, request_key, payload_hash, created_by
  ) values (
    p_tenant_id, v_key, v_hash, p_actor_user_id
  )
  on conflict (tenant_id, request_key) do nothing;

  select request.payload_hash, request.contact_id
  into v_existing_hash, v_contact_id
  from app_private.contact_creation_requests request
  where request.tenant_id = p_tenant_id
    and request.request_key = v_key
  for update;

  if v_existing_hash is distinct from v_hash then
    raise exception 'creation_request_key was already used with a different payload.' using errcode = '22023';
  end if;
  if v_contact_id is not null then
    return jsonb_build_object('contact_id', v_contact_id, 'created', false, 'replayed', true);
  end if;

  insert into public.contacts (
    tenant_id, created_by, source, extra, full_name, email, phone, company_name,
    company_description, role_title, one_line_summary, trust_level,
    touch_cadence, relationship_type, relationship_strength,
    relationship_strength_computed,
    relationship_strength_override, relationship_strength_reason, last_spoke,
    met_date, how_we_met, how_i_know_them, why_stay_in_touch, location,
    time_zone, linkedin, instagram, facebook, x_twitter, youtube, podcast_url,
    website, birthday, spouse_partner, children, important_dates, current_asks,
    wants_help_with, what_they_want_more_of, services_offered, ideal_referral,
    do_not_refer_for, could_refer_me_for, referral_intro_blurb, podcast_fit,
    primary_category, top_3_tags, keywords, recent_activity, personal_notes,
    private_notes
  )
  select
    p_tenant_id, p_actor_user_id, v_source, v_extra, x.full_name, x.email,
    x.phone, x.company_name, x.company_description,
    x.role_title, x.one_line_summary, x.trust_level, x.touch_cadence,
    x.relationship_type, x.relationship_strength, x.relationship_strength_computed,
    coalesce(x.relationship_strength_override, false),
    x.relationship_strength_reason, x.last_spoke, x.met_date, x.how_we_met,
    x.how_i_know_them, x.why_stay_in_touch, x.location, x.time_zone,
    x.linkedin, x.instagram, x.facebook, x.x_twitter, x.youtube,
    x.podcast_url, x.website, x.birthday, x.spouse_partner, x.children,
    x.important_dates, x.current_asks, x.wants_help_with,
    x.what_they_want_more_of, x.services_offered, x.ideal_referral,
    x.do_not_refer_for, x.could_refer_me_for, x.referral_intro_blurb,
    x.podcast_fit, x.primary_category, x.top_3_tags, x.keywords,
    x.recent_activity, x.personal_notes, x.private_notes
  from jsonb_to_record(v_fields) as x(
    full_name text, email text, phone text, company_name text,
    company_description text, role_title text[], one_line_summary text,
    trust_level text, touch_cadence text, relationship_type text[],
    relationship_strength text,
    relationship_strength_computed text, relationship_strength_override boolean,
    relationship_strength_reason text, last_spoke date, met_date date,
    how_we_met text, how_i_know_them text[], why_stay_in_touch text,
    location text[], time_zone text, linkedin text, instagram text,
    facebook text, x_twitter text, youtube text, podcast_url text, website text,
    birthday date, spouse_partner text, children text, important_dates text,
    current_asks text, wants_help_with text, what_they_want_more_of text,
    services_offered text[], ideal_referral text, do_not_refer_for text,
    could_refer_me_for text[], referral_intro_blurb text, podcast_fit text,
    primary_category text[], top_3_tags text[], keywords text[],
    recent_activity text, personal_notes text, private_notes text
  )
  returning id into v_contact_id;

  if v_contact_id is null then
    raise exception 'Contact creation failed.' using errcode = '40001';
  end if;

  update app_private.contact_creation_requests
  set contact_id = v_contact_id
  where tenant_id = p_tenant_id
    and request_key = v_key
    and contact_id is null;

  return jsonb_build_object('contact_id', v_contact_id, 'created', true, 'replayed', false);
end;
$$;

create or replace function public.lbb_approve_new_contact_once(
  p_tenant_id uuid,
  p_pending_change_id uuid,
  p_actor_user_id uuid,
  p_contact_fields jsonb,
  p_source text,
  p_extra jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_change public.pending_changes%rowtype;
  v_creation jsonb;
  v_contact_id uuid;
begin
  select *
  into v_change
  from public.pending_changes
  where tenant_id = p_tenant_id
    and id = p_pending_change_id
  for update;

  if not found then
    raise exception 'Pending change was not found in this tenant.' using errcode = '22023';
  end if;
  if v_change.change_type not in ('new_contact', 'contact_candidate') then
    raise exception 'Pending change is not a new-person proposal.' using errcode = '22023';
  end if;
  if v_change.status not in ('pending', 'approved') then
    raise exception 'Pending change is no longer available for approval.' using errcode = '55000';
  end if;

  v_creation := public.lbb_create_contact_once(
    p_tenant_id,
    p_actor_user_id,
    'pending-change:' || p_pending_change_id::text,
    p_contact_fields,
    p_source,
    p_extra
  );
  v_contact_id := (v_creation->>'contact_id')::uuid;

  if v_change.status = 'approved' then
    if v_change.contact_id is distinct from v_contact_id then
      raise exception 'Approved pending change is linked to a different contact.' using errcode = '23514';
    end if;
    return v_creation || jsonb_build_object('approved', true, 'approval_replayed', true);
  end if;

  update public.pending_changes
  set status = 'approved',
      contact_id = v_contact_id,
      reviewed_by = p_actor_user_id,
      reviewed_at = statement_timestamp()
  where tenant_id = p_tenant_id
    and id = p_pending_change_id
    and status = 'pending';

  if not found then
    raise exception 'Pending change approval lost a concurrent update.' using errcode = '40001';
  end if;

  return v_creation || jsonb_build_object('approved', true, 'approval_replayed', false);
end;
$$;

revoke all on function public.lbb_create_contact_once(
  uuid, uuid, text, jsonb, text, jsonb
) from public, anon, authenticated;
grant execute on function public.lbb_create_contact_once(
  uuid, uuid, text, jsonb, text, jsonb
) to service_role;

revoke all on function public.lbb_approve_new_contact_once(
  uuid, uuid, uuid, jsonb, text, jsonb
) from public, anon, authenticated;
grant execute on function public.lbb_approve_new_contact_once(
  uuid, uuid, uuid, jsonb, text, jsonb
) to service_role;
