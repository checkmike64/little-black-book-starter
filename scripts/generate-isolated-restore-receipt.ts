import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateIsolatedRestore,
  validateOffboardingObservation,
} from "../lib/commercial/offboarding-evidence.ts";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function load(path: string | null, label: string): unknown {
  if (!path) fail(`${label} path is required`);
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch {
    fail(`${label} file is missing or invalid JSON`);
  }
}

function fail(message: string): never {
  process.stderr.write(`Isolated restore evidence refused: ${message}\n`);
  process.exit(1);
}

const source = load(argument("--source"), "--source");
const target = load(argument("--target"), "--target");
const controls = load(argument("--controls"), "--controls");
const sourceValidation = validateOffboardingObservation(source);
const targetValidation = validateOffboardingObservation(target);
const result = evaluateIsolatedRestore(source, target, controls);

const output = {
  status: result.status,
  source_observation_id: sourceValidation.observation?.observation_id ?? null,
  source_manifest_sha256: sourceValidation.manifest_sha256,
  target_observation_id: targetValidation.observation?.observation_id ?? null,
  target_manifest_sha256: targetValidation.manifest_sha256,
  restore_manifest_sha256: result.manifest_sha256,
  controls_evidence_reference:
    controls && typeof controls === "object" && !Array.isArray(controls) &&
    typeof (controls as Record<string, unknown>).controls_evidence_reference === "string"
      ? (controls as Record<string, unknown>).controls_evidence_reference
      : null,
  errors: result.errors,
  database_restore_alone_is_sufficient: false,
  production_was_modified: false,
  offboarding_complete: false,
  safe_to_delete: false,
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exitCode = result.status === "pass" ? 0 : result.status === "incomplete" ? 2 : 1;
