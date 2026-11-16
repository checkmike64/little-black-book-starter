create index if not exists want_to_know_owner_selected_by_idx
  on public.want_to_know(owner_selected_by)
  where owner_selected_by is not null;
