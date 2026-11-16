-- Relationship recommendation v3: auditable introduction events, promise links,
-- and one feedback request for each participant seven days after an introduction.

alter table public.introductions
  add constraint introductions_tenant_id_id_key unique (tenant_id, id);

alter table public.promises
  add column introduction_id uuid,
  add constraint promises_tenant_introduction_fkey
    foreign key (tenant_id, introduction_id)
    references public.introductions(tenant_id, id)
    on delete set null (introduction_id);

create index promises_introduction_idx
  on public.promises (tenant_id, introduction_id)
  where introduction_id is not null;

create table public.introduction_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  introduction_id uuid not null,
  event_type text not null,
  occurred_at timestamp with time zone not null default now(),
  source text not null,
  source_ref text,
  external_key text,
  evidence jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  constraint introduction_events_tenant_introduction_fkey
    foreign key (tenant_id, introduction_id)
    references public.introductions(tenant_id, id)
    on delete cascade,
  constraint introduction_events_type_check
    check (event_type in ('proposed', 'sent', 'feedback_scheduled', 'feedback_drafted', 'feedback_sent', 'feedback_received', 'closed')),
  constraint introduction_events_source_check
    check (source in ('owner', 'promise', 'email', 'system', 'operator')),
  constraint introduction_events_external_key_key unique (tenant_id, external_key)
);

alter table public.introduction_events enable row level security;

create index introduction_events_tenant_intro_time_idx
  on public.introduction_events (tenant_id, introduction_id, occurred_at desc);

create policy "members read introduction events" on public.introduction_events
  for select to authenticated
  using (app_private.is_tenant_member(tenant_id));

create policy "members insert introduction events" on public.introduction_events
  for insert to authenticated
  with check (app_private.is_tenant_member(tenant_id));

create policy "members update introduction events" on public.introduction_events
  for update to authenticated
  using (app_private.is_tenant_member(tenant_id))
  with check (app_private.is_tenant_member(tenant_id));

grant select, insert, update on public.introduction_events
  to authenticated, postgres, service_role;

create table public.introduction_feedback_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  introduction_id uuid not null,
  contact_id uuid not null,
  status text not null default 'scheduled',
  due_at timestamp with time zone not null,
  recipient_email text,
  draft_subject text,
  draft_body text,
  draft_generated_at timestamp with time zone,
  gmail_draft_id text,
  gmail_draft_created_at timestamp with time zone,
  sent_at timestamp with time zone,
  usefulness_rating smallint,
  fit_rating smallint,
  would_recommend boolean,
  response_text text,
  response_reasoning text,
  response_source text,
  response_source_ref text,
  response_received_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint introduction_feedback_tenant_introduction_fkey
    foreign key (tenant_id, introduction_id)
    references public.introductions(tenant_id, id)
    on delete cascade,
  constraint introduction_feedback_tenant_contact_fkey
    foreign key (tenant_id, contact_id)
    references public.contacts(tenant_id, id)
    on delete cascade,
  constraint introduction_feedback_status_check
    check (status in ('scheduled', 'draft_ready', 'sent', 'responded', 'skipped')),
  constraint introduction_feedback_usefulness_check
    check (usefulness_rating is null or usefulness_rating between 1 and 5),
  constraint introduction_feedback_fit_check
    check (fit_rating is null or fit_rating between 1 and 5),
  constraint introduction_feedback_response_source_check
    check (response_source is null or response_source in ('owner', 'email', 'call', 'message', 'other')),
  constraint introduction_feedback_intro_contact_key unique (tenant_id, introduction_id, contact_id)
);

alter table public.introduction_feedback_requests enable row level security;

create index introduction_feedback_due_idx
  on public.introduction_feedback_requests (tenant_id, status, due_at);

create index introduction_feedback_contact_idx
  on public.introduction_feedback_requests (tenant_id, contact_id, response_received_at desc);

create trigger set_introduction_feedback_updated_at
  before update on public.introduction_feedback_requests
  for each row execute function public.set_updated_at();

create policy "members read introduction feedback" on public.introduction_feedback_requests
  for select to authenticated
  using (app_private.is_tenant_member(tenant_id));

create policy "members insert introduction feedback" on public.introduction_feedback_requests
  for insert to authenticated
  with check (app_private.is_tenant_member(tenant_id));

create policy "members update introduction feedback" on public.introduction_feedback_requests
  for update to authenticated
  using (app_private.is_tenant_member(tenant_id))
  with check (app_private.is_tenant_member(tenant_id));

