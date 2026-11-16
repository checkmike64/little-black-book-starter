import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";
test("distribution has new-install docs and no private migration archive", () => {
  assert.equal(existsSync("supabase/migrations_archive"), false);
  assert.equal(existsSync("work/blackbook-handoff"), false);
  assert.equal(existsSync("supabase/bootstrap.sql"), true);
  assert.match(readFileSync("README.md", "utf8"), /all rights reserved/);
  assert.match(readFileSync("docs/CUSTOMIZATION.md", "utf8"), /30, 60, and 90/);
});
