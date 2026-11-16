import { createHash } from "node:crypto";

export const offboardingEvidenceFormatVersion = 1;

export const offboardingTenantTables = [
  "ask_runs",
  "audit_log",
  "calendar_attendee_preferences",
  "calendar_attendees",
  "calendar_events",
  "claude_write_receipts",
  "client_import_batches",
  "connection_contexts",
  "connections",
  "contacts",
  "content_items",
  "content_scan_runs",
  "content_scan_sources",
  "field_provenance",
  "google_oauth_transactions",
  "integration_connections",
  "interaction_contacts",
  "interactions",
  "introductions",
  "jobs",
  "notion_oauth_transactions",
  "notion_webhook_events",
  "pending_changes",
  "promises",
  "recommendation_day_overrides",
  "recording_followups",
  "recording_ingest_receipts",
  "recording_sync_state",
  "relationship_actions",
  "relationship_context_memberships",
  "relationship_contexts",
  "reviews",
  "signals",
  "tenant_config",
  "tenant_members",
  "transcripts",
  "usage_events",
  "want_to_know",
] as const;

export const offboardingAuthTables = [
  "audit_log_entries",
  "custom_oauth_providers",
  "flow_state",
  "identities",
  "instances",
  "mfa_amr_claims",
  "mfa_challenges",
  "mfa_factors",
  "oauth_authorizations",
  "oauth_client_states",
  "oauth_clients",
  "oauth_consents",
  "one_time_tokens",
  "refresh_tokens",
  "saml_providers",
  "saml_relay_states",
  "schema_migrations",
  "sessions",
  "sso_domains",
  "sso_providers",
  "users",
  "webauthn_challenges",
  "webauthn_credentials",
] as const;

export const offboardingStorageTables = [
  "buckets",
  "buckets_analytics",
  "buckets_vectors",
  "migrations",
  "objects",
  "s3_multipart_uploads",
  "s3_multipart_uploads_parts",
  "vector_indexes",
] as const;

export const offboardingVaultTables = ["secrets"] as const;
export const offboardingAuthSequences = ["refresh_tokens_id_seq"] as const;
export const offboardingPublicTables = [
  ...offboardingTenantTables,
  "notion_webhook_config",
  "tenants",
] as const;
export const offboardingPrivateTables = [
  "calendar_snapshot_receipts",
  "recording_baseline_field_policy",
] as const;

export type OffboardingTenantTable = (typeof offboardingTenantTables)[number];
export type ObservationEnvironment = "production" | "isolated_restore";
export type EvidenceStatus =
  | "inventory_complete"
  | "inventory_incomplete"
  | "observation_failed";
export type RestoreStatus = "pass" | "fail" | "incomplete";

export type CountFingerprint = {
  count: number;
  fingerprint: string;
};

export type TableObservation = CountFingerprint & {
  table: OffboardingTenantTable;
};

export type PlatformTableObservation = CountFingerprint & {
  schema: "auth" | "storage" | "vault";
  table: string;
};

export type OffboardingObservation = {
  format_version: 1;
  observation_id: string;
  captured_at_utc: string;
  environment: ObservationEnvironment;
  project_ref: string;
  tenant_fingerprint: string;
  release_sha: string;
  schema: {
    discovered_tenant_tables: string[];
    application_tables: {
      public: string[];
      app_private: string[];
    };
    application_catalog: CountFingerprint;
    migration_head: string;
    migration_digest: string;
  };
  platform_catalog: {
    auth_tables: string[];
    storage_tables: string[];
    vault_tables: string[];
    auth_sequences: string[];
    auth_sequence_state: CountFingerprint;
    table_state: PlatformTableObservation[];
  };
  tenant_tables: TableObservation[];
  tenant: CountFingerprint;
  private_calendar_receipts: CountFingerprint;
  install_global: {
    notion_webhook_config: CountFingerprint;
    recording_baseline_field_policy: CountFingerprint;
  };
  auth: {
    users: CountFingerprint;
    identities: CountFingerprint;
    memberships: CountFingerprint;
    sessions: CountFingerprint;
    unrevoked_refresh_tokens: CountFingerprint;
    orphan_memberships: number;
    unassigned_users: number;
  };
  storage: {
    private_buckets: number;
    public_buckets: number;
    objects: CountFingerprint;
    bytes: number;
    transcript_references: number;
    matched_references: number;
    dangling_references: number;
    unreferenced_objects: number;
  };
  vault: {
    references: number;
    distinct_references: number;
    referenced_secrets: CountFingerprint;
    dangling_references: number;
    unreferenced_secrets: number;
  };
};

