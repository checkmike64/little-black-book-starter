-- The recording-baseline finalizer is SECURITY INVOKER and intentionally
-- executes only as service_role. Its table/function grants in the baseline
-- migration are ineffective unless that role can resolve objects in the
-- private schema.
revoke usage on schema app_private from public, anon;
grant usage on schema app_private to service_role;
