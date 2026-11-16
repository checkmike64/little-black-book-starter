import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const migration = readFileSync(
  "supabase/migrations/20261001173929_simplify_want_to_know_cadence_and_stages.sql",
  "utf8",
);

describe("Want to Know cadence and stage migration", () => {
  test("omits private owner seed repairs", () => {
    assert.doesNotMatch(migration, /owner_podcast_list/);
  });

  test("stores the new default and constrained owner choices", () => {
    assert.match(migration, /alter column engagement_target_per_month set default 1/);
    assert.match(migration, /engagement_target_per_month between 0 and 5/);
    assert.match(migration, /where w\.stage = 'researching'/);
    assert.match(migration, /set stage = 'watching'/);
    assert.match(migration, /'watching'::text, 'warming'::text, 'ready'::text, 'graduated'::text/);
  });
});
