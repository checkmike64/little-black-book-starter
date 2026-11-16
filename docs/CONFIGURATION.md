# Little Black Book Configuration

This app assumes a privacy-first, concierge deployment:

- Each client gets an isolated Supabase project. This is a product rule, not a temporary scaling compromise.
- Each install supports two human roles: the executive owner and an optional operator.
- The browser only uses the Supabase publishable key.
- Claude can supply meeting and correspondence summaries from the client's Claude project.
- Claude pushes distilled relationship data, correspondence summaries, proposed updates, and transcript-derived notes into Supabase.
- Google, Gmail, and Calendar accounts are not connected to the app. Source access remains outside the app and Claude sends only the bounded context the application accepts.
- Service-role writes are reserved for the gateway, migrations, import/backfill scripts, and audited Claude-write endpoints.

For the lived Claude workflow rules from the owner's reference install, see
`docs/CLAUDE_OPERATIONAL_PLAYBOOK.md`.

For the client Claude project instruction block and endpoint payload examples,
see `docs/CLAUDE_INSTRUCTION_PACKAGE.md`.

For the production deployment sequence, see
`docs/VERCEL_DEPLOYMENT_CHECKLIST.md`.

## Required Setup

1. Create or choose the Supabase project for the client install.
2. Apply reviewed migrations from `supabase/migrations`.
3. Create the first tenant row and tenant member after the executive user exists in Supabase Auth.
4. Backfill existing rows in that client's project with the tenant id before relying on browser reads.
5. Set Vercel environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_PROJECT_REF` (the 20-character ref for this client install)
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CLAUDE_READ_TOKEN`
   - `CLAUDE_JOB_TOKEN`
   - `CLAUDE_WRITE_TOKEN`
   - `CRON_SECRET`
   - `DEFAULT_TENANT_ID`
   - `OPERATOR_EMAILS`
   - `SUPPORT_EMAIL` (`support@example.com` for the managed service)
   - `NEXT_PUBLIC_SITE_URL`
   - Vercel AI Gateway enabled for the project, using deployment OIDC or a server-only `AI_GATEWAY_API_KEY`
6. In Supabase Auth, enable magic links or SSO, disable open self-signup, and set the production Site URL plus `/auth/callback` redirect URLs.
7. Configure a production SMTP provider for Supabase Auth, then include both the
   sign-in link and `{{ .Token }}` in the "Magic Link or OTP" email template so
   browser-bound magic links have a code fallback. Complete one current delivery
   and fallback-code exercise before confirming production Auth readiness.
8. In Vercel, enable deployment protection for preview deployments and keep production URLs private.
9. Confirm every page returns `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex`.
10. Use `/deployment` as the final production preflight before a client install goes live.

Production validation requires the Supabase URL and `SUPABASE_PROJECT_REF` to
identify the same isolated client project. It also rejects
placeholder values, malformed operator email lists, provider redirects on a
different origin from `NEXT_PUBLIC_SITE_URL`, weak/reused capability secrets,
an absent or malformed support address, and unsafe setup mode. `SUPPORT_EMAIL`
is deliberately explicit and never falls back to an operator login identity.

For the scoped-token release-A transition, define
`CLAUDE_LEGACY_TOKEN_CUTOFF_AT` as an explicit future UTC timestamp ending in
`Z` and no more than 24 hours ahead. Until then, the existing write token also
authenticates old read/job callers without being copied into another variable.
Scoped credentials remain primary. Accepted fallback use logs only the scope,
cutoff, and source; remove the cutoff after a full scheduled cycle reports zero
fallback use. `CLAUDE_LEGACY_TOKEN` is optional and reserved for a later
write-token rotation that needs a genuinely separate temporary legacy value.

## Introduction Writing

The Networking screen can turn an approved introduction into a short draft in
the executive's voice. The owner reviews and copies that draft into the email
service they already use. The app neither connects to a mailbox nor sends mail.

The writing request is intentionally minimized. It may contain the introduction
reason, names, company/role, relationship summaries, recent interaction
summaries, open promises, confirmed shared groups, and the tenant voice profile.
It does not contain raw transcripts, full email bodies, phone numbers, or
unrelated private notes.

Enable Vercel AI Gateway for each isolated install. Vercel deployments use OIDC;
local development or CI may use a server-only Gateway key:

```env
AI_GATEWAY_API_KEY=YOUR_SERVER_SIDE_GATEWAY_KEY
```

