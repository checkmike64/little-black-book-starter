import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  evaluateIsolatedRestore,
  offboardingAuthSequences,
  offboardingAuthTables,
  offboardingPrivateTables,
  offboardingPublicTables,
  offboardingStorageTables,
  offboardingTenantTables,
  offboardingVaultTables,
  validateOffboardingObservation,
  type OffboardingObservation,
  type RestoreControls,
} from "../lib/commercial/offboarding-evidence.js";

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function observation(
  environment: "production" | "isolated_restore" = "production",
): OffboardingObservation {
  const scoped = (label: string, count = 0) => ({
    count,
    fingerprint: fingerprint(label),
  });
  return {
    format_version: 1,
    observation_id: `packet:${environment}`,
    captured_at_utc: new Date(Date.now() - (environment === "production" ? 120_000 : 60_000)).toISOString(),
    environment,
    project_ref:
      environment === "production"
        ? "abcdefghijklmnopqrst"
        : "tsrqponmlkjihgfedcba",
    tenant_fingerprint: fingerprint("tenant-scope"),
    release_sha: "a".repeat(40),
    schema: {
      discovered_tenant_tables: [...offboardingTenantTables],
      application_tables: {
        public: [...offboardingPublicTables],
        app_private: [...offboardingPrivateTables],
      },
      application_catalog: scoped("application-catalog", 500),
      migration_head: "20260904122042",
      migration_digest: fingerprint("migrations"),
    },
    platform_catalog: {
      auth_tables: [...offboardingAuthTables],
      storage_tables: [...offboardingStorageTables],
      vault_tables: [...offboardingVaultTables],
      auth_sequences: [...offboardingAuthSequences],
      auth_sequence_state: scoped("auth-sequence", 1),
      table_state: [
        ...offboardingAuthTables.map((table) => ({ schema: "auth" as const, table, ...scoped(`auth:${table}`) })),
        ...offboardingStorageTables.map((table) => ({ schema: "storage" as const, table, ...scoped(`storage:${table}`) })),
        ...offboardingVaultTables.map((table) => ({ schema: "vault" as const, table, ...scoped(`vault:${table}`) })),
      ],
    },
    tenant_tables: offboardingTenantTables.map((table) => ({
      table,
      ...scoped(`table:${table}`),
    })),
    tenant: scoped("tenant", 1),
    private_calendar_receipts: scoped("calendar-receipts"),
    install_global: {
      notion_webhook_config: scoped("notion-webhook", 1),
      recording_baseline_field_policy: scoped("baseline-policy", 17),
    },
    auth: {
      users: scoped("auth-users", 1),
      identities: scoped("auth-identities", 1),
      memberships: scoped("memberships", 1),
      sessions: scoped("sessions", 5),
      unrevoked_refresh_tokens: scoped("refresh", 5),
      orphan_memberships: 0,
      unassigned_users: 0,
    },
    storage: {
      private_buckets: 1,
      public_buckets: 0,
      objects: scoped("storage-objects"),
      bytes: 0,
      transcript_references: 0,
      matched_references: 0,
      dangling_references: 0,
      unreferenced_objects: 0,
    },
    vault: {
      references: 3,
      distinct_references: 3,
      referenced_secrets: scoped("vault-references", 3),
      dangling_references: 0,
      unreferenced_secrets: 0,
    },
  };
}

function restoreTarget(source: OffboardingObservation) {
  return {
    ...structuredClone(source),
    observation_id: "packet:isolated-restore",
    environment: "isolated_restore" as const,
    project_ref: "tsrqponmlkjihgfedcba",
  };
}

