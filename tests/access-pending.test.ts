import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const page = readFileSync("app/access-pending/page.tsx", "utf8");
const proxy = readFileSync("proxy.ts", "utf8");

describe("unassigned account boundary", () => {
  test("keeps the pending screen authenticated and free of relationship data", () => {
    assert.match(page, /await supabase\.auth\.getUser\(\)/);
    assert.match(page, /if \(!user\) redirect\("\/login"\)/);
    assert.match(page, /if \(await getTenantContext\(\)\) redirect\("\/dashboard"\)/);
    assert.match(page, /does not have an active client/);
    assert.doesNotMatch(proxy, /publicPaths = \[[^\]]*access-pending/s);
    assert.doesNotMatch(page, /\.from\(/);
  });
});
