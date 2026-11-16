import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const launchPage = fs.readFileSync(
  path.join(root, "app/(portal)/launch/page.tsx"),
  "utf8",
);
const launchData = fs.readFileSync(
  path.join(root, "lib/launch/data.ts"),
  "utf8",
);
const launchPreview = fs.readFileSync(
  path.join(root, "app/(portal)/launch/preview/page.tsx"),
  "utf8",
);
const handoffRoute = fs.readFileSync(
  path.join(root, "app/(portal)/export/owner-handoff/route.ts"),
  "utf8",
);
const handoffData = fs.readFileSync(
  path.join(root, "lib/export/owner-handoff-data.ts"),
  "utf8",
);
const opsData = fs.readFileSync(path.join(root, "lib/ops/data.ts"), "utf8");

test("launch captures the validated operator context before loading data", () => {
  assert.match(
    launchPage,
    /const operatorContext = await requireOperatorAccess\(\);[\s\S]*getLaunchData\(operatorContext\)/,
  );
  assert.match(
    launchPreview,
    /const operatorContext = await requireOperatorAccess\(\);[\s\S]*getPreviewData\(operatorContext\)/,
  );
});

test("launch data refuses non-operators before creating an admin client", () => {
  const roleGuard = launchData.indexOf(
    'if (!context || context.role !== "operator")',
  );
  const adminClient = launchData.indexOf("createSupabaseAdminClient()");

  assert.ok(roleGuard >= 0);
  assert.ok(adminClient > roleGuard);
});

test("launch reads service-only jobs through a tenant-scoped admin query", () => {
  assert.match(
    launchData,
    /admin\s*\.from\("jobs"\)[\s\S]*?\.eq\("tenant_id", tenantId\)/,
  );
  assert.equal(
    [...launchData.matchAll(/admin\s*\.from\("jobs"\)/g)].length,
    2,
  );
  assert.equal(
    [...launchData.matchAll(/supabase\s*\.from\("jobs"\)/g)].length,
    0,
  );
});

test("launch reconciles the full tenant-scoped pending review queue", () => {
  assert.match(
    launchData,
    /admin\s*\.from\("pending_changes"\)[\s\S]*?\.eq\("tenant_id", tenantId\)[\s\S]*?\.eq\("status", "pending"\)[\s\S]*?\.limit\(1000\)/,
  );
  assert.match(
    launchData,
    /buildReviewQueueObservation\(\{[\s\S]*?exactCount: reviewQueueRows\.count,[\s\S]*?error: reviewQueueRows\.error/,
  );
  assert.match(
    launchPage,
    /reviewQueueComplete: reviewQueue\.state === "complete"/,
  );
});

test("owner handoff export preserves the same operator-only evidence boundary", () => {
  assert.match(
    handoffRoute,
    /if \(context\?\.role !== "operator"\)[\s\S]*getOwnerHandoffExportData\(context\)/,
  );
  assert.match(
    handoffData,
    /if \(!context \|\| context\.role !== "operator"\) return null;[\s\S]*createSupabaseAdminClient\(\)/,
  );
  assert.match(
    handoffData,
    /admin\s*\.from\("jobs"\)[\s\S]*?\.eq\("tenant_id", tenantId\)/,
  );
  assert.match(
    handoffData,
    /pendingReviewCount: reviewQueue\.actionableCount[\s\S]*reviewQueue,/,
  );
});

test("Ops uses the same exact-count review queue observation", () => {
  assert.match(
    opsData,
    /\.from\("pending_changes"\)[\s\S]*?\{ count: "exact" \}[\s\S]*?\.eq\("tenant_id", tenantId\)[\s\S]*?\.eq\("status", "pending"\)[\s\S]*?\.limit\(1000\)/,
  );
  assert.match(
    opsData,
    /buildReviewQueueObservation\(\{[\s\S]*?exactCount: pending\.count,[\s\S]*?error: pending\.error/,
  );
});
