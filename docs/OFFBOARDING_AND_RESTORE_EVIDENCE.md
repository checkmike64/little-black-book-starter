# Offboarding inventory and isolated restore evidence

This runbook produces content-free technical observations for an authorized
Little Black Book install. It does not export relationship content, perform a
backup, restore a project, revoke access, delete data, or confirm a Production
Signoff item.

Keep every generated observation and receipt in the approved restricted
operator record system. Never commit an observation, nonce, database URL,
project credential, backup identifier, client identifier, or completed receipt
to this repository.

## What the inventory proves

The SQL observation records exact counts and nonce-keyed fingerprints for the
reviewed tenant tables and selected install-wide surfaces. It also records:

- the migration ledger head and digest;
- Auth user, identity, membership, session, and active refresh-token topology;
- Storage bucket, object, byte, and transcript-reference topology;
- Vault reference, dangling-reference, and unreferenced-secret topology;
- the reviewed Auth, Storage, Vault, and tenant-table catalogs; and
- the exact application release SHA supplied by the operator.

It never emits names, email addresses, phone numbers, notes, transcript text,
support content, raw provider payloads, tokens, decrypted secrets, secret names,
or the tenant UUID. Complete application rows are canonicalized and HMACed
inside the database; platform rows use explicit safe projections. Only counts
and keyed fingerprints leave Postgres. The output still contains the project
reference and must be handled as restricted operational evidence.

The compiler returns only `inventory_complete`, `inventory_incomplete`, or
`observation_failed`. `inventory_complete` means the observation is internally
complete against the reviewed catalog. It does not mean the client is ready to
offboard, that deletion is authorized, or that a backup can be restored.

## Capture an observation

Prerequisites:

1. written authority for the exact source or isolated target;
2. a secure operator workstation with `psql` and an approved database URL;
3. the exact 20-character project ref, tenant UUID, and deployed 40-character
   release SHA; and
4. a fresh 64-character lowercase hexadecimal nonce.

Use the same fresh nonce for the source and its isolated target so fingerprints
can be compared. Do not reuse it for another rehearsal or retain it after the
two observations are secured.

```sh
umask 077
read -r -s LBB_EVIDENCE_NONCE
psql "$LBB_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 \
  -v evidence_nonce="$LBB_EVIDENCE_NONCE" \
  -v project_ref="abcdefghijklmnopqrst" \
  -v tenant_id="[AUTHORIZED TENANT UUID]" \
  -v release_sha="[EXACT 40-CHARACTER SHA]" \
  -v environment="production" \
  -v observation_id="[OPAQUE EVIDENCE ID]" \
  -f scripts/export-offboarding-inventory.sql \
  > /absolute/restricted/path/source-observation.json
unset LBB_EVIDENCE_NONCE
pnpm evidence:offboarding -- \
  --input /absolute/restricted/path/source-observation.json \
  > /absolute/restricted/path/source-inventory-receipt.json
```

The SQL uses a repeatable-read, read-only transaction, aborts on SQL errors,
enforces statement and lock timeouts, and rolls back. A missing table, catalog
drift, malformed operator parameter, or query failure must stop the capture.
Do not edit an observation to make it validate.

## Compare an isolated restore

Restore only into an explicitly authorized non-production project with external
writers disabled. Capture the target with the same nonce and with
`environment=isolated_restore`, then complete a restricted copy of
`isolated-restore-controls-template.json` from observed evidence.

```sh
pnpm evidence:restore -- \
  --source /absolute/restricted/path/source-observation.json \
  --target /absolute/restricted/path/target-observation.json \
  --controls /absolute/restricted/path/restore-controls.json \
  > /absolute/restricted/path/isolated-restore-receipt.json
```

A `pass` requires fresh source, target, and controls observations; matching
database, Auth, Storage, Vault-reference, catalog, and migration evidence; and
an opaque evidence reference plus timestamp and explicit disposition for every
separate operational control. Database backup evidence alone is insufficient. A
zero Storage-object count still requires the bucket/configuration check. Any
mismatch returns `fail`; stale or missing external evidence returns `incomplete`.

Record the provider backup identifier and recovery point separately. Record
Auth settings, Storage configuration/object recovery, Vault isolation, disabled
writers, runtime configuration, application smoke, and target cleanup as
separate verified controls. Do not put credentials, secret URLs, or backup
contents into any reference field.

## Offboarding boundary

An inventory or restore receipt is evidence input only. Before any offboarding
action, require the approved per-install retention matrix, written authority,
legal-hold review, final portable export and acknowledgment, provider/OAuth and
session shutdown plan, automation disposition, independent reviewer, exception
record, and final return/deletion receipt.

Never treat the portable Book JSON export as a database/Auth/Storage/Vault
backup. Never mark `backup_and_restore_proven` or
`retention_and_offboarding_ready` merely because these tools ran.
