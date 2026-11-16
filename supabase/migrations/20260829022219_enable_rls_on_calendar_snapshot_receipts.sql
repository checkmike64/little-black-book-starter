-- Keep private idempotency receipts fail-closed even if grants or exposed
-- schemas change later. The service-role-only SECURITY DEFINER intake
-- function continues to execute as its postgres owner and bypasses RLS.
alter table app_private.calendar_snapshot_receipts enable row level security;