grant select, insert, update on public.introduction_feedback_requests
  to authenticated, postgres, service_role;

with recipients as (
  select i.tenant_id, i.id as introduction_id, i.person_a as contact_id,
    i.date_made::timestamp with time zone as sent_at,
    recipient.full_name as recipient_name, recipient.email as recipient_email,
    counterpart.full_name as counterpart_name
  from public.introductions i
  join public.contacts recipient on recipient.tenant_id = i.tenant_id and recipient.id = i.person_a
  left join public.contacts counterpart on counterpart.tenant_id = i.tenant_id and counterpart.id = i.person_b
  where i.date_made is not null
  union all
  select i.tenant_id, i.id, i.person_b, i.date_made::timestamp with time zone,
    recipient.full_name, recipient.email, counterpart.full_name
  from public.introductions i
  join public.contacts recipient on recipient.tenant_id = i.tenant_id and recipient.id = i.person_b
  left join public.contacts counterpart on counterpart.tenant_id = i.tenant_id and counterpart.id = i.person_a
  where i.date_made is not null
)
insert into public.introduction_feedback_requests (
  tenant_id, introduction_id, contact_id, status, due_at, recipient_email,
  draft_subject, draft_body, draft_generated_at
)
select tenant_id, introduction_id, contact_id, 'scheduled', sent_at + interval '7 days', recipient_email,
  'Quick follow-up on your introduction to ' || coalesce(counterpart_name, 'the person I introduced you to'),
  'Hi ' || split_part(recipient_name, ' ', 1) || E',\n\nI wanted to check in on the introduction to ' ||
    coalesce(counterpart_name, 'the person I connected you with') || E'. Was the conversation useful? Did the fit feel right, and did anything fruitful come from it?\n\nA quick honest reply is perfect.',
  now()
from recipients
on conflict (tenant_id, introduction_id, contact_id) do nothing;

insert into public.introduction_events (
  tenant_id, introduction_id, event_type, occurred_at, source, source_ref, external_key, evidence
)
select tenant_id, id, 'sent', date_made::timestamp with time zone, 'system',
  'migration:existing_introduction', 'introduction-sent:' || id::text,
  jsonb_build_object('status', status, 'date_made', date_made)
from public.introductions
where date_made is not null
on conflict (tenant_id, external_key) do nothing;

create or replace function app_private.schedule_introduction_feedback()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  sent_at_value timestamp with time zone;
  person_a_row public.contacts%rowtype;
  person_b_row public.contacts%rowtype;
begin
  if new.date_made is null or (old.date_made is not null and old.status = 'made') then
    return new;
  end if;

  sent_at_value := new.date_made::timestamp with time zone;

  insert into public.introduction_events (
    tenant_id, introduction_id, event_type, occurred_at, source, source_ref, external_key, evidence
  ) values (
    new.tenant_id, new.id, 'sent', sent_at_value, 'system', 'introductions.date_made',
    'introduction-sent:' || new.id::text,
    jsonb_build_object('status', new.status, 'date_made', new.date_made)
  ) on conflict (tenant_id, external_key) do nothing;

  select * into person_a_row from public.contacts
    where tenant_id = new.tenant_id and id = new.person_a;
  select * into person_b_row from public.contacts
    where tenant_id = new.tenant_id and id = new.person_b;

  if person_a_row.id is not null then
    insert into public.introduction_feedback_requests (
      tenant_id, introduction_id, contact_id, status, due_at, recipient_email,
      draft_subject, draft_body, draft_generated_at
    ) values (
      new.tenant_id, new.id, person_a_row.id, 'scheduled', sent_at_value + interval '7 days', person_a_row.email,
      'Quick follow-up on your introduction to ' || coalesce(person_b_row.full_name, 'the person I introduced you to'),
      'Hi ' || split_part(person_a_row.full_name, ' ', 1) || E',\n\nI wanted to check in on the introduction to ' ||
        coalesce(person_b_row.full_name, 'the person I connected you with') || E'. Was the conversation useful? Did the fit feel right, and did anything fruitful come from it?\n\nA quick honest reply is perfect.',
      now()
    ) on conflict (tenant_id, introduction_id, contact_id) do nothing;
  end if;

  if person_b_row.id is not null then
    insert into public.introduction_feedback_requests (
      tenant_id, introduction_id, contact_id, status, due_at, recipient_email,
      draft_subject, draft_body, draft_generated_at
    ) values (
      new.tenant_id, new.id, person_b_row.id, 'scheduled', sent_at_value + interval '7 days', person_b_row.email,
      'Quick follow-up on your introduction to ' || coalesce(person_a_row.full_name, 'the person I introduced you to'),
      'Hi ' || split_part(person_b_row.full_name, ' ', 1) || E',\n\nI wanted to check in on the introduction to ' ||
        coalesce(person_a_row.full_name, 'the person I connected you with') || E'. Was the conversation useful? Did the fit feel right, and did anything fruitful come from it?\n\nA quick honest reply is perfect.',
      now()
    ) on conflict (tenant_id, introduction_id, contact_id) do nothing;
  end if;

  insert into public.introduction_events (
    tenant_id, introduction_id, event_type, occurred_at, source, source_ref, external_key, evidence
  ) values (
    new.tenant_id, new.id, 'feedback_scheduled', now(), 'system', 'introduction_feedback_requests',
    'introduction-feedback-scheduled:' || new.id::text,
    jsonb_build_object('due_at', sent_at_value + interval '7 days')
  ) on conflict (tenant_id, external_key) do nothing;

  return new;
