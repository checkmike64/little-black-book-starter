# Supabase Bootstrap And Audit

Use `/deployment` for the copy-ready SQL blocks. This document explains when
to run each block during a Little Black Book client install.

## Tenant Bootstrap SQL

Run after:

- the client Supabase project exists,
- all migrations have been applied,
- the executive owner has signed in once,
- the owner appears in `auth.users`.

The bootstrap block creates:

- one `tenants` row,
- one `tenant_config` row,
- one active `tenant_members` row for the executive owner.

Run the optional operator membership block only after an optional operator has signed in
once and appears in `auth.users`.

## Existing Data Backfill SQL

Use only when converting an existing single-client project that already has rows
without `tenant_id`.

Do not run the backfill block for a clean client install. Fresh imports and
Claude writes should already include the tenant id.

## Live Audit SQL

Run after bootstrap and before production handoff. The audit reports:

- RLS status and policy count for every expected public table,
- private transcript bucket posture,
- unexpected public `SECURITY DEFINER` functions,
- active tenant membership count and roles.

Every row should be `pass`, or an intentional `review` item that has been
manually explained before the install is handed to the client.

## Production Hold

Do not hand off an install if:

- the owner cannot sign in,
- `/deployment` has blocking environment warnings,
- the live audit reports missing RLS or missing policies,
- `transcripts` is public,
- Claude has a Supabase service-role key,
- the owner can see rows from another tenant or project.
