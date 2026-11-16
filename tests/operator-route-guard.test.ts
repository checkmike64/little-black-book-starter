import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

describe("operator route guards", () => {
  test("protects the admin-backed quality queue before reading request input", () => {
    const source = readFileSync("app/(portal)/quality/queue/route.ts", "utf8");
    const guardIndex = source.indexOf("await requireOperatorAccess()");
    const formDataIndex = source.indexOf("await request.formData()");
    const queueIndex = source.indexOf("await queueQualityCleanupBatch(");

    assert.ok(guardIndex >= 0, "quality queue must require operator access");
    assert.ok(formDataIndex > guardIndex, "authorize before reading queue input");
    assert.ok(queueIndex > formDataIndex, "validate input before using the admin queue");
    assert.equal(source.includes("await getTenantContext()"), false);
  });

  test("requires visible admin mode before either settings mutation", () => {
    const source = readFileSync("app/(portal)/settings/actions.ts", "utf8");

    for (const actionName of ["updateInstallSettings", "updateIntakeSettings"]) {
      const actionStart = source.indexOf(`export async function ${actionName}`);
      const nextActionStart = source.indexOf("export async function", actionStart + 1);
      const actionSource = source.slice(
        actionStart,
        nextActionStart >= 0 ? nextActionStart : undefined,
      );
      const guardIndex = actionSource.indexOf("await requireOperatorAccess()");
      const contextIndex = actionSource.indexOf("await requireOperatorTenantActionContext(");

      assert.ok(actionStart >= 0, `${actionName} must exist`);
      assert.ok(guardIndex >= 0, `${actionName} must require visible admin mode`);
      assert.ok(contextIndex > guardIndex, `${actionName} must guard before loading admin context`);
    }
  });
});
