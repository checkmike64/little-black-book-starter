alter table public.content_scan_sources
  drop constraint if exists content_scan_sources_platform_check;

alter table public.content_scan_sources
  add constraint content_scan_sources_platform_check
  check (
    platform = any (
      array[
        'linkedin'::text,
        'instagram'::text,
        'facebook'::text,
        'x_twitter'::text,
        'youtube'::text,
        'website'::text
      ]
    )
  );
