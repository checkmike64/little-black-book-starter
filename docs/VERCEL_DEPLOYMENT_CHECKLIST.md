# Vercel Deployment Checklist

Use this checklist for every Little Black Book client install. The goal is a
lean Vercel app pointed at one isolated Supabase project, with Claude writing
only through narrow audited endpoints.

## 1. Create The Client Supabase Project

- Use a separate Supabase project for the client. Do not share projects between
  clients.
- Apply the reviewed migrations from `supabase/migrations`.
- Create the executive Auth user first, then bootstrap the tenant and
  `tenant_members` row from `docs/CONFIGURATION.md`.
- Add an optional operator as a second `tenant_members` row only when needed.
- Confirm Row Level Security is enabled on every table in the exposed `public`
  schema.
- Confirm browser-readable tables have both RLS policies and the required Data
  API grants for the `authenticated` role.

## 2. Configure Supabase Auth

- Use magic links for the first private install path.
- Disable open public self-signup.
- Add the production callback URL:
  `https://CLIENT_DOMAIN/auth/callback`
- Add the local callback URL for testing:
  `http://localhost:3000/auth/callback`
- Set the Supabase Auth Site URL to the production Vercel URL or custom domain.
- Keep email link expiry short enough for a private relationship database.
- Configure a production SMTP provider for Auth delivery. Supabase's built-in
  email service is rate-limited and is not the delivery path for a client
  production install.
- Update the "Magic Link or OTP" email template so it includes `{{ .Token }}`
  along with the sign-in link. This lets users paste a code if the magic link
  was requested in one browser and opened in another.
- Send a current sign-in email and complete one fallback-code sign-in against
  the exact production URL. Keep the receipt in the restricted operator packet;
  do not store the code itself.
- Enable leaked-password protection if password login is added later.

## 3. Configure Vercel

Set these environment variables in Vercel for Production and Preview as
appropriate:

```text
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_PROJECT_REF=
# Optional after the client project is established:
EXPECTED_SUPABASE_PROJECT_REF=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CLAUDE_READ_TOKEN=
CLAUDE_JOB_TOKEN=
CLAUDE_WRITE_TOKEN=
CRON_SECRET=
DEFAULT_TENANT_ID=
OPERATOR_EMAILS=
SUPPORT_EMAIL=support@example.com
NEXT_PUBLIC_SITE_URL=
NEXT_PUBLIC_INSTALL_NAME=
```

Rules:

- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never prefix it with
  `NEXT_PUBLIC_`.
- `SUPABASE_PROJECT_REF` must be the 20-character ref for this client's isolated
  project, and `NEXT_PUBLIC_SUPABASE_URL` must use that same project ref. This
  prevents a production build from silently reconnecting to another install.
- `EXPECTED_SUPABASE_PROJECT_REF` is an optional server-only defense-in-depth
  pin. When present, it must equal `SUPABASE_PROJECT_REF`; never copy a pin from
  another install.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is supported only as a legacy fallback while
  testing older projects. Use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for new
  installs.
- The three `CLAUDE_*_TOKEN` values and `CRON_SECRET` must be long, random,
  client-unique, and distinct from one another.
- `OPERATOR_EMAILS` should be a comma-separated server-only list for the owner or
  installer accounts that may access setup tools even when they are not shown to
  the executive owner.
- `SUPPORT_EMAIL` is the client-facing concierge address and is required in
  production. Set it explicitly to `support@example.com` for the managed service;
  it never falls back to an operator login address.
- `NEXT_PUBLIC_SITE_URL` should be the production Vercel URL or custom domain so
  magic links return to the correct app.
- Enable Vercel preview deployment protection.
- Keep production URLs private and client-specific.
- Visit `/deployment` after setting Vercel variables and before the first
  production deploy.
- Run `pnpm validate:env` against the production environment before promotion.
  Production Vercel builds also run this validation automatically.

### Scoped-token compatibility release A

Use this only while moving existing Claude callers off the former shared token:

1. Add the new, distinct read and job tokens to Vercel and Claude secure
   variables before deploying the scoped-token release. The existing write token
   can remain in place for release A; all three scoped values must be distinct.
2. Set `CLAUDE_LEGACY_TOKEN_CUTOFF_AT` to an explicit UTC timestamp ending in
   `Z`, no more than 24 hours ahead. Until then, the existing write token also
   authenticates old read/job callers. Do not duplicate it into another
   persistent variable.
3. Deploy release A, switch callers to their scoped variables, and watch for
   `claude_legacy_token_accepted` telemetry. The event contains only the scope
   and cutoff, never credential material.
4. After one complete scheduled cycle with zero fallback events, remove the
   cutoff and deploy release B without compatibility fallback.

`CLAUDE_LEGACY_TOKEN` is optional and should be used only if a later write-token
rotation needs a genuinely separate temporary legacy value. It always requires
the same cutoff and may never equal the read, job, or cron credential.

If the former shared token may be compromised, do not enable compatibility;
use a short maintenance window and rotate it immediately.

## 4. Connect Claude

- Put the client-specific Claude instructions from
  `docs/CLAUDE_INSTRUCTION_PACKAGE.md` into the client's Claude project.
- Give Claude the app endpoint URLs and three scoped Claude tokens, not the
  Supabase service-role key. Use the read token only for research context, the
  job token only for job control, and the write token only for intake routes.
- Use `/api/claude/interactions` for observed facts such as meetings,
  interaction summaries, promises, and safe `last_spoke` updates.
- Use `/api/claude/pending-changes` for judgment updates, profile enrichment,
  uncertain facts, or anything the owner should approve.
- Use `/api/claude/jobs` to claim queued `contact_enrichment` jobs, and use the
  returned complete/fail endpoint paths to close each job after Claude submits
  its observed facts or review proposals.

## 5. Verify Privacy

- Visit the deployed app signed out and confirm private routes redirect to
  `/login`.
- Sign in as the executive and confirm only that tenant's rows are visible.
- Confirm all responses include:
  `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex`
- Confirm `robots.txt` disallows all crawlers.
- Run Supabase security and performance advisors after migrations.
- Rotate any secret that has been pasted into chat, screenshots, or local notes
  before production.

## 6. Client Acceptance Pass

- Import or copy the client's starter contact data.
- Run the intake interview and save Settings/Intake.
- Verify My Book, contact detail pages, Ask the Book, Networking, Changes, and
  Ops with real client context.
- Send a small Claude test write for an interaction and a pending change.
- Approve a low-risk pending change and confirm audit/provenance rows are
  created.
- Confirm promise completion and introduction updates work from the UI.

Do not move a client install out of testing until every item above passes.
