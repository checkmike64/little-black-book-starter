import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isOwnerForbiddenHref,
  ownerForbiddenHrefPrefixes,
  ownerSafeHref,
  ownerSafeHrefs,
} from "../runtime/owner-route-policy.js";

describe("owner route policy", () => {
  test("keeps owner routes unchanged", () => {
    assert.equal(ownerSafeHref("/dashboard"), "/dashboard");
    assert.equal(ownerSafeHref("/contacts?view=judgment"), "/contacts?view=judgment");
    assert.equal(ownerSafeHref("/ask?saved=needs_decision"), "/ask?saved=needs_decision");
  });

  test("reroutes operator-only surfaces in normal owner mode", () => {
    assert.equal(ownerSafeHref("/quality"), "/contacts?view=judgment");
    assert.equal(ownerSafeHref("/quality/queue"), "/contacts?view=judgment");
    assert.equal(ownerSafeHref("/ops/jobs/job-1"), "/dashboard");
    assert.equal(ownerSafeHref("/contacts/new?q=Alicia"), "/contacts");
    assert.equal(ownerSafeHref("/recordings"), "/changes");
    assert.equal(ownerSafeHref("/scoreboard"), "/dashboard");
    assert.equal(ownerSafeHref("/deployment"), "/dashboard");
    assert.equal(ownerSafeHref("/launch/preview"), "/dashboard");
    assert.equal(ownerSafeHref("/export/owner-handoff"), "/dashboard");
  });

  test("preserves operator-only surfaces in admin mode", () => {
    assert.equal(ownerSafeHref("/ops/jobs/job-1", true), "/ops/jobs/job-1");
    assert.equal(ownerSafeHref("/deployment", true), "/deployment");
  });

  test("detects forbidden owner hrefs and deduplicates safe lists", () => {
    assert.equal(isOwnerForbiddenHref("/ops/jobs/job-1"), true);
    assert.equal(isOwnerForbiddenHref("/movement"), false);
    assert.deepEqual(ownerSafeHrefs(["/ops", "/dashboard", "/ops"]), [
      "/dashboard",
    ]);
  });

  test("keeps the forbidden prefix set explicit and segment-aware", () => {
    assert.deepEqual(ownerForbiddenHrefPrefixes, [
      "/quality",
      "/ops",
      "/contacts/new",
      "/claude-setup",
      "/intake",
      "/recordings",
      "/scoreboard",
      "/launch",
      "/deployment",
      "/export",
      "/settings",
    ]);

    for (const prefix of ownerForbiddenHrefPrefixes) {
      assert.equal(isOwnerForbiddenHref(prefix), true, prefix);
      assert.equal(isOwnerForbiddenHref(`${prefix}/child?x=1#hash`), true, prefix);
      assert.notEqual(ownerSafeHref(prefix), prefix, prefix);
    }

    assert.equal(isOwnerForbiddenHref("/ops-notes"), false);
    assert.equal(isOwnerForbiddenHref("/settings-help"), false);
    assert.equal(isOwnerForbiddenHref("/quality-score"), false);
  });
});
