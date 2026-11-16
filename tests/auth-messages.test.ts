import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  authErrorMessage,
  loginMessageFor,
  loginPathWithMessage,
} from "../lib/auth-messages.js";

describe("authentication messages", () => {
  test("turns provider failures into private, useful owner guidance", () => {
    assert.match(authErrorMessage(new Error("email rate limit exceeded")), /wait a few minutes/i);
    assert.match(authErrorMessage(new Error("Token has expired")), /fresh one/i);
    assert.doesNotMatch(authErrorMessage(new Error("PostgREST internal detail")), /postgrest/i);
  });

  test("separates successful email delivery from sign-in failures", () => {
    assert.deepEqual(loginMessageFor("check-email"), {
      text: "Check your email for the private sign-in link or code.",
      tone: "status",
    });
    assert.equal(loginMessageFor("missing-env")?.tone, "error");
    assert.equal(loginMessageFor(undefined), null);
  });

  test("preserves the intended private route without string-built query parameters", () => {
    assert.equal(
      loginPathWithMessage("check-email", "/ask?mode=referrals&q=trusted contact"),
      "/login?message=check-email&next=%2Fask%3Fmode%3Dreferrals%26q%3Dtrusted+contact",
    );
  });
});