The task router defaults to a current OpenAI/Anthropic primary and fallback pair.
Models are operator-owned settings and must use `provider/model` Gateway slugs.
The project budget is used by default. Set `LBB_AI_TENANT_QUOTAS_ENABLED=true`
only after matching tenant quota entities exist in Gateway; otherwise Gateway
correctly rejects the request before model execution.
They can be overridden globally or for a single task without changing client UI:

```env
LBB_AI_PRIMARY_MODEL=openai/gpt-5.4
LBB_AI_FALLBACK_MODEL=anthropic/claude-sonnet-4.6
LBB_AI_INTRODUCTION_DRAFT_PRIMARY_MODEL=anthropic/claude-sonnet-4.6
```

The same app workflow supports both providers through one provider-neutral
Gateway. Keep credentials server-side and never expose them with a
`NEXT_PUBLIC_` name. The tenant's `voice_profile` remains in that client's
isolated Supabase project. Each generation records task, prompt version, prompt
hash, selected model, latency, and token usage without storing prompt or response
content in telemetry.

Claude's external research and meeting-context gateway remains a separate, scoped data
producer. Its approved writes and provenance enter Supabase through the existing
Claude routes. In-app AI may rank, retrieve, explain, or draft from that evidence;
it does not replace Supabase as the source of truth and cannot silently promote
model output into contact facts.

## Contact Enrichment Worker

`/api/automation/enrichment` runs every 10 minutes (Vercel cron, `CRON_SECRET`)
and works through queued `contact_enrichment` jobs, so new people and profile
gaps are researched without a Claude project claiming them by hand.

For each job it reads the Book (profile, meeting notes and distilled
transcripts, logged interactions, calendar meetings, and posts already collected
by content scans), then the public web: the saved website or the email's company
domain, one Google search (`apify/google-search-scraper`), the LinkedIn profile
(`harvestapi/linkedin-profile-scraper`), and an Instagram profile
(`apify/instagram-profile-scraper`) when one is saved or linked from their own
site. The `contact_enrichment` AI task turns that into facts. Each fact must
quote its source word for word. Public-web facts are dropped unless the model
confirms the sources describe the same person. Relationship judgments may come
only from the owner's own records.

Results are pending changes, never direct writes:

- `profile` (low risk): company, role, summary, location, website, socials. Fills empty fields only.
- `context` (low risk): services, current asks, recent activity, how you met.
- `referral` (high risk): relationship type, why stay in touch, referral fit.
- `corrections` (high risk): replaces an existing value only with a stated reason; includes `previous_values`.

Fields already waiting in Changes, or dismissed with the same value in the last
180 days, are not proposed again. The worker never proposes email or phone
numbers, private notes, personal notes, or trust levels. Jobs that need a person
in the loop (owner-context revisions, relationship commands, test jobs) stay in
the queue for a Claude project.

Pacing is per install, in Settings ("Automatic profile research"), stored in
`tenants.settings.automation.enrichment`:

- `enabled` (default true), `daily_limit` (default 25 people per UTC day, two per run).
- `catchup_until` / `catchup_daily_limit` (default 150): until that time, up to
  four people per run are researched in parallel. Windows ending more than seven
  days out are ignored. Set one after every bulk import.

Global overrides for every install on a deployment:

```env
LBB_ENRICHMENT_WORKER_ENABLED=false # stop the worker everywhere
LBB_ENRICHMENT_DAILY_LIMIT=40       # cap every install's daily limit
```

Operating procedure, monitoring, troubleshooting, and backups:
`docs/PROFILE_RESEARCH_SOP.md`.

Apify calls need `APIFY_API_TOKEN` and the tenant's `providers.apify.enabled`.
They count against `providers.apify.monthly_cost_limit_usd` together with content
scans and are recorded as `provider.apify.contact_enrichment` usage events. When
the budget is used up the worker still runs on Book context and direct website
reads. Failed jobs retry after 30 and 60 minutes, then settle as failed. AI
configuration, budget, or audit-ledger errors pause the worker for six hours
(audit action `contact_enrichment.paused`) without using up job attempts.

The AI ledger must accept the `contact_enrichment` task before this route is
deployed: apply `20261001000000_contact_enrichment_ai_ledger.sql` first.

## First Tenant Bootstrap

After the client user signs in once and exists in `auth.users`, run a service-role/admin SQL block like:

