import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  ownerFlowSmokeRoutes,
  ownerModeForbiddenNavLabels,
  signedInOwnerSmokeRoutes,
} from "../lib/deployment-readiness.js";

function scriptSource() {
  return readFileSync(join(process.cwd(), "scripts/live-smoke.mjs"), "utf8");
}

function objectArrayPaths(source: string, variable: string) {
  const block = source.match(new RegExp(`const ${variable} = \\[([\\s\\S]*?)\\n\\];`))?.[1] ?? "";
  return [...block.matchAll(/path: "([^"]+)"/g)].map((match) => match[1]);
}

describe("live smoke script", () => {
  test("keeps explicit owner-flow route coverage in sync with deployment evidence", () => {
    const source = scriptSource();

    for (const route of ownerFlowSmokeRoutes) {
      assert.match(source, new RegExp(`path: "${route.path}"`));
      assert.match(source, new RegExp(`label: "${route.label}"`));
    }

    assert.deepEqual(
      objectArrayPaths(source, "ownerFlowPaths"),
      ownerFlowSmokeRoutes.map((route) => route.path),
    );

    assert.match(source, /"Owner flow"/);
    assert.match(source, /checkOwnerFlowRedirect/);
  });

  test("supports opt-in signed-in owner surface checks", () => {
    const source = scriptSource();

    assert.match(source, /LBB_SMOKE_COOKIE/);
    assert.match(source, /signedInOwnerPaths/);
    assert.match(source, /checkSignedInOwnerPage/);
    assert.match(source, /forbiddenOwnerNavLabels/);
    assert.match(source, /"Signed-in owner"/);

    for (const route of signedInOwnerSmokeRoutes) {
      assert.match(source, new RegExp(`path: "${route.path}"`));
      assert.match(source, new RegExp(`label: "${route.label}"`));
      assert.match(source, new RegExp(`expectedHeading: "${route.expectedHeading}"`));
    }
    assert.deepEqual(
      objectArrayPaths(source, "signedInOwnerPaths"),
      signedInOwnerSmokeRoutes.map((route) => route.path),
    );

    for (const label of ownerModeForbiddenNavLabels) {
      assert.match(source, new RegExp(`"${label}"`));
    }
    assert.ok(ownerModeForbiddenNavLabels.includes("Ask"));
    assert.ok(ownerModeForbiddenNavLabels.includes("Scoreboard"));
    assert.match(source, /const signedInOwnerProtectedPaths = \["\/admin", "\/recordings"\]/);
    assert.match(source, /checkSignedInOwnerProtectedPath/);
    assert.doesNotMatch(source, /path: "\/scoreboard"/);
  });

  test("checks every private Claude capability endpoint", () => {
    const source = scriptSource();

    assert.match(source, /"\/api\/claude\/research-context"/);
    assert.match(source, /"\/api\/claude\/calendar"/);
    assert.match(source, /"\/api\/claude\/interactions"/);
    assert.match(source, /"\/api\/claude\/content"/);
    assert.match(source, /"\/api\/claude\/networking"/);
    assert.match(source, /"\/api\/claude\/pending-changes"/);
    assert.match(source, /"\/api\/claude\/signals"/);
  });
});
