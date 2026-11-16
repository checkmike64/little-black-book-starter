import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canAccessOperatorTools,
  isAllowlistedOperatorEmail,
  isOperatorMode,
} from "../lib/operator-access-policy.js";

describe("operator access policy", () => {
  test("only operator tenant members are in operator mode", () => {
    assert.equal(isOperatorMode("operator"), true);
    assert.equal(isOperatorMode("owner"), false);
    assert.equal(isOperatorMode(null), false);
    assert.equal(isOperatorMode(undefined), false);
  });

  test("allows setup-mode access only for an allowlisted operator email", () => {
    const operatorEmails = ["Alex@Example.com"];

    assert.equal(
      canAccessOperatorTools({
        role: null,
        setupUserEmail: " alex@example.com ",
        operatorEmails,
      }),
      true,
    );
    assert.equal(
      canAccessOperatorTools({
        role: null,
        setupUserEmail: "owner@example.com",
        operatorEmails,
      }),
      false,
    );
  });

  test("does not let a non-operator tenant role inherit setup-mode privileges", () => {
    assert.equal(
      canAccessOperatorTools({
        role: "owner",
        setupUserEmail: "alex@example.com",
        operatorEmails: ["alex@example.com"],
      }),
      false,
    );
  });

  test("normalizes operator allowlist comparisons", () => {
    assert.equal(
      isAllowlistedOperatorEmail(" PERSON@EXAMPLE.COM ", ["person@example.com"]),
      true,
    );
  });
});
