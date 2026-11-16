import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pathWithMessage, safeReturnPath } from "../lib/return-path.js";

describe("server action redirect helpers", () => {
  test("preserves safe internal paths and query strings", () => {
    assert.equal(safeReturnPath("/movement?view=hot", "/dashboard"), "/movement?view=hot");
  });

  test("rejects absolute and protocol-relative return targets", () => {
    assert.equal(safeReturnPath("https://example.com", "/dashboard"), "/dashboard");
    assert.equal(safeReturnPath("//example.com/path", "/dashboard"), "/dashboard");
    assert.equal(safeReturnPath("/\\example.com/path", "/dashboard"), "/dashboard");
    assert.equal(safeReturnPath("/contacts\nSet-Cookie:x", "/dashboard"), "/dashboard");
  });

  test("falls back for missing return targets", () => {
    assert.equal(safeReturnPath(null, "/dashboard"), "/dashboard");
    assert.equal(safeReturnPath(undefined, "/dashboard"), "/dashboard");
  });

  test("adds messages while preserving useful query params", () => {
    assert.equal(
      pathWithMessage("/movement?view=hot", "Relationship action updated."),
      "/movement?view=hot&message=Relationship+action+updated.",
    );
  });

  test("replaces stale messages instead of appending another one", () => {
    assert.equal(
      pathWithMessage(
        "/contacts/123?message=Relationship%20action%20created.&view=profile",
        "Relationship action marked skipped.",
      ),
      "/contacts/123?view=profile&message=Relationship+action+marked+skipped.",
    );
  });

  test("preserves hash fragments when attaching messages", () => {
    assert.equal(
      pathWithMessage("/changes?lane=review#proposal", "Saved."),
      "/changes?lane=review&message=Saved.#proposal",
    );
  });
});