export type RestoreControlEvidence = {
  status: "verified" | "unverified" | "failed";
  disposition: "included" | "excluded" | "disabled" | "not_applicable";
  evidence_reference: string | null;
  observed_at_utc: string | null;
};

export type RestoreControls = {
  controls_evidence_reference: string | null;
  captured_at_utc: string | null;
  provider_backup_reference: string | null;
  recovery_point_utc: string | null;
  source_authorization: RestoreControlEvidence;
  target_authorization: RestoreControlEvidence;
  target_isolation: RestoreControlEvidence;
  external_writers: RestoreControlEvidence;
  auth_data: RestoreControlEvidence;
  auth_configuration: RestoreControlEvidence;
  storage_data: RestoreControlEvidence;
  storage_configuration: RestoreControlEvidence;
  storage_objects: RestoreControlEvidence;
  vault_isolation: RestoreControlEvidence;
  api_keys: RestoreControlEvidence;
  realtime: RestoreControlEvidence;
  edge_functions: RestoreControlEvidence;
  provider_integrations: RestoreControlEvidence;
  runtime_configuration: RestoreControlEvidence;
  application_smoke: RestoreControlEvidence;
  cleanup: RestoreControlEvidence;
};

const restoreControlKeys = [
  "controls_evidence_reference",
  "captured_at_utc",
  "provider_backup_reference",
  "recovery_point_utc",
  "source_authorization",
  "target_authorization",
  "target_isolation",
  "external_writers",
  "auth_data",
  "auth_configuration",
  "storage_data",
  "storage_configuration",
  "storage_objects",
  "vault_isolation",
  "api_keys",
  "realtime",
  "edge_functions",
  "provider_integrations",
  "runtime_configuration",
  "application_smoke",
  "cleanup",
] as const;

export type EvidenceResult<TStatus extends string> = {
  status: TStatus;
  errors: string[];
  manifest_sha256: string | null;
};

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{5,499}$/;
const projectRefPattern = /^[a-z0-9]{20}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const releaseShaPattern = /^[a-f0-9]{40}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
  errors: string[],
) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    errors.push(`${label} has missing or unexpected fields.`);
  }
}

function nonnegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validTimestamp(value: unknown) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validateCountFingerprint(
  value: unknown,
  label: string,
  errors: string[],
): value is CountFingerprint {
  if (!isRecord(value)) {
    errors.push(`${label} is missing.`);
    return false;
  }
  exactKeys(value, ["count", "fingerprint"], label, errors);
  if (!nonnegativeInteger(value.count)) errors.push(`${label}.count is invalid.`);
  if (typeof value.fingerprint !== "string" || !sha256Pattern.test(value.fingerprint)) {
    errors.push(`${label}.fingerprint is invalid.`);
  }
  return true;
}

function validateTableObservations(value: unknown, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push("tenant_tables is missing.");
    return;
  }
  const observed = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      errors.push(`tenant_tables[${index}] is invalid.`);
      continue;
    }
    exactKeys(entry, ["table", "count", "fingerprint"], `tenant_tables[${index}]`, errors);
    const table = entry.table;
    if (typeof table !== "string" || !offboardingTenantTables.includes(table as OffboardingTenantTable)) {
      errors.push(`tenant_tables[${index}].table is not allowlisted.`);
    } else if (observed.has(table)) {
      errors.push(`tenant_tables contains duplicate ${table}.`);
    } else {
      observed.add(table);
    }
    if (!nonnegativeInteger(entry.count)) errors.push(`tenant_tables[${index}].count is invalid.`);
    if (typeof entry.fingerprint !== "string" || !sha256Pattern.test(entry.fingerprint)) {
      errors.push(`tenant_tables[${index}].fingerprint is invalid.`);
    }
  }
  if (
    value.length !== offboardingTenantTables.length ||
    offboardingTenantTables.some((table) => !observed.has(table))
  ) {
    errors.push("tenant_tables does not exactly match the reviewed allowlist.");
  }
}