function controls(overrides: Partial<RestoreControls> = {}): RestoreControls {
  const verified = (
    label: string,
    disposition: "included" | "disabled" | "not_applicable" = "included",
  ) => ({
    status: "verified" as const,
    disposition,
    evidence_reference: `evidence:${label}`,
    observed_at_utc: new Date().toISOString(),
  });
  return {
    controls_evidence_reference: "packet:restore-controls",
    captured_at_utc: new Date().toISOString(),
    provider_backup_reference: "backup:2026-09-04:001",
    recovery_point_utc: new Date(Date.now() - 180_000).toISOString(),
    source_authorization: verified("source-authorization"),
    target_authorization: verified("target-authorization"),
    target_isolation: verified("target-isolation"),
    external_writers: verified("external-writers", "disabled"),
    auth_data: verified("auth-data"),
    auth_configuration: verified("auth-configuration"),
    storage_data: verified("storage-data"),
    storage_configuration: verified("storage-configuration"),
    storage_objects: verified("storage-objects", "not_applicable"),
    vault_isolation: verified("vault-isolation", "disabled"),
    api_keys: verified("api-keys", "disabled"),
    realtime: verified("realtime", "disabled"),
    edge_functions: verified("edge-functions", "disabled"),
    provider_integrations: verified("provider-integrations", "disabled"),
    runtime_configuration: verified("runtime-configuration"),
    application_smoke: verified("application-smoke"),
    cleanup: verified("cleanup", "disabled"),
    ...overrides,
  };
}

