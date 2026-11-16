-- Introduction events are written by tenant-scoped server routes and triggers.
-- Keep the security-definer RPC out of the browser-accessible authenticated role.

revoke execute on function public.lbb_record_introduction_sent(
  uuid, uuid, uuid, text, timestamp with time zone, text, text, jsonb
) from authenticated;

create index introduction_events_created_by_idx
  on public.introduction_events (created_by)
  where created_by is not null;
