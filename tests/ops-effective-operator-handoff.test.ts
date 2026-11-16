import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("effective-operator Ops handoff boundary", () => {
  test("guards before creating service clients and passes the validated context", () => {
    const handoffPage = source("app/(portal)/ops/jobs/[id]/handoff/page.tsx");
    const detailPage = source("app/(portal)/ops/jobs/[id]/page.tsx");

    for (const page of [handoffPage, detailPage]) {
      const guard = page.indexOf("const operatorContext = await requireOperatorAccess()");
      const load = page.indexOf(
        page === handoffPage ? "await getHandoffData({" : "await getJobDetail({",
      );

      assert.ok(guard >= 0);
      assert.ok(load > guard);
      assert.match(page, /context: operatorContext/);
    }
  });

  test("handoff and inspector data fail closed before service-role reads", () => {
    for (const path of ["lib/ops/handoff-data.ts", "lib/ops/job-detail-data.ts"]) {
      const dataSource = source(path);
      const roleGuard = dataSource.indexOf('context.role !== "operator"');
      const admin = dataSource.indexOf("createSupabaseAdminClient()");
      const firstRead = dataSource.indexOf('.from("jobs")');

      assert.ok(roleGuard >= 0, `${path} must reject non-operators`);
      assert.ok(admin > roleGuard, `${path} must create service client after the guard`);
      assert.ok(firstRead > admin, `${path} must not read before authorization`);
      assert.equal(dataSource.includes("createSupabaseServerClient"), false);
      assert.match(
        dataSource.slice(firstRead, firstRead + 500),
        /\.eq\("tenant_id", context\.tenantId\)[\s\S]*\.eq\("id", id\)/,
      );
    }
  });

  test("handoff actions use the validated operator tenant for service reads", () => {
    const actions = source("app/(portal)/ops/actions.ts");
    const contextStart = actions.indexOf("async function getActionContext()");
    const contextEnd = actions.indexOf("function makeClaudeRequest", contextStart);
    const contextSource = actions.slice(contextStart, contextEnd);

    assert.ok(contextStart >= 0);
    assert.ok(
      contextSource.indexOf("await requireOperatorAccess()") <
        contextSource.indexOf("createSupabaseAdminClient()"),
    );
    assert.equal(contextSource.includes("createSupabaseServerClient"), false);
    assert.match(contextSource, /supabase: admin/);
    assert.match(contextSource, /tenantId: context\.tenantId/);

    for (const helper of ["getTestJob", "getHandoffJob", "getCommandActionJob"]) {
      const start = actions.indexOf(`async function ${helper}`);
      const end = actions.indexOf("\n}\n", start) + 3;
      const helperSource = actions.slice(start, end);

      assert.ok(start >= 0, `${helper} must exist`);
      assert.match(helperSource, /\.eq\("tenant_id", tenantId\)/);
      assert.match(helperSource, /typedJob\.tenant_id !== tenantId/);
    }
  });
});
