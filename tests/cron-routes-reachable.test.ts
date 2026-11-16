import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { isMachineAuthenticatedPath } from "../lib/proxy-routing.js";

// Vercel Cron calls each path with GET and `Authorization: Bearer CRON_SECRET`.
// A cron path the login proxy does not recognize is redirected to /login and
// silently never runs (this happened to /api/automation/enrichment on its first
// deploy). Every scheduled path must be machine-authenticated end to end.
test("every Vercel cron path reaches its route without a login redirect", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  const proxy = readFileSync("proxy.ts", "utf8");
  assert.ok(vercel.crons.length > 0);

  for (const cron of vercel.crons) {
    assert.equal(isMachineAuthenticatedPath(cron.path), true, `${cron.path} is not machine-authenticated`);
    assert.ok(proxy.includes(`pathname === "${cron.path}"`), `${cron.path} is missing from proxy.ts public paths`);
    const routeFile = `app${cron.path}/route.ts`;
    assert.ok(existsSync(routeFile), `${routeFile} does not exist`);
    const route = readFileSync(routeFile, "utf8");
    assert.match(route, /export async function GET\(/, `${routeFile} must export GET for Vercel Cron`);
    assert.match(route, /CRON_SECRET/, `${routeFile} must check CRON_SECRET`);
  }
});
