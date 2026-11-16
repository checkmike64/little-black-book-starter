# Customize your install

## Keep-in-touch intervals

In Admin mode, Settings → Keep in touch configures Tier 1, 2, and 3 in days (1–3650). Defaults are 30, 60, and 90. Settings are tenant-specific and immediately affect Today. On a contact profile, a blank touch cadence uses the tier default; an explicit cadence overrides it. Dormant, no active cadence, and ad hoc disable recurring reminders. Tier 3 gets reminders even without an ask, social post, or strong relationship rating.

The latest logged `last_spoke` date anchors the interval. A contact is due on the interval boundary and remains visible until a conversation is logged. Missing/invalid dates prompt a check-in or history correction. Future dates never become overdue. Archived contacts are excluded. Reminders use the configured IANA timezone and do not send outreach automatically. Update the tier or choose Dormant if you no longer want recurring contact.

Existing explicit per-contact cadences remain overrides when tier defaults change. Clear a contact's cadence to switch it to the new tier defaults.

## Identity and roles

`NEXT_PUBLIC_INSTALL_NAME` sets the install label, `NEXT_PUBLIC_SITE_URL` sets callbacks, and `SUPPORT_EMAIL` sets your support link. Use your own email in `OPERATOR_EMAILS` to manage a personal install. The database supports owner and operator memberships; operator access exposes privileged configuration. Enable Admin mode before opening Settings. No original owner's account is required.

Change the app metadata and icon files in `app/` to rename or rebrand the tool. Existing styling is in `app/globals.css` and documented in `DESIGN.md`.

## Timezone, modules, and voice

Set your IANA timezone in Settings (UTC is the portable default). Configure module switches, daily pacing, quotas, and optional provider budgets there. Intake captures your networking goals, referral lanes, relationship rules, and writing voice. Start empty and supply your own context rather than importing somebody else's brand instructions.

## Optional services

The contacts and recurring reminder queue work without AI keys, social scans, or calendar integrations. Enable those features only after adding your own provider credentials, choosing a model, and reviewing quotas. Providers start disabled; default markup is zero in this distribution. Review deployment validation because enabling a feature can require additional secrets.

For Claude gateway workflows use the separate read, job, and write tokens in `.env.example`; never give an assistant the service-role key. AI relationship judgments stay proposal-only. No automatic message sending is introduced.

## Developer entry points

- `lib/keep-in-touch.ts`: cadence parsing, defaults, date boundaries, and queue ordering.
- `lib/tenant-settings.ts`: tenant configuration and normalization.
- `app/(portal)/settings/`: administration form and authorized settings writes.
- `lib/dashboard/data.ts`: tenant-scoped, paginated contact loading.
- `app/(portal)/dashboard/page.tsx`: keep-in-touch queue.
- `app/(portal)/contacts/[id]/`: cadence editor and dated activity capture.
- `supabase/migrations/`: schema baseline plus forward migrations for new databases.

Do not point this distribution at an existing private production database. Historical private migration ledgers and owner-specific data repair operations were intentionally omitted.