function validatePlatformTableObservations(value: unknown, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push("platform_catalog.table_state is missing.");
    return;
  }
  const expected = new Set([
    ...offboardingAuthTables.map((table) => `auth.${table}`),
    ...offboardingStorageTables.map((table) => `storage.${table}`),
    ...offboardingVaultTables.map((table) => `vault.${table}`),
  ]);
  const observed = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      errors.push(`platform_catalog.table_state[${index}] is invalid.`);
      continue;
    }
    exactKeys(
      entry,
      ["schema", "table", "count", "fingerprint"],
      `platform_catalog.table_state[${index}]`,
      errors,
    );
    const identity = `${String(entry.schema)}.${String(entry.table)}`;
    if (!expected.has(identity)) {
      errors.push(`platform_catalog.table_state[${index}] is not allowlisted.`);
    } else if (observed.has(identity)) {
      errors.push(`platform_catalog.table_state contains duplicate ${identity}.`);
    } else {
      observed.add(identity);
    }
    if (!nonnegativeInteger(entry.count)) {
      errors.push(`platform_catalog.table_state[${index}].count is invalid.`);
    }
    if (typeof entry.fingerprint !== "string" || !sha256Pattern.test(entry.fingerprint)) {
      errors.push(`platform_catalog.table_state[${index}].fingerprint is invalid.`);
    }
  }
  if (value.length !== expected.size || [...expected].some((identity) => !observed.has(identity))) {
    errors.push("platform_catalog.table_state does not exactly match the reviewed allowlist.");
  }
}

