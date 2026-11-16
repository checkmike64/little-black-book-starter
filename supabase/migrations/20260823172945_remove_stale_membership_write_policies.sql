-- These policy names exist in the hosted migration lineage. The equivalent
-- local-template names were removed by the preceding drift closure.
drop policy if exists "owners insert memberships" on public.tenant_members;
drop policy if exists "owners update memberships" on public.tenant_members;
drop policy if exists "owners delete memberships" on public.tenant_members;
