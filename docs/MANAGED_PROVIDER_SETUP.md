# Managed provider setup

Little Black Book clients do not create or manage enrichment-provider accounts.
the owner owns the provider relationship, sets each install's limits, and bills usage
according to the saved provider plan.

The same model applies to in-app writing and relationship intelligence. the owner may
fund managed OpenAI and Anthropic capacity through Vercel AI Gateway, while each
isolated Vercel install receives only its scoped Gateway authorization and
operator-controlled task policy. Client relationship data remains in the
client's Supabase project and only the minimum task context is sent per request.

## Per-client boundary

Each client keeps:

- an isolated Supabase project containing their relationship data and usage ledger;
- an isolated Vercel project containing only that install's server secrets;
- operator-only provider toggles, cost limits, included usage, and markup;
- no provider keys, billing controls, or technical setup in the executive UI.

For the first concierge installs, use isolated Vercel projects with Gateway OIDC
and a per-project budget. Do not copy direct OpenAI or Anthropic keys into client
frontends. The in-app task catalog, model fallback, prompt version, privacy tags,
and token ledger are provider-neutral. If central account-wide ceilings or more
complex billing become necessary, add a the owner-owned service boundary without
moving permanent relationship data out of the client project.

## Apify

Use the owner's Apify account, but create a separate scoped token for every client
install. Do not reuse one unrestricted token across all Vercel projects.

The token should be limited to:

- read the reusable task used by the install;
- run the task's underlying Actor;
- read the run and its generated dataset;
- no account administration, billing changes, resource deletion, or unrelated
  Actors and datasets.

Save the token as `APIFY_API_TOKEN` in that client's Vercel project. Save a
different random `APIFY_WEBHOOK_SECRET` in the same project. Task IDs and client
limits are configured in the private Settings screen.

Every run records:

- the client tenant and local scan run;
- the Apify run ID;
- reserved and finalized provider cost;
- the pricing snapshot used when the run started;
- gross billable usage after markup;
- whether the cost is estimated or finalized.

The daily automation reconciles recently completed runs because provider cost can
take a few seconds to settle after a run finishes.

## Outscraper

Outscraper uses the same operator-only plan and usage-ledger shape. Until its
production adapter is enabled, leave the provider toggle off.

If the account supports independently revocable keys, use one key per install. If
it provides only one broad account key, keep that key in a central provider gateway
instead of copying it into every client deployment. The client app should receive
normalized results and usage receipts, never the account key.

## Provider gateway trigger

Build the gateway before the first of these occurs:

- more than five live client installs;
- a provider offers only one broad account credential;
- aggregate provider spend needs a single hard ceiling;
- rotating a credential would require changing multiple client deployments.

The client app is already shaped for that move: provider plans and usage receipts
are provider-neutral, while permanent contact data remains in the client project.

## Client pricing

Each provider plan stores:

- `monthly_cost_limit_usd`: hard ceiling on the owner's provider spend for the install;
- `markup_percent`: percentage added to provider cost;
- `included_usage_usd`: monthly usage absorbed by the base service price;
- `enabled`: whether the provider may run for that install.

The client charge for the month is:

`max(0, provider cost with markup - included monthly usage)`

Usage figures are operator-only. They can be exported for invoicing, while the
executive sees only the finished recommendations and relationship actions.

## New-client checklist

1. Create the isolated Supabase and Vercel projects.
2. Bootstrap the tenant and operator membership.
3. Create the install's scoped provider token under the owner's account.
4. Add server-only credentials to Vercel.
5. Set provider toggles, cost limits, markup, and included usage in Settings.
6. Configure reusable task IDs and run a one-source proof.
7. Confirm the provider cost and client billable amount in Settings.
8. Enable scheduled monitoring only after the proof passes.
9. Add the client's voice profile and verify one introduction draft against a
   known real relationship before enabling in-app writing.
10. Verify one introduction draft can be reviewed and copied without connecting
    the client&apos;s mailbox to the application.
