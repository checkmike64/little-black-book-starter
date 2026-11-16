import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260930190000_owner_selected_want_to_know_lanes.sql",
  "utf8",
);
const data = readFileSync("lib/want-to-know/data.ts", "utf8");
const research = readFileSync("app/api/claude/research-context/route.ts", "utf8");
const scans = readFileSync("lib/automation/content-scans.ts", "utf8");

describe("Want to Know relationship architecture", () => {
  test("requires explicit owner selection across every downstream read", () => {
    assert.match(migration, /owner_selected_at timestamptz/);
    assert.match(data, /\.not\("owner_selected_at", "is", null\)/);
    assert.match(research, /\.not\("owner_selected_at", "is", null\)/);
    assert.match(scans, /\.not\("owner_selected_at", "is", null\)/);
  });

  test("does not seed personal prospecting goals or delete private cohorts", () => {
    assert.doesNotMatch(migration, /delete from public|entrepreneur-dinner|data_source/);
  });

  test("prioritizes owner-selected prospects instead of leaving them behind the scan backlog", () => {
    assert.match(scans, /priorityWantToKnowIds\?: string\[\]/);
    assert.match(scans, /targetedOwnerScan/);
    assert.match(scans, /\.in\("want_to_know_id", priorityIds\)/);
    assert.match(scans, /\.order\("last_started_at", \{ ascending: true, nullsFirst: true \}\)/);
    assert.match(scans, /\.order\("want_to_know_id", \{ ascending: true, nullsFirst: false \}\)/);
    assert.match(
      scans,
      /settings\.daily_run_limit \+ \(targetedScan \? prioritySourceLimit : 0\)/,
    );
    assert.match(scans, /owner_priority: targetedOwnerScan/);
  });
});
