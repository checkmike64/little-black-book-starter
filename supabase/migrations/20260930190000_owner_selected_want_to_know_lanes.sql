alter table public.want_to_know
  add column if not exists owner_selected_at timestamptz,
  add column if not exists owner_selected_by uuid references auth.users(id) on delete set null,
  add column if not exists relationship_priority text not null default 'standard',
  add column if not exists engagement_focus text;

alter table public.want_to_know
  drop constraint if exists want_to_know_relationship_priority_check;

alter table public.want_to_know
  add constraint want_to_know_relationship_priority_check
  check (relationship_priority = any (array['high'::text, 'standard'::text, 'watch'::text]));

comment on column public.want_to_know.owner_selected_at is
  'Explicit owner intent gate. A person is not an active Want to Know target until this is set.';
comment on column public.want_to_know.owner_selected_by is
  'Owner or authorized reviewer who explicitly placed the person in Want to Know.';
comment on column public.want_to_know.relationship_priority is
  'Owner-controlled relationship-building priority: high, standard, or watch.';
comment on column public.want_to_know.engagement_focus is
  'The specific subject or relationship context that makes an engagement relevant.';

create index if not exists want_to_know_owner_selected_idx
  on public.want_to_know (tenant_id, owner_selected_at, bucket, relationship_priority)
  where owner_selected_at is not null and stage <> 'graduated';

update public.want_to_know w
set owner_selected_at = coalesce(w.owner_selected_at, w.added_at),
    owner_selected_by = coalesce(
      w.owner_selected_by,
      (
        select a.actor_user_id
        from public.audit_log a
        where a.table_name = 'want_to_know'
          and a.record_id = w.id
          and a.action = 'want_to_know.created_by_owner'
        order by a.created_at asc
        limit 1
      )
    )
where w.owner_selected_at is null
  and (
    w.source in ('owner_manual', 'calendar_briefing')
    or exists (
      select 1
      from public.audit_log a
      where a.table_name = 'want_to_know'
        and a.record_id = w.id
        and a.action = 'want_to_know.created_by_owner'
    )
  );


-- Private-install cohort cleanup and bucket seeds omitted from this distribution.
