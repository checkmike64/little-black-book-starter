# Profile Research: Standard Operating Procedure

Every person added to a Book needs a researched profile: company, role, a
one-line summary, website, social profiles, what they offer, how the owner
knows them. The app queues a `contact_enrichment` job for each new person and
for profile gaps it finds each day. The contact enrichment worker
(`/api/automation/enrichment`) does that research and sends the findings to
Changes for the owner to approve.

## Why this procedure exists

Before the worker existed, the queue was drained only when an operator's
Claude project claimed jobs by hand. On the first production install nobody
did for three weeks: 92 people waited, and contacts added a month earlier
still showed "6 profile details are missing." Nothing in the app said so.
This procedure, the worker, the readiness check, and the stale-queue alert
exist so that cannot happen silently on a client install.

## Install checklist (every new client)

1. **Environment.** Set `CRON_SECRET`, enable Vercel AI Gateway for the project,
   and set `APIFY_API_TOKEN` if the client's plan includes web research.
2. **Schema.** Apply migrations through
   `20261001000000_contact_enrichment_ai_ledger.sql` with the pinned CLI
   (see `FOUNDATION_INSTALL_RUNBOOK.md`). The AI ledger rejects the research
   task without it.
3. **Preflight.** `/deployment` must show "Profile research worker: Running
   every 10 minutes". "Profile research connector: Book-only research" is
   acceptable only when the client's plan excludes web research.
4. **Tenant plan.** In Settings, turn on "Automatic profile research" (on by
   default) and set the Apify plan and monthly cost limit. Research spend
   shares that limit with content monitoring.
5. **After the first import.** In Settings, set "Catch up until" to two days
   out. The worker then researches up to 150 people a day, four at a time,
   and returns to the normal pace (25 a day) by itself when the date passes.
   Dates more than seven days out are ignored.
6. **Prove it.** First, `curl -s -o /dev/null -w "%{http_code}" <site>/api/automation/enrichment`
   must print `401`. A `307` means the login proxy is intercepting the cron and
   it will never run (`tests/cron-routes-reachable.test.ts` guards this).
   Within 30 minutes, Changes shows proposals from `enrichment_worker`, and this
   returns rows:

   ```sql
   select id, status, result->>'outcome', result->>'summary'
   from public.jobs
   where job_type = 'contact_enrichment'
     and result->>'completed_from' = 'enrichment_worker'
   order by updated_at desc limit 5;
   ```

## What the owner sees

Each researched person produces up to four proposals in Changes:

| Group | Risk | Contents |
|---|---|---|
| Public profile | low | company, role, summary, location, website, social profiles; fills empty fields only |
| What they offer / working on | low | services, current asks, recent activity, how you met |
| Referral fit and relationship | high | relationship type, why stay in touch, ideal referral, intro blurb |
| Out of date | high | replaces a saved value, with the reason and the previous value; also fixes a saved name that is only a handle or first name ("Brob" to "Braden Roberts") |

Low-risk proposals can be approved in bulk. Every value quotes its source in
the proposal's administrative record. Nothing changes the Book until approved.

The worker never proposes email addresses, phone numbers, private or personal
notes, or trust levels, and it does not re-propose a field that is already
waiting or was dismissed with the same value in the last 180 days.

## Weekly operator check (5 minutes per install)

- Ops page: the overdue queue count is 0, or falling during a catch-up.
- No recent `contact_enrichment.queue_stale` or `contact_enrichment.paused`
  rows in `audit_log`. A `contact_enrichment.duplicate_contact` row means two
  active records share an email; the newer one was not researched. Merge them
  (keep the older record with the history, archive the newer). Queue-stale means due jobs waited over 24 hours.
  Paused means AI configuration, AI budget, or the AI ledger failed, and the
  worker is waiting six hours before trying again.
- Changes is not piling up. If the owner has more than about 50 pending
  research proposals, lower "People researched per day" until they catch up.

## Cost

Per person: one Google search (about $0.004), one LinkedIn profile ($0.004),
and sometimes one Instagram profile ($0.003), plus one AI generation. Website
reads are direct and free. Apify spend is recorded as
`provider.apify.contact_enrichment` usage events and stops at the tenant's
monthly limit. Past the limit, research continues with Book notes and
websites only.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Preflight says "AI Gateway missing" | Gateway not enabled for the project | Enable AI Gateway (OIDC) or set `AI_GATEWAY_API_KEY` |
| `contact_enrichment.paused` with "audit receipt could not be recorded" | Ledger migration not applied | Apply `20261001000000_contact_enrichment_ai_ledger.sql` |
| Jobs fail with no web sources | Apify plan disabled or budget used | Check Settings, Apify plan, and this month's provider usage |
| Queue stale, worker runs fine | More people queued than the daily limit allows | Set a catch-up window |
| Jobs stay queued and are never claimed | They are owner-context revisions or relationship commands | Process them from the Claude project (`CLAUDE_ENRICHMENT_JOB_RUNBOOK.md`) |
| Proposals about the wrong person | Common name, weak identity signal | Dismiss them; the identity check and dismissal memory prevent repeats |

Stop the worker for every install with `LBB_ENRICHMENT_WORKER_ENABLED=false`,
or for one install by turning off "Automatic profile research" in Settings.

## Backups

Supabase keeps seven days of nightly backups inside the same account. Each
install also needs an independent restore kit, taken monthly and before every
production schema push:

```sh
LBB_BACKUP_PROJECT_REF=<project ref> pnpm backup:export
```

It reads through Supabase's read-only query endpoint (a token with
Database: Read is enough), writes every table plus the migrations and a
`RESTORE.md` to `LBB_BACKUP_DIR` (default: iCloud Drive "Black Book Backups"),
keeps the last 12, and exits non-zero if any table could not be read.
Compare `manifest.json` row counts with the previous run; a sharp drop in
`public.contacts` means something is wrong.
