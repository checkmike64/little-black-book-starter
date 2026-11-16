import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const admin = readFileSync("app/(portal)/admin/page.tsx", "utf8");
const page = readFileSync("app/(portal)/admin/preinstall/page.tsx", "utf8");
const data = readFileSync("lib/preinstall/data.ts", "utf8");
const evidencePlan = readFileSync("lib/preinstall-evidence-plan.ts", "utf8");
const detail = readFileSync("app/(portal)/changes/[id]/page.tsx", "utf8");

describe("pre-install review UI", () => {
  test("is operator-only and reads complete tenant-scoped inventories", () => {
    assert.match(page, /await requireOperatorAccess\(\)/);
    assert.match(page, /getPreinstallReviewData\(\s*context\?\.tenantId/);
    assert.match(data, /createSupabaseAdminClient\(\)/);
    assert.match(data, /\.from\("pending_changes"\)[\s\S]*\.eq\("tenant_id", tenantId\)/);
    assert.match(data, /\.from\("contacts"\)[\s\S]*\.eq\("tenant_id", tenantId\)/);
    assert.match(data, /\.from\("jobs"\)[\s\S]*\.eq\("tenant_id", tenantId\)/);
    assert.match(data, /exactReadIsComplete/);
  });

  test("keeps exact matches review-first and source-blocked jobs unclaimed", () => {
    assert.match(page, /They are prepared for review, but are not merged\s+automatically/);
    assert.match(page, /A trigger or source label alone is not evidence/);
    assert.doesNotMatch(page, /action=|<form|rpc\(/);
    assert.match(detail, /recommendedExistingContact\(appDuplicates\)/);
    assert.match(detail, /We think this person is already in your Book/);
    assert.match(detail, /value=\{recommendedDuplicate\.contact\.id\}/);
    assert.match(detail, /This is a different person/);
  });

  test("links the review from the operator Control Center", () => {
    assert.match(admin, /href: "\/admin\/preinstall"/);
    assert.match(admin, /label: "Pre-install review"/);
  });

  test("separates technical proof from client decisions without auto-confirming", () => {
    assert.match(page, /buildPreinstallEvidencePlan/);
    assert.match(page, /Technical proof/);
    assert.match(page, /Client and operator records/);
    assert.match(page, /The app does not fill them in/);
    assert.match(page, /opaque evidence ID and confirmation state/);
    assert.match(evidencePlan, /status: "evidence_needed"/);
    assert.doesNotMatch(evidencePlan, /update|insert|rpc\(/i);
  });
});