```sql
with created_tenant as (
  insert into public.tenants (name, slug, owner_user_id, settings)
  values (
    'Client Name',
    'client-name',
    'AUTH_USER_UUID_HERE',
    '{
      "modules": {
        "ask": true,
        "networking": true,
        "engagement": true,
        "want_to_know": true
      },
      "quotas": {
        "enrichment_monthly": 25,
        "pulse_posts_monthly": 60,
        "claude_writes_daily": 100
      },
      "write_rules": {
        "mechanical_writes": true,
        "judgment_fields": "proposal_only",
        "transcript_storage": "intake_full_then_notes"
      },
      "onboarding": {
        "network_thesis": "",
        "referral_lanes": "",
        "prospecting_focus": "",
        "outreach_focus": "",
        "relationship_rules": "",
        "intake_notes": ""
      },
      "prospecting": {
        "buckets": []
      },
      "voice_profile": {
        "owner_voice": "",
        "assistant_style": "",
        "default_outreach_tone": ""
      }
    }'::jsonb
  )
  returning id
)
insert into public.tenant_members (tenant_id, user_id, role, status)
select id, 'AUTH_USER_UUID_HERE', 'owner', 'active'
from created_tenant;
```

For an existing project like the owner's current database, backfill the existing relationship tables after the tenant exists:

```sql
update public.contacts set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
update public.connections set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
update public.introductions set tenant_id = 'TENANT_UUID_HERE' where tenant_id is null;
```

## Claude Project Boundary

For the client’s Claude project:

- Complete the app's Intake page before treating Claude as production-ready for
  that client. At minimum, capture the network thesis, referral lanes,
  relationship rules, owner voice, and assistant style.
- Any source authorization happens in the client's Claude environment, outside
  the app. The application receives only the scoped summaries and structured
  observations submitted through its Claude endpoints.
- Claude should initially read the full transcript so the client can validate the quality of what is being extracted.
- The app should store detailed notes and structured facts by default, not raw full transcripts, unless the client explicitly wants transcript retention.
- Claude should write distilled relationship data, proposed updates, correspondence summaries, transcript-derived notes, and provenance into Supabase.
- Claude should write judgment changes into `pending_changes`, not directly into `contacts`.
- Claude should call narrow app endpoints such as `POST /api/claude/interactions`,
  `POST /api/claude/pending-changes`, and the `POST /api/claude/jobs`
  enrichment-job handoff routes; do not put the Supabase service-role key inside
  Claude project instructions.
- Use distinct server-only tokens for the three Claude capabilities:
  `CLAUDE_READ_TOKEN` for `research-context`, `CLAUDE_JOB_TOKEN` for job claim
  and completion/failure, and `CLAUDE_WRITE_TOKEN` for every intake route.
- Mechanical updates such as observed interactions, promises, safe `last_spoke`,
  and computed relationship strength refreshes can be written through the app
  gateway when `tenants.settings.write_rules.mechanical_writes` is enabled.
- Every Claude-originated write should include `source`, `proposed_by = 'claude'`, and enough payload/provenance to audit later.

## App Configuration Screens

- `/intake` stores the client-specific operating context: network thesis,
  referral lanes, prospecting focus, outreach focus, relationship rules, intake
  notes, prospecting bucket blueprint, owner voice, assistant style, and default
  outreach tone.
- `/settings` controls enabled modules, monthly enrichment quota, monthly social
  pulse quota, daily Claude write budget, mechanical-write posture, and transcript
  storage posture.
- Optional modules are hidden in the sidebar and route-gated. A copied URL to a
  hidden module redirects back to Settings.
- Settings writes are audited in `audit_log` after the signed-in user is verified
  as the active tenant owner or operator.

### Claude interaction endpoint

`POST /api/claude/interactions`

Headers:

```http
Authorization: Bearer CLAUDE_WRITE_TOKEN
Content-Type: application/json
```

Body:

```json
{
  "idempotency_key": "daily-closeout-2026-07-17-jordan",
  "occurred_at": "2026-07-17T15:00:00-06:00",
  "interaction_type": "meeting",
  "title": "Intro call with Jordan",
  "summary": "Discussed Jordan's new operator community and possible podcast guest ideas.",
  "source": "daily_meeting_prep_brief",
  "source_ref": "calendar-event-id-or-transcript-id",
  "contact_ids": ["CONTACT_UUID"],
  "update_last_spoke": true,
  "promises": [
    {
      "contact_id": "CONTACT_UUID",
      "direction": "owner_owes_contact",
      "promise_text": "Send Jordan two podcast guest suggestions.",
      "due_on": "2026-07-24"
    }
  ]
}
```

