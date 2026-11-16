# Security Baseline

Implemented in this scaffold:

- Auth-gated routes through Next proxy.
- `robots.txt`, empty sitemap, metadata robots, and global `X-Robots-Tag` headers.
- Browser-safe Supabase client only uses public URL and anon key.
- Server-only service-role key is reserved for gateway routes and jobs.
- RLS migrations with tenant membership policies.
- Private transcript bucket, with no browser write policy.
- Append-only audit-log table.
- Usage metering and job tables for Claude/enrichment gateway work.

Operational requirements:

- Do not put `SUPABASE_SERVICE_ROLE_KEY`, Anthropic keys, Apify keys, or Outscraper keys in browser code.
- Do not put `SUPABASE_SERVICE_ROLE_KEY` inside Claude project instructions. Give Claude a narrow write endpoint token instead.
- Do not connect Google, Gmail, or Calendar accounts to the application. Any
  source authorization remains in the client&apos;s Claude environment; the app
  accepts only bounded, audited Claude submissions.
- Keep each client in a separate Supabase project.
- Keep each install limited to the executive owner and an optional operator unless the product direction changes.
- Do not apply migrations to the live reference project until its existing schema has been compared.
- Keep Vercel preview deployments protected.
- Maintain a simple DPA/subprocessor disclosure naming Supabase, Vercel AI Gateway, the enabled OpenAI and Anthropic providers, and each enrichment provider.
- Treat emails, transcripts, and private notes as sensitive relationship data even if the tool is not HIPAA-regulated.
- Use full transcripts during extraction/quality review, but store detailed notes and structured relationship data by default.
- Make private notes visible to the executive owner; log writes and updates through the audit trail.
- Keep provenance subtle in the UI, but store it consistently so AI-derived facts can be inspected.
- Allow relationship strength to be computed from interaction history while preserving a manual override.
