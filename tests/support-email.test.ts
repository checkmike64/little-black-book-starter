import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getSupportEmail } from "../lib/env.js";

describe("support email contract", () => {
  test("normalizes the explicit client-facing support address", () => {
    assert.equal(
      getSupportEmail({ SUPPORT_EMAIL: "  INFO@TEST-INSTALL.INVALID " }),
      "info@test-install.invalid",
    );
  });

  test("does not expose an operator account as an implicit support address", () => {
    assert.equal(
      getSupportEmail({ OPERATOR_EMAILS: "operator@littleblackbook.app" }),
      null,
    );
  });
});
