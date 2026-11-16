import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

describe("operator commercial control center", () => {
  test("guards the route and links every read-only operational surface", () => {
    const page = readFileSync("app/(portal)/admin/page.tsx", "utf8");

    assert.match(page, /await requireOperatorAccess\(\)/);
    assert.match(page, /Control Center/);
    for (const href of ["/support", "/deployment", "/export", "/ops", "/quality"]) {
      assert.match(page, new RegExp(`href: "${href}"`));
    }
    assert.match(page, /does not change[\s\S]*client data or complete a production signoff/);
    assert.doesNotMatch(page, /<form|action=|createSupabaseAdminClient/);
  });

  test("uses the atomic evidence RPC and never updates settings or audit separately", () => {
    const actions = readFileSync("app/(portal)/deployment/actions.ts", "utf8");
    const page = readFileSync("app/(portal)/deployment/page.tsx", "utf8");

    assert.match(actions, /admin\.rpc\("lbb_update_production_check"/);
    assert.match(actions, /p_expected_version: expectedVersion/);
    assert.doesNotMatch(actions, /\.from\("tenants"\)/);
    assert.doesNotMatch(actions, /\.from\("audit_log"\)/);
    assert.match(page, /name="settings_version"/);
    assert.match(page, /name="evidence_ref"/);
    assert.match(page, /Opaque evidence ID/);
    assert.match(page, /" by operator"/);
    assert.doesNotMatch(page, /by \$\{item\.confirmedBy\}/);
  });
});
