import { readdirSync, readFileSync } from "node:fs";

const activeMigrationDirectory = "supabase/migrations";

export const activeMigrationSql = readdirSync(activeMigrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`${activeMigrationDirectory}/${name}`, "utf8"))
  .join("\n");

// Declarative schema dumps quote identifiers while hand-written migrations
// generally do not. Contract tests care about installed semantics, not that
// formatting distinction.
export const normalizedActiveMigrationSql = activeMigrationSql.replaceAll('"', "");
