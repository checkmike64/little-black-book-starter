# Little Black Book

A self-hosted relationship manager for keeping useful context and staying in touch. Next.js, React, TypeScript, and Supabase power private contact profiles, conversation history, promises, introductions, and optional AI assistance.

**License: all rights reserved.** Obtain separate written permission before use, modification, or redistribution. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).

## What it does

- **Keep in touch:** Today lists contacts due for a conversation, whether or not they post online. Tier 1 defaults to 30 days, Tier 2 to 60, Tier 3 to 90. Change the intervals in Settings.
- **Personal cadence:** Override a tier on a contact profile. Dormant and ad hoc cadence disables recurring reminders. An unknown conversation date prompts a check-in or history correction.
- **Log conversations:** A dated touchpoint updates the conversation history and restarts its interval. Viewing a profile, drafting a message, or scanning posts does not count as contact.
- **Human review:** AI proposes changes to relationship judgments for approval. Drafting does not send messages.
- **Optional integrations:** Configure your own Claude connection, AI provider, public-content scans, or meeting-note integrations. No provider account is supplied.

## Requirements

Node.js 22.18+ and pnpm 11.25; a dedicated Supabase project. For local database verification, also install Docker and Supabase CLI **2.115.0** (the version pinned in CI). A basic relationship manager does not require paid AI or content providers. Email-link sign-in needs working Supabase email delivery.

## Install

After obtaining permission, download or clone this repository:

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
```

1. Create a **new, isolated** Supabase project. Keep existing personal or company databases separate.
2. Apply the SQL files in `supabase/migrations/` in filename order. With the pinned CLI, run `supabase login`, `supabase link --project-ref YOUR_PROJECT_REF`, then `supabase db push`. Review the target before applying; these commands create the application schema.
3. In Supabase Authentication, create/invite your owner user, configure Site URL and redirect URLs for `http://localhost:3000/auth/callback` and your production callback, and configure email delivery. Public signup is disabled in the local configuration; invite users explicitly.
4. Run `supabase/bootstrap.sql` in that project's SQL editor after replacing the owner email, install name, and slug. The query returns the tenant UUID. The optional operator block is commented out. See [bootstrap notes](docs/SUPABASE_BOOTSTRAP_AND_AUDIT.md).
5. Fill `.env.local` with your project URL, publishable key, server-only service-role key, tenant UUID, app URL, support address, and operator allowlist. For a personal install, put **your own owner email** in `OPERATOR_EMAILS` so you can enable Admin mode and configure Settings.
6. Generate distinct gateway and scheduler secrets if using those routes: `openssl rand -hex 32` for each value. Do not leave the example credentials active. Optional provider variables can remain unset until that feature is enabled.
7. Run `pnpm dev`, open `http://localhost:3000`, and sign in using the invited email. Enable Admin mode, open Settings, choose your timezone, and review tier intervals. Add a contact with a tier, then log your last conversation or leave it unknown to see the reminder.

The application reads tier defaults from the tenant's existing settings JSON, so the keep-in-touch feature needs no new database migration. The downloadable source contains the complete schema for new installs.

## Customize

See [CUSTOMIZATION.md](docs/CUSTOMIZATION.md) for branding, intervals, roles, timezone, module switches, writing style, and provider options. All provider credentials belong to the installer. The default timezone is UTC; configure it before relying on day-based reminders.

## Check and deploy

```sh
pnpm check
# Optional full local database check (Docker and pinned CLI required):
pnpm db:start
pnpm db:verify
pnpm db:stop
```

`pnpm check` runs lint, TypeScript, tests, a static install rehearsal, and a production build. Database replay and a real authenticated browser session are separate checks. `ALLOW_SETUP_MODE=true pnpm dev` allows an empty local preview; never enable setup mode on a public deployment.

For deployment, set the same server environment on your host, set `NEXT_PUBLIC_SITE_URL` to your own HTTPS domain, configure Supabase callbacks, run `pnpm validate:env`, and follow [deployment checks](docs/VERCEL_DEPLOYMENT_CHECKLIST.md). Vercel is optional; `pnpm build` and `pnpm start` support a Node host. Configure an external scheduler if your host does not run `vercel.json` jobs.

## Privacy and boundaries

Use a separate Supabase project per install. Keep RLS enabled; service-role keys and provider tokens stay server-only. Do not commit `.env.local`, contact exports, recordings, backups, or provider responses. The included sample contacts are demonstration fixtures. No existing private deployment or Git history is part of this package.
