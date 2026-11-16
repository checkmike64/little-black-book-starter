import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { shouldShowOperatorTools } from "../lib/portal-nav-visibility.js";

describe("portal nav visibility", () => {
  test("shows operator tools to operators only when admin mode is enabled", () => {
    assert.equal(
      shouldShowOperatorTools({
        adminMode: false,
        role: "operator",
        setupMode: false,
      }),
      false,
    );
    assert.equal(
      shouldShowOperatorTools({
        adminMode: true,
        role: "operator",
        setupMode: false,
      }),
      true,
    );
  });

  test("hides operator tools from owners", () => {
    assert.equal(
      shouldShowOperatorTools({ role: "owner", setupMode: false }),
      false,
    );
    assert.equal(
      shouldShowOperatorTools({
        adminMode: true,
        role: "owner",
        setupMode: false,
      }),
      false,
    );
  });

  test("hides operator tools when Supabase is configured but membership is missing", () => {
    assert.equal(
      shouldShowOperatorTools({ role: null, setupMode: false }),
      false,
    );
  });

  test("keeps setup mode usable before Supabase is configured", () => {
    assert.equal(
      shouldShowOperatorTools({ role: null, setupMode: true }),
      true,
    );
  });
});
