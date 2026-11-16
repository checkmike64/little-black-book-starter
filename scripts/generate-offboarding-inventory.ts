import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateOffboardingObservation } from "../lib/commercial/offboarding-evidence.ts";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function fail(message: string): never {
  process.stderr.write(`Offboarding inventory refused: ${message}\n`);
  process.exit(1);
}

const inputPath = argument("--input");
if (!inputPath) fail("--input must identify a sanitized observation JSON file");

let input: unknown;
try {
  input = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
} catch {
  fail("the observation file is missing or invalid JSON");
}

const result = validateOffboardingObservation(input);
const observation = result.observation;
const output = {
  status: result.status,
  observation_id: observation?.observation_id ?? null,
  captured_at_utc: observation?.captured_at_utc ?? null,
  environment: observation?.environment ?? null,
  release_sha: observation?.release_sha ?? null,
  tenant_table_count: observation?.tenant_tables.length ?? null,
  tenant_row_count:
    observation?.tenant_tables.reduce((sum, table) => sum + table.count, 0) ??
    null,
  auth_user_count: observation?.auth.users.count ?? null,
  storage_object_count: observation?.storage.objects.count ?? null,
  vault_reference_count: observation?.vault.references ?? null,
  manifest_sha256: result.manifest_sha256,
  errors: result.errors,
  offboarding_complete: false,
  safe_to_delete: false,
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exitCode = result.status === "inventory_complete" ? 0 : 1;
