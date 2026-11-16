-- A legacy configuration flag is not evidence that the owner approved an
-- empty relationship program. Preserve configured programs and their research
-- policy, but hold empty imports until the owner explicitly restores them.

update public.want_to_know_programs program
set status = 'paused',
    updated_at = now()
where program.status = 'active'
  and program.provenance->>'origin' = 'tenant_settings'
  and not exists (
    select 1
    from public.want_to_know candidate
    where candidate.tenant_id = program.tenant_id
      and candidate.program_id = program.id
      and candidate.owner_selected_at is not null
      and candidate.stage <> 'graduated'
      and candidate.relationship_status <> 'archived'
  );
