import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function unique(matches) {
  return [...new Set(matches)].sort();
}

function matchAll(text, pattern) {
  return unique([...text.matchAll(pattern)].map((match) => match[1]));
}

function check(label, status, detail) {
  return { label, status, detail };
}

function statusIcon(status) {
  if (status === "pass") return "PASS";
  if (status === "warn") return "WARN";
  return "FAIL";
}

const packageJson = JSON.parse(read("package.json"));
const migrations = fs
  .readdirSync(path.join(root, "supabase/migrations"))
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => read(`supabase/migrations/${file}`));
const sql = migrations.join("\n").toLowerCase();
const createdTables = matchAll(
  sql,
  /create table(?: if not exists)?\s+"?public"?\."?([a-z0-9_]+)"?/g,
);
const rlsTables = matchAll(
  sql,
  /alter table\s+"?public"?\."?([a-z0-9_]+)"?\s+enable row level security/g,
);
const policyTables = matchAll(
  sql,
  /on\s+"?public"?\."?([a-z0-9_]+)"?\s+for\s+/g,
);
const missingRls = createdTables.filter((table) => !rlsTables.includes(table));

function grantTables(role, requiredPrivilege) {
  const granted = new Set();
  const statementPattern = /grant\s+([^;]+?)\s+on\s+(?:table\s+)?([^;]+?)\s+to\s+([^;]+?)\s*;/g;
  for (const match of sql.matchAll(statementPattern)) {
    const privileges = match[1].split(",").map((value) => value.trim());
    const roles = match[3].split(",").map((value) => value.trim().replaceAll('"', ""));
    if (!roles.includes(role)) continue;
    if (!privileges.includes("all") && !privileges.includes(requiredPrivilege)) continue;
    for (const tableMatch of match[2].matchAll(/"?public"?\."?([a-z0-9_]+)"?/g)) {
      granted.add(tableMatch[1]);
    }
  }
  return granted;
}

function browserDenyAll(table) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `revoke\\s+all(?:\\s+privileges)?\\s+on(?:\\s+table)?\\s+"?public"?\\."?${escaped}"?\\s+from\\s+"?public"?\\s*,\\s*"?anon"?\\s*,\\s*"?authenticated"?\\s*;`,
    "s",
  ).test(sql);
}

const authenticatedSelectTables = grantTables("authenticated", "select");
const serviceRoleTables = grantTables("service_role", "select");
const missingPolicies = createdTables.filter(
  (table) => !policyTables.includes(table) && !browserDenyAll(table),
);
const missingDataApiReadPlan = createdTables.filter(
  (table) => !authenticatedSelectTables.has(table) && !browserDenyAll(table),
);
const missingServiceRoleGrants = createdTables.filter(
  (table) => !serviceRoleTables.has(table),
);
const migrationFiles = fs
  .readdirSync(path.join(root, "supabase/migrations"))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const invalidMigrationNames = migrationFiles.filter(
  (file) => !/^(?:\d{14}|000[1-9])_[a-z0-9_]+\.sql$/.test(file),
);

function listFiles(relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  if (fs.statSync(absoluteDir).isFile()) return [relativeDir];

  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap((dirent) => {
    const child = path.join(relativeDir, dirent.name);
    return dirent.isDirectory() ? listFiles(child) : [child];
  });
}

const appAndLibFiles = ["app", "lib", "public", "next.config.ts", "proxy.ts", ".env.example"]
  .flatMap(listFiles)
  .filter((file) => /\.(ts|tsx|js|mjs|css|txt|example)$/.test(file));

const publicSecretLeak = appAndLibFiles
  .filter((file) => !file.includes("node_modules"))
  .filter((file) => /NEXT_PUBLIC_.*(SERVICE|SECRET|TOKEN|ROLE)/i.test(read(file)));

const envExample = read(".env.example");
const requiredEnv = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_PROJECT_REF",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CLAUDE_READ_TOKEN",
  "CLAUDE_JOB_TOKEN",
  "CLAUDE_WRITE_TOKEN",
  "CRON_SECRET",
  "DEFAULT_TENANT_ID",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_INSTALL_NAME",
];
const missingEnvExample = requiredEnv.filter((key) => !envExample.includes(key));

const nextConfig = read("next.config.ts");
const privateHeaders = read("lib/private-headers.ts");
const nextHeaderSurface = `${nextConfig}\n${privateHeaders}`;
const proxy = read("proxy.ts");
const proxyHeaderSurface = `${proxy}\n${privateHeaders}`;
const layout = read("app/layout.tsx");
const robots = read("public/robots.txt");
const transcriptBucketPrivate =
  /insert into storage\.buckets\s*\([^)]*id[^)]*name[^)]*public[^)]*\)\s*values\s*\(\s*'transcripts'\s*,\s*'transcripts'\s*,\s*false(?:\s*,|\s*\))/s.test(
    sql,
  ) && sql.includes("bucket_id = 'transcripts'");

