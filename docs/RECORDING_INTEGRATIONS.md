# Meeting recording integrations

Little Black Book presents one **Recordings** timeline while keeping each
recorder behind a provider adapter. Notion AI Meeting Notes is the preferred
the owner connection; Fireflies and Fathom remain available for client installs.
Source accounts outside these supported adapters are handled through the scoped
Claude intake rather than connected to this application.

## Privacy contract

- Provider credentials and signing secrets are stored in Supabase Vault.
- Provider webhooks select a tenant only through the opaque connection ID in
  the URL. Tenant IDs in payloads are ignored.
- Fireflies and Fathom signatures are verified over the raw request body before
  a receipt is created.
- The raw webhook body and transcript text are never stored or logged. A SHA-256
  hash supports replay and provenance checks.
- Public `transcripts` rows contain distilled notes, provider links, proposed
  action items, and sanitized provenance. Provider summaries are visibly
  labeled as AI-generated proposals and cannot enter Ask, networking, contact
  history, or introduction drafting until the owning user confirms them and
  selects the known participants. Operators can configure and troubleshoot the
  source, but cannot label provider notes as owner-confirmed evidence.
- Audio and video are not copied into Little Black Book.
- The configured recording-owner email is required. Fathom requests use its
  `recorded_by[]` filter and Fireflies reconciliation uses `mine: true`; fetched
  artifacts are rejected unless their recorder/organizer matches that owner.
- Signed events are committed to a metadata-only durable receipt before the
  provider receives `202`. A dedicated five-minute worker leases, retries, and
  refetches artifacts; daily reconciliation is a bounded fallback.
- The current adapters retain no raw transcript object. If a future policy
  enables private raw-object recovery, only real Storage objects receive a
  retention date and purge receipt. Derived notes remain until separately
  dismissed/deleted under the client policy.
- Disconnect disables local intake immediately. Fathom webhook revocation is
  attempted automatically and retried durably; Fireflies upstream cleanup is
  shown as pending until the operator removes its webhook. Derived notes remain.

## Notion AI Meeting Notes

1. The recording owner selects **Connect Notion** and authorizes the workspace
   through the install's public Notion OAuth connection. Tokens are encrypted in
   Supabase Vault and cannot be viewed by owners or operators.
2. A signed Notion webhook for `page.created` and `page.content_updated` starts
   a bounded reconciliation as soon as Notion publishes the event. The
   five-minute recording worker remains the recovery path and queries only
   meeting notes where the connected Notion user is an attendee.
3. When Notion reports `notes_ready`, the adapter reads the summary, notes, and
   transcript child blocks. It stores the summary and proposed action items,
   hashes the transcript for provenance, and discards the transcript text.
4. Notion attendee IDs are not treated as contact identity. The adapter matches
   one unambiguous calendar event by owner, time, and title, then reuses that
   event's tenant-scoped attendee/contact matches. Ambiguous meetings remain
   unlinked for owner review.
5. Notion AI output stays `proposal` evidence until the recording owner confirms
   the notes and participants. Disconnect deletes the stored OAuth tokens while
   leaving previously confirmed relationship history intact.
6. After confirmation, each proposed follow-up is filed explicitly as a
   Movement action, an owner promise, a contact promise, context, or dismissed.
   Routing is atomic and replay-safe; it never stores the raw transcript.

The connection uses Notion API version `2026-03-11` and the official
`POST /v1/blocks/meeting_notes/query` endpoint. No Notion page content beyond
the meeting-note summary, notes, and transient transcript hash is ingested.

### One-time webhook activation

1. Set a long random `NOTION_WEBHOOK_SETUP_SECRET` in the production server
   environment and redeploy.
2. In the private Meeting Inbox, enable admin mode and copy the one-time webhook
   URL from **Operator setup · activate the Notion webhook**.
3. In the public Notion connection settings, create one subscription for
   `page.created` and `page.content_updated` using that URL.
4. Reload the Meeting Inbox after Notion sends its verification request. Copy
   the captured token into Notion's **Verify** dialog.
5. Rotate or remove `NOTION_WEBHOOK_SETUP_SECRET` and redeploy. The signing
   token remains encrypted in Supabase Vault. `NOTION_WEBHOOK_VERIFICATION_TOKEN`
   is only an emergency server-side override.

## Fireflies pilot

1. In Recordings, an operator connects Fireflies using the owner account API
   key and a new signing secret. Start with `my_recordings`.
2. Copy the generated webhook URL into Fireflies Webhooks V2.
3. Configure the same signing secret and subscribe to `meeting.transcribed` and
   `meeting.summarized`. The earlier transcript-ready event never marks a healthy
   connection broken while the summary is still pending.
4. The app verifies `X-Hub-Signature` with HMAC-SHA256, records a replay-safe
   receipt, fetches the transcript through GraphQL, and discards the raw text
   after hashing and distillation.

Team-wide import is disabled for the the owner pilot and first client release.

## Fathom pilot

1. In Recordings, an operator connects Fathom using the owner API key.
2. The app validates the key and automatically creates an owner-only webhook
   for the generated connection URL. It requests summaries and action items,
   not transcript text or CRM payloads.
3. The durable worker refetches the meeting through Fathom's API, hashes any
   transcript used for processing, and discards the raw text.
4. The app validates `webhook-id`, `webhook-timestamp`, and
   `webhook-signature`, including a five-minute replay window.

Reusable client onboarding should replace API-key setup with a registered
Fathom OAuth app after the the owner pilot proves the import contract.

## Release acceptance

Before enabling a provider in production, test OAuth state replay, token refresh,
sequential
and concurrent replay, disabled connections, cross-tenant connection IDs,
provider timeouts, reconnect/secret rotation, disconnect, raw-data purge, and a
speaker-attributed Ask query. Run Fireflies in shadow mode for 10–20 the owner
meetings before enabling automatic relationship proposals.
