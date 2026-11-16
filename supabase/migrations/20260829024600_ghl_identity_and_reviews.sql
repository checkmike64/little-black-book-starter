-- GoHighLevel sync phase 1: contact identity mapping, provenance source,
-- and the tenant-scoped review/testimonial repository.

alter table public.contacts
  add column if not exists ghl_contact_id text;

create unique index if not exists contacts_tenant_ghl_contact_idx
  on public.contacts (tenant_id, ghl_contact_id)
  where ghl_contact_id is not null;

alter table public.field_provenance
  drop constraint if exists field_provenance_source_type_check;

alter table public.field_provenance
  add constraint field_provenance_source_type_check
  check (source_type in ('claude', 'transcript', 'correspondence', 'social_pulse', 'manual', 'import', 'gohighlevel'));

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid not null,
  platform text not null
    check (platform in ('google', 'linkedin', 'testimonial', 'video', 'other')),
  rating smallint
    check (rating is null or rating between 1 and 5),
  body text,
  permission_to_publish boolean not null default false,
  source text not null default 'manual'
    check (source in ('manual', 'gohighlevel', 'gbp_tool')),
  external_ref text,
  campaign_key text,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviews_tenant_contact_fkey
    foreign key (tenant_id, contact_id)
    references public.contacts (tenant_id, id)
    on delete cascade
);

alter table public.reviews enable row level security;

drop policy if exists "members read reviews" on public.reviews;
drop policy if exists "members insert reviews" on public.reviews;
drop policy if exists "members update reviews" on public.reviews;
drop policy if exists "members delete reviews" on public.reviews;

create policy "members read reviews"
on public.reviews for select
to authenticated
using (app_private.is_tenant_member(tenant_id));

create policy "members insert reviews"
on public.reviews for insert
to authenticated
with check (app_private.is_tenant_member(tenant_id));

create policy "members update reviews"
on public.reviews for update
to authenticated
using (app_private.is_tenant_member(tenant_id))
with check (app_private.is_tenant_member(tenant_id));

create policy "members delete reviews"
on public.reviews for delete
to authenticated
using (app_private.is_tenant_member(tenant_id));

revoke all on public.reviews from public, anon, authenticated;
grant select, insert, update, delete on public.reviews to authenticated;
grant all on public.reviews to service_role;

create index if not exists reviews_tenant_contact_idx
  on public.reviews (tenant_id, contact_id);

create unique index if not exists reviews_tenant_external_ref_idx
  on public.reviews (tenant_id, external_ref)
  where external_ref is not null;

drop trigger if exists set_reviews_updated_at on public.reviews;
create trigger set_reviews_updated_at
before update on public.reviews
for each row execute function public.set_updated_at();