const results = [
  check(
    "Every public table has RLS enabled in migrations",
    missingRls.length === 0 ? "pass" : "fail",
    missingRls.length === 0
      ? `${createdTables.length} public tables covered.`
      : `Missing RLS: ${missingRls.join(", ")}`,
  ),
  check(
    "Every browser-readable public table has a policy or an explicit deny-all posture",
    missingPolicies.length === 0 ? "pass" : "fail",
    missingPolicies.length === 0
      ? `${policyTables.length} tables have policy coverage.`
      : `Missing policies: ${missingPolicies.join(", ")}`,
  ),
  check(
    "Every public table has an explicit Data API read plan",
    missingDataApiReadPlan.length === 0 ? "pass" : "fail",
    missingDataApiReadPlan.length === 0
      ? `${createdTables.length} tables are explicitly readable or browser-denied.`
      : `Missing authenticated SELECT grant or browser deny-all: ${missingDataApiReadPlan.join(", ")}`,
  ),
  check(
    "Every public table is explicitly available to service-role workflows",
    missingServiceRoleGrants.length === 0 ? "pass" : "fail",
    missingServiceRoleGrants.length === 0
      ? `${createdTables.length} tables have an explicit service-role grant.`
      : `Missing service-role grants: ${missingServiceRoleGrants.join(", ")}`,
  ),
  check(
    "Migration filenames are deterministic",
    invalidMigrationNames.length === 0 ? "pass" : "fail",
    invalidMigrationNames.length === 0
      ? `${migrationFiles.length} migration filenames follow the accepted legacy or timestamp format.`
      : `Invalid migration filenames: ${invalidMigrationNames.join(", ")}`,
  ),
  check(
    "Local Supabase reset configuration exists",
    exists("supabase/config.toml") &&
      read("supabase/config.toml").includes("major_version = 17") &&
      packageJson.scripts?.["db:verify"]?.includes("supabase db reset --local")
      ? "pass"
      : "fail",
    "Requires a committed Postgres 17 config and a destructive-local-only reset command.",
  ),
  check(
    "RLS helpers are in a private schema",
    /create schema(?: if not exists)?\s+"?app_private"?/.test(sql) &&
      /revoke all on function\s+"?app_private"?\."?is_tenant_member"?/.test(sql) &&
      /revoke all on function\s+"?app_private"?\."?has_tenant_role"?/.test(sql)
      ? "pass"
      : "fail",
    "Security-definer membership helpers must not be exposed through public.",
  ),
  check(
    "Transcript storage is private",
    transcriptBucketPrivate ? "pass" : "fail",
    "The transcripts bucket should be private and read-gated by tenant membership.",
  ),
  check(
    "No public secret environment names",
    publicSecretLeak.length === 0 ? "pass" : "fail",
    publicSecretLeak.length === 0
      ? "No NEXT_PUBLIC service-role/secret/token variables found."
      : `Suspicious public secret references: ${publicSecretLeak.join(", ")}`,
  ),
  check(
    "Required env vars are documented",
    missingEnvExample.length === 0 ? "pass" : "fail",
    missingEnvExample.length === 0
      ? "All install-critical variables are present in .env.example."
      : `Missing from .env.example: ${missingEnvExample.join(", ")}`,
  ),
  check(
    "Search indexing is blocked",
    nextHeaderSurface.includes("X-Robots-Tag") &&
      proxyHeaderSurface.includes("X-Robots-Tag") &&
      layout.includes("index: false") &&
      robots.includes("Disallow: /")
      ? "pass"
      : "fail",
    "Requires headers, metadata robots, proxy header, and robots.txt.",
  ),
  check(
    "Security headers are configured",
    ["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"].every(
      (header) => nextHeaderSurface.includes(header),
    )
      ? "pass"
      : "warn",
    "Next headers should keep the private app framed, sniffed, or over-permissioned less often.",
  ),
  check(
    "Tenant settings have one canonical write path",
    sql.includes("tenants.settings` is the only writable configuration source") &&
      sql.includes("sync_tenant_config_from_settings") &&
      sql.includes('drop policy if exists "owner and operator update config"') &&
      !read("lib/supabase-install-sql.ts").includes("insert into public.tenant_config")
      ? "pass"
      : "fail",
    "tenants.settings must version and project into a read-only tenant_config compatibility table.",
  ),
  check(
    "Claude writes are policy and quota gated",
    sql.includes("lbb_authorize_claude_write") &&
      sql.includes("claude_write_receipts") &&
      read("app/api/claude/_shared.ts").includes("authorizeClaudeWrite")
      ? "pass"
      : "fail",
    "The service-role gateway must enforce mechanical-write policy and an idempotent daily budget.",
  ),
  check(
    "Claude gateway routes exist",
    [
      "app/api/claude/jobs/route.ts",
      "app/api/claude/jobs/[id]/complete/route.ts",
      "app/api/claude/jobs/[id]/fail/route.ts",
      "app/api/claude/interactions/route.ts",
      "app/api/claude/pending-changes/route.ts",
    ].every(exists)
      ? "pass"
      : "fail",
    "Claude should write through narrow app endpoints, not directly to Supabase.",
  ),
  check(
    "Local verification command exists",
    packageJson.scripts?.check && packageJson.scripts?.rehearsal && packageJson.scripts?.["smoke:live"]
      ? "pass"
      : "warn",
    "Expected package scripts: check, rehearsal, and smoke:live.",
  ),
];

console.log("\nLittle Black Book install rehearsal\n");
results.forEach((result) => {
  console.log(`[${statusIcon(result.status)}] ${result.label}`);
  console.log(`       ${result.detail}`);
});

const failCount = results.filter((result) => result.status === "fail").length;
const warnCount = results.filter((result) => result.status === "warn").length;
console.log(`\nSummary: ${failCount} fail, ${warnCount} warn, ${results.length} total checks.\n`);

if (failCount > 0) {
  process.exitCode = 1;
}
