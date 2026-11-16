-- Future objects must inherit the same service-only write boundary as the
-- reviewed release schema. Application migrations run as postgres. Supabase's
-- platform-managed supabase_admin role is intentionally not targeted because
-- postgres cannot SET ROLE to it; release verification rejects any application
-- object in public/app_private that is not owned by postgres.

alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

alter default privileges for role postgres in schema public
  grant all on tables to service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

alter default privileges for role postgres in schema app_private
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema app_private
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema app_private
  revoke execute on functions from public, anon, authenticated;