export function validateOffboardingObservation(
  input: unknown,
): EvidenceResult<EvidenceStatus> & { observation: OffboardingObservation | null } {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return {
      status: "observation_failed",
      errors: ["Observation must be a JSON object."],
      manifest_sha256: null,
      observation: null,
    };
  }

  exactKeys(
    input,
    [
      "format_version",
      "observation_id",
      "captured_at_utc",
      "environment",
      "project_ref",
      "tenant_fingerprint",
      "release_sha",
      "schema",
      "platform_catalog",
      "tenant_tables",
      "tenant",
      "private_calendar_receipts",
      "install_global",
      "auth",
      "storage",
      "vault",
    ],
    "observation",
    errors,
  );

  if (input.format_version !== offboardingEvidenceFormatVersion) errors.push("format_version is unsupported.");
  if (
    typeof input.observation_id !== "string" ||
    !identifierPattern.test(input.observation_id) ||
    /^(?:https?|file):\/\//i.test(input.observation_id)
  ) {
    errors.push("observation_id is invalid.");
  }

  if (!isRecord(input.platform_catalog)) {
    errors.push("platform_catalog is missing.");
  } else {
    exactKeys(
      input.platform_catalog,
      ["auth_tables", "storage_tables", "vault_tables", "auth_sequences", "auth_sequence_state", "table_state"],
      "platform_catalog",
      errors,
    );
    for (const [key, expected] of [
      ["auth_tables", offboardingAuthTables],
      ["storage_tables", offboardingStorageTables],
      ["vault_tables", offboardingVaultTables],
      ["auth_sequences", offboardingAuthSequences],
    ] as const) {
      const observed = input.platform_catalog[key];
      if (
        !Array.isArray(observed) ||
        observed.some((entry) => typeof entry !== "string") ||
        JSON.stringify([...observed].sort()) !== JSON.stringify([...expected].sort())
      ) {
        errors.push(`platform_catalog.${key} differs from the reviewed allowlist.`);
      }
    }
    validateCountFingerprint(
      input.platform_catalog.auth_sequence_state,
      "platform_catalog.auth_sequence_state",
      errors,
    );
    validatePlatformTableObservations(input.platform_catalog.table_state, errors);
  }
  if (!validTimestamp(input.captured_at_utc)) errors.push("captured_at_utc is invalid.");
  if (input.environment !== "production" && input.environment !== "isolated_restore") {
    errors.push("environment is invalid.");
  }
  if (typeof input.project_ref !== "string" || !projectRefPattern.test(input.project_ref)) {
    errors.push("project_ref is invalid.");
  }
  if (typeof input.tenant_fingerprint !== "string" || !sha256Pattern.test(input.tenant_fingerprint)) {
    errors.push("tenant_fingerprint is invalid.");
  }
  if (typeof input.release_sha !== "string" || !releaseShaPattern.test(input.release_sha)) {
    errors.push("release_sha is invalid.");
  }

  if (!isRecord(input.schema)) {
    errors.push("schema is missing.");
  } else {
    exactKeys(input.schema, ["discovered_tenant_tables", "application_tables", "application_catalog", "migration_head", "migration_digest"], "schema", errors);
    const discovered = input.schema.discovered_tenant_tables;
    if (
      !Array.isArray(discovered) ||
      discovered.some((table) => typeof table !== "string") ||
      JSON.stringify([...discovered].sort()) !== JSON.stringify([...offboardingTenantTables].sort())
    ) {
      errors.push("schema.discovered_tenant_tables differs from the reviewed allowlist.");
    }
    if (!isRecord(input.schema.application_tables)) {
      errors.push("schema.application_tables is missing.");
    } else {
      exactKeys(input.schema.application_tables, ["public", "app_private"], "schema.application_tables", errors);
      for (const [key, expected] of [
        ["public", offboardingPublicTables],
        ["app_private", offboardingPrivateTables],
      ] as const) {
        const observed = input.schema.application_tables[key];
        if (
          !Array.isArray(observed) ||
          observed.some((table) => typeof table !== "string") ||
          JSON.stringify([...observed].sort()) !== JSON.stringify([...expected].sort())
        ) {
          errors.push(`schema.application_tables.${key} differs from the reviewed allowlist.`);
        }
      }
    }
    validateCountFingerprint(input.schema.application_catalog, "schema.application_catalog", errors);
    if (typeof input.schema.migration_head !== "string" || !/^\d{14}$/.test(input.schema.migration_head)) {
      errors.push("schema.migration_head is invalid.");
    }
    if (typeof input.schema.migration_digest !== "string" || !sha256Pattern.test(input.schema.migration_digest)) {
      errors.push("schema.migration_digest is invalid.");
    }
  }

  validateTableObservations(input.tenant_tables, errors);
  validateCountFingerprint(input.tenant, "tenant", errors);
  validateCountFingerprint(input.private_calendar_receipts, "private_calendar_receipts", errors);

  if (!isRecord(input.install_global)) {
    errors.push("install_global is missing.");
  } else {
    exactKeys(input.install_global, ["notion_webhook_config", "recording_baseline_field_policy"], "install_global", errors);
    validateCountFingerprint(input.install_global.notion_webhook_config, "install_global.notion_webhook_config", errors);
    validateCountFingerprint(input.install_global.recording_baseline_field_policy, "install_global.recording_baseline_field_policy", errors);
  }

  if (!isRecord(input.auth)) {
    errors.push("auth is missing.");
  } else {
    exactKeys(input.auth, ["users", "identities", "memberships", "sessions", "unrevoked_refresh_tokens", "orphan_memberships", "unassigned_users"], "auth", errors);
    for (const key of ["users", "identities", "memberships", "sessions", "unrevoked_refresh_tokens"] as const) {
      validateCountFingerprint(input.auth[key], `auth.${key}`, errors);
    }
    for (const key of ["orphan_memberships", "unassigned_users"] as const) {
      if (!nonnegativeInteger(input.auth[key])) errors.push(`auth.${key} is invalid.`);
    }
  }

  if (!isRecord(input.storage)) {
    errors.push("storage is missing.");
  } else {
    exactKeys(input.storage, ["private_buckets", "public_buckets", "objects", "bytes", "transcript_references", "matched_references", "dangling_references", "unreferenced_objects"], "storage", errors);
    for (const key of ["private_buckets", "public_buckets", "bytes", "transcript_references", "matched_references", "dangling_references", "unreferenced_objects"] as const) {
      if (!nonnegativeInteger(input.storage[key])) errors.push(`storage.${key} is invalid.`);
    }
    validateCountFingerprint(input.storage.objects, "storage.objects", errors);
  }

  if (!isRecord(input.vault)) {
    errors.push("vault is missing.");
  } else {
    exactKeys(input.vault, ["references", "distinct_references", "referenced_secrets", "dangling_references", "unreferenced_secrets"], "vault", errors);
    for (const key of ["references", "distinct_references", "dangling_references", "unreferenced_secrets"] as const) {
      if (!nonnegativeInteger(input.vault[key])) errors.push(`vault.${key} is invalid.`);
    }
    validateCountFingerprint(input.vault.referenced_secrets, "vault.referenced_secrets", errors);
  }

  if (errors.length) {
    return {
      status: "observation_failed",
      errors,
      manifest_sha256: null,
      observation: null,
    };
  }

  const observation = input as OffboardingObservation;
  const incomplete: string[] = [];
  if (observation.tenant.count !== 1) incomplete.push("Exactly one tenant row was not observed.");
  if (observation.auth.memberships.count < 1) incomplete.push("No tenant membership was observed.");
  if (observation.auth.orphan_memberships !== 0) incomplete.push("Auth orphan memberships are present.");
  if (observation.auth.unassigned_users !== 0) incomplete.push("Unassigned Auth users are present.");
  if (observation.install_global.recording_baseline_field_policy.count !== 17) {
    incomplete.push("The recording baseline policy does not contain 17 rows.");
  }
  if (
    observation.storage.transcript_references !==
    observation.storage.matched_references + observation.storage.dangling_references
  ) {
    incomplete.push("Storage transcript reference counts are inconsistent.");
  }
  if (
    observation.storage.objects.count !==
    observation.storage.matched_references + observation.storage.unreferenced_objects
  ) {
    incomplete.push("Storage object counts are inconsistent.");
  }
  if (
    observation.vault.distinct_references !==
    observation.vault.referenced_secrets.count + observation.vault.dangling_references
  ) {
    incomplete.push("Vault reference counts are inconsistent.");
  }
  if (observation.storage.public_buckets !== 0) incomplete.push("A public Storage bucket is present.");
  if (observation.storage.dangling_references !== 0) incomplete.push("Dangling Storage references are present.");
  if (observation.storage.unreferenced_objects !== 0) incomplete.push("Unreferenced Storage objects are present.");
  if (observation.vault.dangling_references !== 0) incomplete.push("Dangling Vault references are present.");
  if (observation.vault.unreferenced_secrets !== 0) incomplete.push("Unreferenced Vault secrets are present.");
  return {
    status: incomplete.length ? "inventory_incomplete" : "inventory_complete",
    errors: incomplete,
    manifest_sha256: canonicalObservationHash(observation),
    observation,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalObservationHash(observation: OffboardingObservation) {
  const normalized = structuredClone(observation);
  normalized.schema.discovered_tenant_tables.sort();
  normalized.schema.application_tables.public.sort();
  normalized.schema.application_tables.app_private.sort();
  normalized.platform_catalog.auth_tables.sort();
  normalized.platform_catalog.storage_tables.sort();
  normalized.platform_catalog.vault_tables.sort();
  normalized.platform_catalog.auth_sequences.sort();
  normalized.platform_catalog.table_state.sort((left, right) =>
    `${left.schema}.${left.table}`.localeCompare(`${right.schema}.${right.table}`),
  );
  normalized.tenant_tables.sort((left, right) => left.table.localeCompare(right.table));
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(normalized)))
    .digest("hex");
}

