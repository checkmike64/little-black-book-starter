# Client Install Rehearsal

Use this before every new Little Black Book client install. The purpose is to
prove that the app can be safely pointed at a clean Supabase project without
leaking data, exposing secrets, or depending on the owner's reference project.

## Local Preflight

Run:

```bash
pnpm check
pnpm rehearsal
```

`pnpm rehearsal` checks:

- public table RLS coverage in migrations,
- public table policy coverage,
- private RLS helper posture,
- private transcript bucket posture,
- public secret naming mistakes,
- required install environment variables,
- no-index and privacy headers,
- Claude gateway route presence.

## Clean Install Sequence

1. Create one Supabase project for the client.
2. Apply `supabase/migrations` in order.
3. Create the executive Auth user.
4. Bootstrap `tenants` and `tenant_members` for the executive owner.
5. Add an optional operator only if needed.
6. Set Vercel environment variables from `.env.example`.
7. Configure Supabase Auth callback URLs from `/deployment`.
8. Confirm signed-out private routes redirect to `/login`.
9. Confirm `X-Robots-Tag` and `robots.txt` block indexing.
10. Install Claude instructions with app endpoints and distinct read, job, and
    write capability tokens only.
11. Send one Claude interaction write and one pending-change write.
12. Approve one low-risk pending change and verify audit/provenance rows.

## Operator Playbook Phases

The Launch page turns install evidence into the same repeatable playbook:

1. Configure the private install: tenant, production wiring, modules, and setup thesis.
2. Import and verify relationship data: first contact batch plus high-value cleanup.
3. Prove the Claude write loop: job creation, claim, completion, command output, review, audit, and provenance.
4. Verify review and owner judgment lanes: pending changes, Ask decisions, and low-risk approval.
5. Run the launch rehearsal: job-to-action lifecycle with a representative contact.
6. Package owner handoff: privacy signoff, launch notes, owner preview, and owner packet.

Only the final Book is owner-facing. Intake, Claude setup, Ops, Deployment,
Quality, Export, and Settings stay operator-only unless admin tools are enabled.

## Production Hold Conditions

Do not hand off a client install if any of these are true:

- `pnpm rehearsal` fails.
- Supabase advisors have unresolved security warnings.
- The owner can see another tenant's rows.
- A signed-out browser can access private app pages.
- Claude has any Supabase service-role key.
- Vercel preview deployment protection is off.
- Magic-link callbacks do not return to the production app.
- Any first-cohort commercial evidence check is unconfirmed: signed and
  versioned agreement, billing owner and collection path, support contact and
  process, backup plus isolated restore proof, retention/offboarding plan, or
  owner acceptance.

Use `docs/COMMERCIAL_LAUNCH_READINESS.md` to collect and verify those six
operator-held evidence records before confirming them on `/deployment`. These
checks are intentionally fail-closed and do not define prices, contract text,
retention periods, or support commitments.
