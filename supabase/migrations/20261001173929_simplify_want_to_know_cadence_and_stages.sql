set local lock_timeout = '5s';
set local statement_timeout = '30s';

insert into public.audit_log (
  tenant_id,
  actor_type,
  action,
  table_name,
  record_id,
  before,
  after,
  metadata
)
select
  w.tenant_id,
  'system',
  'want_to_know.stage_simplified',
  'want_to_know',
  w.id,
  jsonb_build_object('stage', w.stage),
  jsonb_build_object('stage', 'watching'),
  jsonb_build_object('reason', 'Research is work within Watching, not a separate relationship stage.')
from public.want_to_know w
where w.stage = 'researching';

update public.want_to_know
set stage = 'watching',
    updated_at = now()
where stage = 'researching';

alter table public.want_to_know
  alter column engagement_target_per_month set default 1;

alter table public.want_to_know
  drop constraint if exists want_to_know_engagement_target_per_month_check;

alter table public.want_to_know
  add constraint want_to_know_engagement_target_per_month_check
  check (
    engagement_target_per_month is null
    or engagement_target_per_month between 0 and 5
  );

alter table public.want_to_know
  drop constraint if exists want_to_know_stage_check;

alter table public.want_to_know
  add constraint want_to_know_stage_check
  check (stage = any (array['watching'::text, 'warming'::text, 'ready'::text, 'graduated'::text]));

comment on column public.want_to_know.engagement_target_per_month is
  'Owner-selected relationship cadence: 0 means Watch without a monthly target; otherwise 1 through 5 touches per month.';

comment on column public.want_to_know.stage is
  'Relationship stage: watching, warming, add to Book, or graduated.';