describe("offboarding evidence", () => {
  test("accepts only the exact reviewed count-and-fingerprint observation", () => {
    const result = validateOffboardingObservation(observation());
    assert.equal(result.status, "inventory_complete");
    assert.equal(result.errors.length, 0);
    assert.match(result.manifest_sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(result.observation?.tenant_tables.length, 38);
  });

  test("fails closed on schema drift, missing tables, negative counts, and extra content", () => {
    const drifted = structuredClone(observation()) as unknown as Record<string, unknown>;
    const schema = drifted.schema as Record<string, unknown>;
    schema.discovered_tenant_tables = [
      ...(schema.discovered_tenant_tables as string[]),
      "unexpected_table",
    ];
    const tables = drifted.tenant_tables as Array<Record<string, unknown>>;
    tables.pop();
    (drifted.storage as Record<string, unknown>).bytes = -1;
    drifted.raw_contact_data = "must never be accepted";

    const result = validateOffboardingObservation(drifted);
    assert.equal(result.status, "observation_failed");
    assert.equal(result.observation, null);
    assert.equal(result.manifest_sha256, null);
    assert.match(result.errors.join(" "), /unexpected fields/);
    assert.match(result.errors.join(" "), /reviewed allowlist/);
    assert.match(result.errors.join(" "), /storage\.bytes is invalid/);
  });

  test("rejects raw identity or secret-shaped additions even when counts are valid", () => {
    const unsafe = structuredClone(observation()) as unknown as Record<string, unknown>;
    (unsafe.auth as Record<string, unknown>).email = "person@example.com";
    (unsafe.vault as Record<string, unknown>).secret_value = "hidden";

    const result = validateOffboardingObservation(unsafe);
    assert.equal(result.status, "observation_failed");
    assert.match(result.errors.join(" "), /auth has missing or unexpected fields/);
    assert.match(result.errors.join(" "), /vault has missing or unexpected fields/);
  });

  test("keeps structurally valid but internally inconsistent observations incomplete", () => {
    const incomplete = observation();
    incomplete.tenant.count = 0;
    incomplete.install_global.recording_baseline_field_policy.count = 16;
    incomplete.storage.transcript_references = 1;
    incomplete.vault.unreferenced_secrets = 1;

    const result = validateOffboardingObservation(incomplete);
    assert.equal(result.status, "inventory_incomplete");
    assert.notEqual(result.observation, null);
    assert.match(result.manifest_sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.match(result.errors.join(" "), /Exactly one tenant/);
    assert.match(result.errors.join(" "), /17 rows/);
    assert.match(result.errors.join(" "), /Storage transcript reference counts/);
    assert.match(result.errors.join(" "), /Unreferenced Vault secrets/);
  });

  test("passes an isolated restore only when every data and external control closes", () => {
    const source = observation();
    const target = restoreTarget(source);
    const result = evaluateIsolatedRestore(source, target, controls());

    assert.equal(result.status, "pass");
    assert.deepEqual(result.errors, []);
    assert.match(result.manifest_sha256 ?? "", /^[a-f0-9]{64}$/);
  });

  test("keeps zero-object Storage restores incomplete until configuration is verified", () => {
    const source = observation();
    const result = evaluateIsolatedRestore(
      source,
      restoreTarget(source),
      controls({
        storage_configuration: {
          ...controls().storage_configuration,
          status: "unverified",
        },
      }),
    );

    assert.equal(result.status, "incomplete");
    assert.match(result.errors.join(" "), /storage_configuration control is unverified/);
  });

  test("fails on data mismatch, same-project targets, or orphaned references", () => {
    const source = observation();
    const target = restoreTarget(source);
    target.project_ref = source.project_ref;
    target.tenant_tables[0] = {
      ...target.tenant_tables[0],
      count: target.tenant_tables[0].count + 1,
    };
    target.vault.dangling_references = 1;
    target.schema.application_catalog.fingerprint = fingerprint("drifted-schema");
    target.platform_catalog.table_state[0].fingerprint = fingerprint("drifted-platform-row");

    const result = evaluateIsolatedRestore(source, target, controls());
    assert.equal(result.status, "fail");
    assert.match(result.errors.join(" "), /project refs must differ/);
    assert.match(result.errors.join(" "), /tenant table ask_runs differs/);
    assert.match(result.errors.join(" "), /Dangling Vault references/);
    assert.match(result.errors.join(" "), /Application schema catalogs differ/);
    assert.match(result.errors.join(" "), /platform table auth\./);
  });

  test("does not mistake a matching database snapshot for complete restore proof", () => {
    const source = observation();
    const result = evaluateIsolatedRestore(
      source,
      restoreTarget(source),
      controls({
        provider_backup_reference: null,
        auth_configuration: {
          ...controls().auth_configuration,
          status: "unverified",
          evidence_reference: null,
        },
        vault_isolation: {
          ...controls().vault_isolation,
          status: "unverified",
          evidence_reference: null,
        },
        application_smoke: {
          ...controls().application_smoke,
          status: "unverified",
          evidence_reference: null,
        },
        cleanup: {
          ...controls().cleanup,
          status: "unverified",
          evidence_reference: null,
        },
      }),
    );

    assert.equal(result.status, "incomplete");
    assert.match(result.errors.join(" "), /Provider backup reference/);
    assert.match(result.errors.join(" "), /auth_configuration/);
    assert.match(result.errors.join(" "), /vault_isolation/);
    assert.match(result.errors.join(" "), /application_smoke/);
    assert.match(result.errors.join(" "), /cleanup/);
  });

  test("rejects extra or incorrectly typed restore control fields", () => {
    const invalid = {
      ...controls(),
      external_writers: "yes",
      secret_value: "must not be accepted",
    };
    const result = evaluateIsolatedRestore(observation(), restoreTarget(observation()), invalid);

    assert.equal(result.status, "fail");
    assert.equal(result.manifest_sha256, null);
    assert.match(result.errors.join(" "), /missing or unexpected fields/);
    assert.match(result.errors.join(" "), /external_writers is missing/);
  });

  test("normalizes set-like observation ordering before hashing", () => {
    const ordered = observation();
    const shuffled = structuredClone(ordered);
    shuffled.schema.discovered_tenant_tables.reverse();
    shuffled.schema.application_tables.public.reverse();
    shuffled.platform_catalog.auth_tables.reverse();
    shuffled.platform_catalog.table_state.reverse();
    shuffled.tenant_tables.reverse();

    assert.equal(
      validateOffboardingObservation(ordered).manifest_sha256,
      validateOffboardingObservation(shuffled).manifest_sha256,
    );
  });

  test("refuses stale or widely separated restore evidence", () => {
    const source = observation();
    const target = restoreTarget(source);
    source.captured_at_utc = "2026-08-01T00:00:00Z";
    target.captured_at_utc = "2026-08-03T00:00:00Z";
    const result = evaluateIsolatedRestore(
      source,
      target,
      controls({ captured_at_utc: "2026-08-03T00:01:00Z" }),
    );

    assert.equal(result.status, "incomplete");
    assert.match(result.errors.join(" "), /outside the 24-hour comparison window/);
    assert.match(result.errors.join(" "), /stale or future-dated/);
  });

  test("refuses future-dated subsystem evidence", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = evaluateIsolatedRestore(
      observation(),
      restoreTarget(observation()),
      controls({
        auth_configuration: {
          ...controls().auth_configuration,
          observed_at_utc: future,
        },
      }),
    );

    assert.equal(result.status, "incomplete");
    assert.match(result.errors.join(" "), /auth_configuration evidence is outside/);
  });

  test("requires fresh source and target observations plus post-target controls", () => {
    const source = observation();
    const target = restoreTarget(source);
    source.captured_at_utc = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    target.captured_at_utc = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
    const preTarget = new Date(Date.parse(target.captured_at_utc) - 10 * 60 * 1000).toISOString();
    const targetDependentControls = [
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

    for (const key of targetDependentControls) {
      const baselineControls = controls();
      const result = evaluateIsolatedRestore(
        source,
        target,
        controls({
          [key]: {
            ...baselineControls[key],
            observed_at_utc: preTarget,
          },
        }),
      );

      assert.equal(result.status, "incomplete");
      assert.match(result.errors.join(" "), /Source observation is stale/);
      assert.match(result.errors.join(" "), new RegExp(`${key} evidence predates the target`));
    }
  });

  test("CLI receipts expose status and hashes without claiming deletion authority", () => {
    const directory = mkdtempSync(join(tmpdir(), "lbb-offboarding-evidence-"));
    try {
      const source = observation();
      const target = restoreTarget(source);
      const sourcePath = join(directory, "source.json");
      const targetPath = join(directory, "target.json");
      const controlsPath = join(directory, "controls.json");
      writeFileSync(sourcePath, JSON.stringify(source), { mode: 0o600 });
      writeFileSync(targetPath, JSON.stringify(target), { mode: 0o600 });
      writeFileSync(controlsPath, JSON.stringify(controls()), { mode: 0o600 });

      const inventory = spawnSync(
        process.execPath,
        ["--experimental-strip-types", "scripts/generate-offboarding-inventory.ts", "--input", sourcePath],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      assert.equal(inventory.status, 0, inventory.stderr);
      const inventoryReceipt = JSON.parse(inventory.stdout) as Record<string, unknown>;
      assert.equal(inventoryReceipt.status, "inventory_complete");
      assert.equal(inventoryReceipt.offboarding_complete, false);
      assert.equal(inventoryReceipt.safe_to_delete, false);
      assert.match(String(inventoryReceipt.manifest_sha256), /^[a-f0-9]{64}$/);

      const restore = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "scripts/generate-isolated-restore-receipt.ts",
          "--source",
          sourcePath,
          "--target",
          targetPath,
          "--controls",
          controlsPath,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      assert.equal(restore.status, 0, restore.stderr);
      const restoreReceipt = JSON.parse(restore.stdout) as Record<string, unknown>;
      assert.equal(restoreReceipt.status, "pass");
      assert.equal(restoreReceipt.database_restore_alone_is_sufficient, false);
      assert.equal(restoreReceipt.controls_evidence_reference, "packet:restore-controls");
      assert.equal(restoreReceipt.production_was_modified, false);
      assert.equal(restoreReceipt.offboarding_complete, false);
      assert.equal(restoreReceipt.safe_to_delete, false);
      assert.match(String(restoreReceipt.restore_manifest_sha256), /^[a-f0-9]{64}$/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
