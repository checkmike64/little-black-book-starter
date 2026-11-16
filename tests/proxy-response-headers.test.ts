import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// NextResponse.next({ headers }) sets RESPONSE headers. Passing the request's
// headers there echoed every inbound header (cookies, Vercel's internal proxy
// signature, a Server Action's multipart content type) back to the browser and
// into Server Action redirect responses, which left "Mark done" stuck on
// "Saving…". The proxy must forward the request with `{ request }` only.
test("the proxy never echoes request headers onto the response", () => {
  const proxy = readFileSync("proxy.ts", "utf8");
  assert.doesNotMatch(proxy, /headers:\s*request\.headers/);

  const nextCalls = proxy.match(/NextResponse\.next\([^)]*\)/g) ?? [];
  assert.ok(nextCalls.length > 0, "proxy.ts should continue requests with NextResponse.next");
  for (const call of nextCalls) {
    assert.equal(call.replace(/\s+/g, ""), "NextResponse.next({request})", `unexpected ${call}`);
  }
});
