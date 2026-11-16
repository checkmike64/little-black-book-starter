import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { shouldUseAdminTools } from "../lib/admin-mode.js";
import { shouldAllowOperatorSurface } from "../lib/operator-surface-access.js";

describe("admin mode", () => {
  test("keeps operators in normal owner-style mode by default", () => {
    assert.equal(
      shouldUseAdminTools({ role: "operator", cookieValue: null }),
      false,
    );
  });

  test("shows admin tools only for operators with the mode cookie", () => {
    assert.equal(
      shouldUseAdminTools({ role: "operator", cookieValue: "show" }),
      true,
    );
    assert.equal(
      shouldUseAdminTools({ role: "owner", cookieValue: "show" }),
      false,
    );
  });

  test("keeps setup mode accessible before Supabase is configured", () => {
    assert.equal(shouldUseAdminTools({ role: null, setupMode: true }), true);
  });

  test("requires explicit admin mode for operator surfaces", () => {
    assert.equal(
      shouldAllowOperatorSurface({ role: "operator", adminMode: false, setupMode: false }),
      false,
    );
    assert.equal(
      shouldAllowOperatorSurface({ role: "operator", adminMode: true, setupMode: false }),
      true,
    );
    assert.equal(
      shouldAllowOperatorSurface({ role: "owner", adminMode: true, setupMode: false }),
      false,
    );
    assert.equal(
      shouldAllowOperatorSurface({ role: null, adminMode: false, setupMode: true }),
      true,
    );
  });
});
