#!/usr/bin/env node
// Independent backup of one Little Black Book install.
//
// Writes a self-contained restore kit: the data (one JSON file per table), the
// migrations that build the schema, and a manifest with row counts. Supabase's
// own nightly backups cover the last 7 days inside the same account; this
// covers going back further and losing access to the account.
//
// Needs a Supabase personal access token that can run read-only queries on the
// install's project (Database: Read is enough). Either export
// SUPABASE_ACCESS_TOKEN or store one in the macOS keychain once:
//   security add-generic-password -a "$USER" -s little-black-book-supabase-pat -U -w
// Then run, naming the project explicitly:
//   LBB_BACKUP_PROJECT_REF=<project ref> node scripts/backup-export.mjs
//
// Exits non-zero when any table could not be read, so a scheduled run that
// silently lost a table is reported as a failure, not a success.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const PROJECT_REF = (process.env.LBB_BACKUP_PROJECT_REF ?? process.env.SUPABASE_PROJECT_REF ?? "").trim();
const KEYCHAIN_SERVICE = "little-black-book-supabase-pat";
const KEEP_RUNS = Number.parseInt(process.env.LBB_BACKUP_KEEP ?? "12", 10) || 12;
const PAGE = 1000;
const BACKUP_ROOT =
  process.env.LBB_BACKUP_DIR ??
  path.join(homedir(), "Library/Mobile Documents/com~apple~CloudDocs/Black Book Backups");

// Schemas the app owns. `auth` and `storage` are Supabase-managed, so only the
// rows a restore needs are taken from them.
const OWNED_SCHEMAS = ["public", "app_private"];
const PLATFORM_TABLES = ["auth.users", "auth.identities", "storage.buckets", "storage.objects"];

if (!/^[a-z0-9]{20}$/.test(PROJECT_REF)) {
  console.error("Set LBB_BACKUP_PROJECT_REF (or SUPABASE_PROJECT_REF) to the 20-character project ref.");
  process.exit(2);
}

function accessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN?.trim()) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  try {
    return execFileSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], {
      encoding: "utf8",
    }).trim();
  } catch {
    throw new Error(
      "No Supabase access token. Set SUPABASE_ACCESS_TOKEN, or store one in the keychain:\n" +
        `  security add-generic-password -a "$USER" -s ${KEYCHAIN_SERVICE} -U -w`,
    );
  }
}

const token = accessToken();

// The read-only endpoint runs as supabase_read_only_user: a backup has no
// business being able to write, even if the token is later widened.
async function query(sql) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query/read-only`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!response.ok) {
    throw new Error(`Query failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  return response.json();
}

// ctid gives a stable order for paging a snapshot without knowing the primary key.
async function dumpTable(schema, table) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await query(
      `select coalesce(json_agg(t), '[]'::json) as rows from (
         select * from "${schema}"."${table}" order by ctid limit ${PAGE} offset ${offset}
       ) t`,
    );
    const batch = page[0]?.rows ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

async function main() {
  const takenAt = new Date().toISOString();
  const stamp = takenAt.slice(0, 16).replace(/[:T]/g, "-");
  const prefix = `little-black-book-${PROJECT_REF}-`;
  const runDir = path.join(BACKUP_ROOT, `${prefix}${stamp}`);
  const dataDir = path.join(runDir, "data");
  mkdirSync(dataDir, { recursive: true });

  const discovered = await query(
    `select table_schema, table_name from information_schema.tables
     where table_type = 'BASE TABLE'
       and table_schema in (${OWNED_SCHEMAS.map((schema) => `'${schema}'`).join(",")})
     order by table_schema, table_name`,
  );
  const targets = [
    ...discovered.map((row) => [row.table_schema, row.table_name]),
    ...PLATFORM_TABLES.map((qualified) => qualified.split(".")),
  ];

  const counts = {};
  const failures = {};
  for (const [schema, table] of targets) {
    try {
      const rows = await dumpTable(schema, table);
      counts[`${schema}.${table}`] = rows.length;
      writeFileSync(path.join(dataDir, `${schema}.${table}.json`), JSON.stringify(rows, null, 2));
      process.stdout.write(`  ${schema}.${table}: ${rows.length}\n`);
    } catch (error) {
      failures[`${schema}.${table}`] = error instanceof Error ? error.message : String(error);
      process.stdout.write(`  ${schema}.${table}: FAILED\n`);
    }
  }

  // The schema is version-controlled; ship the migrations with the data.
  const repo = path.resolve(import.meta.dirname, "..");
  cpSync(path.join(repo, "supabase/migrations"), path.join(runDir, "migrations"), { recursive: true });
  const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const totalRows = Object.values(counts).reduce((sum, count) => sum + count, 0);

  writeFileSync(
    path.join(runDir, "manifest.json"),
    JSON.stringify({ takenAt, projectRef: PROJECT_REF, gitSha, totalRows, counts, failures }, null, 2),
  );
  writeFileSync(
    path.join(runDir, "RESTORE.md"),
    `# Restoring this Little Black Book backup

Taken ${takenAt} from project \`${PROJECT_REF}\` at commit \`${gitSha}\`.
${totalRows} rows across ${Object.keys(counts).length} tables.${
      Object.keys(failures).length ? `\n\nNOT INCLUDED (read failed): ${Object.keys(failures).join(", ")}` : ""
    }

1. Create a fresh Supabase project.
2. Build the schema from \`migrations/\` with the pinned Supabase CLI (\`supabase db push\`),
   following docs/FOUNDATION_INSTALL_RUNBOOK.md.
3. Load \`data/\` table by table, parents before children: \`public.tenants\`, then
   \`public.tenant_members\` and \`public.tenant_config\`, then \`public.contacts\`, then the
   tables keyed to contacts (interactions, interaction_contacts, transcripts, promises,
   pending_changes, field_provenance, jobs, content_*), then the rest.
4. Re-create users in Supabase Auth. \`auth.users\` is here for reference; sessions and
   credentials do not move between projects.
5. Re-enter provider secrets (Claude tokens, Apify, recording providers) in the deployment.
   Secrets and Vault contents are deliberately absent from this export.

Storage object metadata is included; transcript files themselves are not.
`,
  );

  execFileSync("tar", ["-czf", `${runDir}.tar.gz`, "-C", BACKUP_ROOT, path.basename(runDir)]);
  rmSync(runDir, { recursive: true, force: true });

  const archives = readdirSync(BACKUP_ROOT)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".tar.gz"))
    .sort()
    .reverse();
  for (const stale of archives.slice(KEEP_RUNS)) rmSync(path.join(BACKUP_ROOT, stale), { force: true });

  process.stdout.write(`\n${totalRows} rows -> ${runDir}.tar.gz\n`);
  if (Object.keys(failures).length) {
    console.error(`Incomplete backup: ${Object.keys(failures).length} table(s) could not be read.`);
    for (const [table, message] of Object.entries(failures)) console.error(`  ${table}: ${message}`);
    process.exit(1);
  }
}

await main();