end;
$$;

create trigger schedule_introduction_feedback_after_sent
  after update of status, date_made on public.introductions
  for each row
  when (new.date_made is not null and (old.date_made is null or old.status is distinct from new.status))
  execute function app_private.schedule_introduction_feedback();

create or replace function app_private.mark_introduction_from_completed_promise()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.introduction_id is null or new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  update public.introductions
  set status = 'made',
      date_made = coalesce(date_made, new.completed_at::date, current_date),
      updated_at = now()
  where tenant_id = new.tenant_id
    and id = new.introduction_id
    and status = 'proposed';

  insert into public.introduction_events (
    tenant_id, introduction_id, event_type, occurred_at, source, source_ref, external_key, evidence
  ) values (
    new.tenant_id, new.introduction_id, 'sent', coalesce(new.completed_at, now()), 'promise',
    new.id::text, 'promise-completed:' || new.id::text,
    jsonb_build_object('promise_id', new.id, 'promise_text', new.promise_text)
  ) on conflict (tenant_id, external_key) do nothing;

  return new;
end;
$$;

create trigger mark_introduction_after_promise_completion
  after update of status on public.promises
  for each row
  when (new.introduction_id is not null and new.status = 'completed' and old.status is distinct from new.status)
  execute function app_private.mark_introduction_from_completed_promise();

create or replace function public.lbb_record_introduction_sent(
  p_tenant_id uuid,
  p_introduction_id uuid,
  p_actor_user_id uuid,
  p_source text,
  p_occurred_at timestamp with time zone,
  p_external_key text,
  p_source_ref text default null,
  p_evidence jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  introduction_row public.introductions%rowtype;
begin
  if p_source not in ('owner', 'email', 'operator') then
    raise exception 'unsupported introduction source';
  end if;
  if p_actor_user_id is not null and not app_private.is_tenant_member(p_tenant_id) then
    raise exception 'tenant membership required';
  end if;

  select * into introduction_row from public.introductions
  where tenant_id = p_tenant_id and id = p_introduction_id for update;
  if not found then raise exception 'introduction not found'; end if;

  insert into public.introduction_events (
    tenant_id, introduction_id, event_type, occurred_at, source, source_ref,
    external_key, evidence, created_by
  ) values (
    p_tenant_id, p_introduction_id, 'sent', coalesce(p_occurred_at, now()), p_source,
    p_source_ref, p_external_key, coalesce(p_evidence, '{}'::jsonb), p_actor_user_id
  ) on conflict (tenant_id, external_key) do nothing;

  update public.introductions
  set status = 'made',
      date_made = coalesce(date_made, coalesce(p_occurred_at, now())::date),
      updated_at = now()
  where tenant_id = p_tenant_id and id = p_introduction_id;

  return jsonb_build_object('introduction_id', p_introduction_id, 'status', 'made');
end;
$$;

revoke all on function public.lbb_record_introduction_sent(uuid, uuid, uuid, text, timestamp with time zone, text, text, jsonb) from public;
grant execute on function public.lbb_record_introduction_sent(uuid, uuid, uuid, text, timestamp with time zone, text, text, jsonb)
  to authenticated, service_role;