function sameCountFingerprint(left: CountFingerprint, right: CountFingerprint) {
  return left.count === right.count && left.fingerprint === right.fingerprint;
}

function validControlReference(value: string | null) {
  return value !== null && identifierPattern.test(value) && !/^(?:https?|file):\/\//i.test(value);
}

function validateRestoreControls(input: unknown) {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { controls: null, errors: ["Restore controls must be a JSON object."] };
  }
  exactKeys(input, restoreControlKeys, "restore controls", errors);
  for (const key of ["controls_evidence_reference", "provider_backup_reference"] as const) {
    if (input[key] !== null && typeof input[key] !== "string") {
      errors.push(`restore controls.${key} is invalid.`);
    }
  }
  if (input.captured_at_utc !== null && typeof input.captured_at_utc !== "string") {
    errors.push("restore controls.captured_at_utc is invalid.");
  }
  if (input.recovery_point_utc !== null && typeof input.recovery_point_utc !== "string") {
    errors.push("restore controls.recovery_point_utc is invalid.");
  }
  for (const key of restoreControlKeys.slice(4)) {
    const value = input[key];
    if (!isRecord(value)) {
      errors.push(`restore controls.${key} is missing.`);
      continue;
    }
    exactKeys(
      value,
      ["status", "disposition", "evidence_reference", "observed_at_utc"],
      `restore controls.${key}`,
      errors,
    );
    if (value.status !== "verified" && value.status !== "unverified" && value.status !== "failed") {
      errors.push(`restore controls.${key}.status is invalid.`);
    }
    if (
      value.disposition !== "included" &&
      value.disposition !== "excluded" &&
      value.disposition !== "disabled" &&
      value.disposition !== "not_applicable"
    ) {
      errors.push(`restore controls.${key}.disposition is invalid.`);
    }
    if (value.evidence_reference !== null && typeof value.evidence_reference !== "string") {
      errors.push(`restore controls.${key}.evidence_reference is invalid.`);
    }
    if (value.observed_at_utc !== null && typeof value.observed_at_utc !== "string") {
      errors.push(`restore controls.${key}.observed_at_utc is invalid.`);
    }
  }
  return {
    controls: errors.length ? null : (input as RestoreControls),
    errors,
  };
}