This endpoint is for directly observed mechanical facts. It logs the interaction,
links contacts, updates `last_spoke` only forward in time, can create explicit
promises, writes audit/usage records, and returns the existing row on retries
when `idempotency_key` is repeated. Successful new interaction writes also
refresh computed relationship strength for non-overridden contacts.

### Claude pending-change endpoint

`POST /api/claude/pending-changes`

Headers:

```http
Authorization: Bearer CLAUDE_WRITE_TOKEN
Content-Type: application/json
```

Body:

```json
{
  "idempotency_key": "social-pulse-2026-07-17-jordan-community",
  "change_type": "field_update",
  "contact_id": "optional-contact-uuid",
  "summary": "Jordan launched a new operator community.",
  "risk_level": "low",
  "payload": {
    "fields": {
      "recent_activity": "Launched a new operator community; accepting founding members.",
      "current_asks": "Operators for the community; fall podcast guests."
    }
  },
  "source": "client_claude_project"
}
```

Approval behavior:

- `field_update` proposals with a `contact_id` can be approved from the Changes screen.
- `contact_enrichment` proposals with a `contact_id` can be approved from the
  Changes screen and queue a post-approval enrichment follow-up.
- `new_contact` proposals open a detailed review screen. The owner/operator can
  approve them as new contacts or merge the proposed fields into an existing
  contact when Claude or the reviewer spots a duplicate. Either path writes
  field provenance, audits the action, and queues enrichment follow-up.
- Want to Know membership is owner-controlled. Claude can research people the
  owner already added, but the gateway rejects automated candidate proposals.
- Supported contact fields are allow-listed in the server action; IDs, tenant ownership, timestamps, and system fields are not editable through the proposal payload.
- Approval writes the allowed fields to `contacts`, marks the proposal approved, adds audit-log detail, and records field provenance.
- Dismiss and needs-edit actions mark the proposal reviewed without changing contact data.
- Connections, introductions, and other structural changes should stay pending
  until their dedicated review workflows are built.
- Repeated `idempotency_key` values return the existing pending change rather than creating duplicates.

`POST /api/claude/jobs`

Use `Authorization: Bearer CLAUDE_JOB_TOKEN` for this endpoint and its
`complete` and `fail` routes.

- Claims the next due queued enrichment job for the tenant and marks it running.
- Returns the target contact, recent interactions, open promises, pending
  changes, and field provenance so Claude has enough context to work safely.
- Claude should finish the work by creating pending changes and/or interaction
  writes through the narrow endpoints, then call
  `POST /api/claude/jobs/{JOB_ID}/complete`.
- If context is missing or verification is blocked, Claude should call
  `POST /api/claude/jobs/{JOB_ID}/fail` so the job can retry or settle as failed
  after repeated attempts.
- The Ops page has a safe test panel that creates `contact_enrichment` jobs with
  `payload.test_mode = true` and claims only test jobs, allowing each client
  install to verify the Claude loop before live enrichment runs.

## Configuration Answers

- Supabase tenancy: one isolated project per client.
- Human users: executive owner plus an optional operator only.
- Private notes: visible to the executive in the browser.
- Transcript posture: full transcript is used at intake/extraction time; detailed notes and structured data are stored by default.
- Ask-the-Book: users should be able to query the people, notes, interactions, promises, and relationship context in the database.
- Correspondence storage: store both interaction-level summaries and contact-level distilled facts. Interactions answer "what happened over time"; contacts answer "what matters about this person now."
- Promise tracking: promises extracted from calls/emails/messages get their own `promises` rows and can be completed, skipped, or stopped.
- Person timeline: keep interaction history queryable for Ask/provenance, but do not make a full visible timeline a primary person-page feature.
- Relationship strength: old correspondence can influence computed strength, but the executive can override the bucket manually.
- Current computed strength buckets are `Hot`, `Warm`, `Cooling`, `Cold`, and `Unknown`. The refresh function updates only contacts where `relationship_strength_override = false`.
- Field provenance: every AI-derived field should have inspectable source/provenance, displayed subtly so action buttons remain visually primary.
- GDPR posture: basic data ownership, export, delete/offboarding, retention disclosure, and subprocessor disclosure. No HIPAA scope.

