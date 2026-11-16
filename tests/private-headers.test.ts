import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { privateHeaderList, privateHeaderValues } from "../lib/private-headers.js";

describe("private headers", () => {
  test("blocks indexing and basic embedding risks", () => {
    assert.equal(
      privateHeaderValues["X-Robots-Tag"],
      "noindex, nofollow, noarchive, nosnippet, noimageindex",
    );
    assert.match(privateHeaderValues["Content-Security-Policy"], /frame-ancestors 'none'/);
    assert.match(privateHeaderValues["Content-Security-Policy"], /object-src 'none'/);
    assert.equal(privateHeaderValues["X-Frame-Options"], "DENY");
    assert.equal(privateHeaderValues["Referrer-Policy"], "no-referrer");
    assert.match(privateHeaderValues["Strict-Transport-Security"], /includeSubDomains/);
    assert.equal(privateHeaderValues["Cross-Origin-Opener-Policy"], "same-origin");
  });

  test("provides Next.js header list entries from the same policy", () => {
    const keys = privateHeaderList.map((header) => header.key);

    assert.ok(keys.includes("X-Robots-Tag"));
    assert.ok(keys.includes("Content-Security-Policy"));
    assert.equal(privateHeaderList.length, Object.keys(privateHeaderValues).length);
  });
});