export function evaluateIsolatedRestore(
  sourceInput: unknown,
  targetInput: unknown,
  controlsInput: unknown,
  evaluatedAtUtc = new Date().toISOString(),
): EvidenceResult<RestoreStatus> {
  const source = validateOffboardingObservation(sourceInput);
  const target = validateOffboardingObservation(targetInput);
  const controlsResult = validateRestoreControls(controlsInput);
  const errors: string[] = [];
  if (!source.observation || !target.observation || !controlsResult.controls) {
    return {
      status: "fail",
      errors: [
        ...source.errors.map((error) => `source: ${error}`),
        ...target.errors.map((error) => `target: ${error}`),
        ...controlsResult.errors,
      ],
      manifest_sha256: null,
    };
  }
  const controls = controlsResult.controls;

  const incomplete: string[] = [
    ...(source.status === "inventory_complete"
      ? []
      : source.errors.map((error) => `source: ${error}`)),
    ...(target.status === "inventory_complete"
      ? []
      : target.errors.map((error) => `target: ${error}`)),
  ];

  const left = source.observation;
  const right = target.observation;
  if (left.environment !== "production") errors.push("source environment must be production.");
  if (right.environment !== "isolated_restore") errors.push("target environment must be isolated_restore.");
  if (left.project_ref === right.project_ref) errors.push("source and target project refs must differ.");
  if (left.tenant_fingerprint !== right.tenant_fingerprint) errors.push("source and target tenant scopes differ.");
  if (left.release_sha !== right.release_sha) errors.push("source and target release SHAs differ.");
  if (left.schema.migration_head !== right.schema.migration_head) errors.push("migration heads differ.");
  if (left.schema.migration_digest !== right.schema.migration_digest) errors.push("migration digests differ.");
  if (!sameCountFingerprint(left.schema.application_catalog, right.schema.application_catalog)) {
    errors.push("Application schema catalogs differ.");
  }
  if (
    !sameCountFingerprint(
      left.platform_catalog.auth_sequence_state,
      right.platform_catalog.auth_sequence_state,
    )
  ) {
    errors.push("Auth sequence state differs.");
  }

  const targetPlatformState = new Map(
    right.platform_catalog.table_state.map((entry) => [`${entry.schema}.${entry.table}`, entry]),
  );
  for (const entry of left.platform_catalog.table_state) {
    const restored = targetPlatformState.get(`${entry.schema}.${entry.table}`);
    if (!restored || !sameCountFingerprint(entry, restored)) {
      errors.push(`platform table ${entry.schema}.${entry.table} differs.`);
    }
  }

  const targetTables = new Map(right.tenant_tables.map((entry) => [entry.table, entry]));
  for (const entry of left.tenant_tables) {
    const restored = targetTables.get(entry.table);
    if (!restored || !sameCountFingerprint(entry, restored)) {
      errors.push(`tenant table ${entry.table} differs.`);
    }
  }
  for (const [label, sourceValue, targetValue] of [
    ["tenant", left.tenant, right.tenant],
    ["private calendar receipts", left.private_calendar_receipts, right.private_calendar_receipts],
    ["Notion webhook config", left.install_global.notion_webhook_config, right.install_global.notion_webhook_config],
    ["recording baseline field policy", left.install_global.recording_baseline_field_policy, right.install_global.recording_baseline_field_policy],
    ["Auth users", left.auth.users, right.auth.users],
    ["Auth identities", left.auth.identities, right.auth.identities],
    ["Auth memberships", left.auth.memberships, right.auth.memberships],
    ["Auth sessions", left.auth.sessions, right.auth.sessions],
    ["Auth unrevoked refresh tokens", left.auth.unrevoked_refresh_tokens, right.auth.unrevoked_refresh_tokens],
    ["Storage objects", left.storage.objects, right.storage.objects],
    ["Vault referenced secrets", left.vault.referenced_secrets, right.vault.referenced_secrets],
  ] as const) {
    if (!sameCountFingerprint(sourceValue, targetValue)) errors.push(`${label} differs.`);
  }

  if (left.auth.orphan_memberships !== 0 || right.auth.orphan_memberships !== 0) errors.push("Auth orphan memberships are present.");
  if (left.auth.unassigned_users !== 0 || right.auth.unassigned_users !== 0) errors.push("Unassigned Auth users are present.");
  if (left.storage.private_buckets !== right.storage.private_buckets) errors.push("Private Storage bucket counts differ.");
  if (left.storage.public_buckets !== 0 || right.storage.public_buckets !== 0) errors.push("A public Storage bucket is present.");
  if (left.storage.bytes !== right.storage.bytes) errors.push("Storage byte counts differ.");
  for (const key of ["transcript_references", "matched_references", "dangling_references", "unreferenced_objects"] as const) {
    if (left.storage[key] !== right.storage[key]) errors.push(`Storage ${key} counts differ.`);
  }
  if (left.storage.dangling_references !== 0 || right.storage.dangling_references !== 0) errors.push("Dangling Storage references are present.");
  if (left.storage.unreferenced_objects !== 0 || right.storage.unreferenced_objects !== 0) errors.push("Unreferenced Storage objects are present.");
  for (const key of ["references", "distinct_references", "dangling_references", "unreferenced_secrets"] as const) {
    if (left.vault[key] !== right.vault[key]) errors.push(`Vault ${key} counts differ.`);
  }
  if (left.vault.dangling_references !== 0 || right.vault.dangling_references !== 0) errors.push("Dangling Vault references are present.");
  if (left.vault.unreferenced_secrets !== 0 || right.vault.unreferenced_secrets !== 0) errors.push("Unreferenced Vault secrets are present.");

  if (!validControlReference(controls.controls_evidence_reference)) incomplete.push("Controls evidence reference is missing.");
  if (!validControlReference(controls.provider_backup_reference)) incomplete.push("Provider backup reference is missing.");
  if (!validTimestamp(controls.recovery_point_utc)) incomplete.push("Recovery point is missing or invalid.");
  if (!validTimestamp(controls.captured_at_utc)) incomplete.push("Controls capture time is missing or invalid.");

  const expectedDispositions: Record<keyof Omit<RestoreControls, "controls_evidence_reference" | "captured_at_utc" | "provider_backup_reference" | "recovery_point_utc">, RestoreControlEvidence["disposition"] | readonly RestoreControlEvidence["disposition"][]> = {
    source_authorization: "included",
    target_authorization: "included",
    target_isolation: "included",
    external_writers: "disabled",
    auth_data: "included",
    auth_configuration: "included",
    storage_data: "included",
    storage_configuration: "included",
    storage_objects: left.storage.objects.count > 0 || right.storage.objects.count > 0 ? "included" : ["included", "not_applicable"],
    vault_isolation: "disabled",
    api_keys: "disabled",
    realtime: "disabled",
    edge_functions: "disabled",
    provider_integrations: "disabled",
    runtime_configuration: "included",
    application_smoke: "included",
    cleanup: "disabled",
  };
  for (const [key, expectedDisposition] of Object.entries(expectedDispositions) as Array<[keyof typeof expectedDispositions, (typeof expectedDispositions)[keyof typeof expectedDispositions]]>) {
    const control = controls[key];
    if (control.status === "failed") errors.push(`${key} control failed.`);
    if (control.status !== "verified") incomplete.push(`${key} control is unverified.`);
    if (!validControlReference(control.evidence_reference)) incomplete.push(`${key} evidence reference is missing.`);
    if (!validTimestamp(control.observed_at_utc)) incomplete.push(`${key} observation time is missing or invalid.`);
    const permitted = Array.isArray(expectedDisposition) ? expectedDisposition : [expectedDisposition];
    if (!permitted.includes(control.disposition)) incomplete.push(`${key} disposition is not acceptable.`);
  }

  if (validTimestamp(evaluatedAtUtc) && validTimestamp(controls.captured_at_utc)) {
    const now = Date.parse(evaluatedAtUtc);
    const sourceAt = Date.parse(left.captured_at_utc);
    const targetAt = Date.parse(right.captured_at_utc);
    const controlsAt = Date.parse(controls.captured_at_utc as string);
    const oneDay = 24 * 60 * 60 * 1000;
    const futureTolerance = 5 * 60 * 1000;
    if (validTimestamp(controls.recovery_point_utc)) {
      const recoveryAt = Date.parse(controls.recovery_point_utc as string);
      if (recoveryAt > sourceAt + futureTolerance) incomplete.push("Recovery point is later than the source observation.");
    }
    if (targetAt < sourceAt || targetAt - sourceAt > oneDay) incomplete.push("Source and target observations are outside the 24-hour comparison window.");
    if (controlsAt < targetAt || controlsAt - targetAt > oneDay) incomplete.push("Controls were not captured within 24 hours after the target observation.");
    if (controlsAt > now + futureTolerance || now - controlsAt > oneDay) incomplete.push("Restore controls are stale or future-dated.");
    for (const [label, timestamp] of [["Source observation", sourceAt], ["Target observation", targetAt]] as const) {
      if (timestamp > now + futureTolerance || now - timestamp > oneDay) {
        incomplete.push(`${label} is stale or future-dated.`);
      }
    }
    const postflightControls = new Set<keyof typeof expectedDispositions>([
      "target_isolation",
      "external_writers",
      "auth_data",
      "auth_configuration",
      "storage_data",
      "storage_configuration",
      "storage_objects",
      "vault_isolation",
      "api_keys",
      "realtime",
      "edge_functions",
      "provider_integrations",
      "runtime_configuration",
      "application_smoke",
      "cleanup",
    ]);
    for (const [key] of Object.entries(expectedDispositions) as Array<[keyof typeof expectedDispositions, unknown]>) {
      const observedAt = controls[key].observed_at_utc;
      if (validTimestamp(observedAt)) {
        const observedAtMs = Date.parse(observedAt as string);
        if (
          observedAtMs > now + futureTolerance ||
          observedAtMs > controlsAt + futureTolerance ||
          controlsAt - observedAtMs > oneDay
        ) {
          incomplete.push(`${key} evidence is outside the controls capture window.`);
        }
        if (postflightControls.has(key) && observedAtMs < targetAt - futureTolerance) {
          incomplete.push(`${key} evidence predates the target observation.`);
        }
      }
    }
  } else if (!validTimestamp(evaluatedAtUtc)) {
    errors.push("Evaluation timestamp is invalid.");
  }

  const manifest = createHash("sha256")
    .update(
      JSON.stringify(
        canonicalize({
          source: source.manifest_sha256,
          target: target.manifest_sha256,
          controls,
        }),
      ),
    )
    .digest("hex");
  if (errors.length) return { status: "fail", errors, manifest_sha256: manifest };
  if (incomplete.length) return { status: "incomplete", errors: incomplete, manifest_sha256: manifest };
  return { status: "pass", errors: [], manifest_sha256: manifest };
}
