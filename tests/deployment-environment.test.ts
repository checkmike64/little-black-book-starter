import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  requiredProductionVariables,
  validateDeploymentEnvironment,
} from "../lib/deployment-environment.js";

function productionEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      "sb_publishable_Jq7pVm4kXz2tNc8sDf5hRw9yBg6uLa3e",
    SUPABASE_SERVICE_ROLE_KEY:
      "sb_secret_" + "SyntheticOnly_Qm8vXt5nKp2sDf7hRw4yBg9u",
    CLAUDE_READ_TOKEN: "read-Jq7pVm4kXz2tNc8sDf5hRw9yBg6uLa3e",
    CLAUDE_JOB_TOKEN: "jobs-Qm8vXt5nKp2sDf7hRw4yBg9uLa6eJc3z",
    CLAUDE_WRITE_TOKEN: "write-Rt6bYn3mHs9kPw4xCv7jDf2qLa8eZg5u",
    CRON_SECRET: "cron-Vc5xZa8qLm2nJf7tRw4yBg9uPk6eHs3d",
    DEFAULT_TENANT_ID: "d1d9d7fa-bff4-4f2a-98cc-f4de6cde6db8",
    OPERATOR_EMAILS: "operator@littleblackbook.app",
    SUPPORT_EMAIL: "info@test-install.invalid",
    NEXT_PUBLIC_SITE_URL: "https://book.test-install.invalid",
    ...overrides,
  };
}

describe("production deployment environment", () => {
  test("accepts a complete isolated client configuration", () => {
    const result = validateDeploymentEnvironment(productionEnv(), {
      production: true,
    });

    assert.equal(result.valid, true);
    assert.deepEqual(result.issues, []);
  });

  test("fails closed when capability credentials are missing or reused", () => {
    const shared = "same-000000000000000000000000000000000000";
    const result = validateDeploymentEnvironment(
      productionEnv({
        CLAUDE_READ_TOKEN: shared,
        CLAUDE_JOB_TOKEN: shared,
        CLAUDE_WRITE_TOKEN: undefined,
      }),
      { production: true },
    );

    assert.equal(result.valid, false);
    assert.ok(
      result.issues.some(
        (issue) =>
          issue.code === "missing" && issue.variables.includes("CLAUDE_WRITE_TOKEN"),
      ),
    );
    assert.ok(result.issues.some((issue) => issue.code === "duplicate_secret"));
  });

  test("rejects local URLs, weak secrets, invalid tenants, and setup mode", () => {
    const result = validateDeploymentEnvironment(
      productionEnv({
        NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
        CLAUDE_JOB_TOKEN: "short",
        DEFAULT_TENANT_ID: "not-a-uuid",
        ALLOW_SETUP_MODE: "true",
      }),
      { production: true },
    );

    assert.equal(result.valid, false);
    assert.deepEqual(
      new Set(result.issues.map((issue) => issue.code)),
      new Set(["insecure_url", "weak_secret", "invalid_uuid", "unsafe_setup_mode"]),
    );
  });

  test("accepts any isolated client project when its ref and URL match", () => {
    const result = validateDeploymentEnvironment(
      productionEnv({
        SUPABASE_PROJECT_REF: "zyxwvutsrqponmlkjihg",
        NEXT_PUBLIC_SUPABASE_URL: "https://zyxwvutsrqponmlkjihg.supabase.co",
      }),
      { production: true },
    );

    assert.equal(result.valid, true);
  });

  test("rejects malformed project refs and URL/ref mismatches", () => {
    const malformedRef = validateDeploymentEnvironment(
      productionEnv({ SUPABASE_PROJECT_REF: "not-a-project-ref" }),
      { production: true },
    );
    const mismatchedUrl = validateDeploymentEnvironment(
      productionEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://zyxwvutsrqponmlkjihg.supabase.co",
      }),
      { production: true },
    );

    assert.ok(
      malformedRef.issues.some((issue) => issue.code === "invalid_project_ref"),
    );
    assert.ok(
      mismatchedUrl.issues.some((issue) => issue.code === "invalid_project_ref"),
    );
  });

  test("supports an optional per-deployment project pin", () => {
    const matching = validateDeploymentEnvironment(
      productionEnv({
        EXPECTED_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
      }),
      { production: true },
    );
    const mismatched = validateDeploymentEnvironment(
      productionEnv({
        EXPECTED_SUPABASE_PROJECT_REF: "zyxwvutsrqponmlkjihg",
      }),
      { production: true },
    );

    assert.equal(matching.valid, true);
    assert.ok(
      mismatched.issues.some(
        (issue) =>
          issue.code === "invalid_project_ref" &&
          issue.variables.includes("EXPECTED_SUPABASE_PROJECT_REF"),
      ),
    );
  });

  test("rejects placeholders, malformed operator emails, and foreign provider origins", () => {
    const result = validateDeploymentEnvironment(
      productionEnv({
        SUPABASE_SERVICE_ROLE_KEY: "your-service-role-key-with-padding-000000000",
        OPERATOR_EMAILS: "operator@littleblackbook.app,not-an-email",
        NOTION_OAUTH_CLIENT_ID: "notion-client-id",
        NOTION_OAUTH_CLIENT_SECRET: "notion-client-secret",
        NOTION_REDIRECT_URI:
          "https://unexpected.test-install.invalid/api/integrations/notion/callback",
      }),
      { production: true },
    );

    assert.ok(result.issues.some((issue) => issue.code === "placeholder"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid_email"));
    assert.ok(result.issues.some((issue) => issue.code === "origin_mismatch"));
  });

  test("requires one explicit client-facing support address", () => {
    const missing = validateDeploymentEnvironment(
      productionEnv({ SUPPORT_EMAIL: undefined }),
      { production: true },
    );
    const invalid = validateDeploymentEnvironment(
      productionEnv({ SUPPORT_EMAIL: "not-an-email" }),
      { production: true },
    );

    assert.ok(
      missing.issues.some(
        (issue) =>
          issue.code === "missing" && issue.variables.includes("SUPPORT_EMAIL"),
      ),
    );
    assert.ok(
      invalid.issues.some(
        (issue) =>
          issue.code === "invalid_email" &&
          issue.variables.includes("SUPPORT_EMAIL"),
      ),
    );
    assert.ok(requiredProductionVariables.includes("SUPPORT_EMAIL"));
  });

  test("allows only a complete, distinct, short-lived UTC legacy cutover", () => {
    const now = new Date("2026-08-29T00:00:00.000Z");
    const valid = validateDeploymentEnvironment(
      productionEnv({
        CLAUDE_LEGACY_TOKEN_CUTOFF_AT: "2026-08-29T12:00:00Z",
      }),
      { production: true, now },
    );
    const tooFar = validateDeploymentEnvironment(
      productionEnv({
        CLAUDE_LEGACY_TOKEN: "legacy-Hs3dVc5xZa8qLm2nJf7tRw4yBg9uPk6e",
        CLAUDE_LEGACY_TOKEN_CUTOFF_AT: "2026-08-31T00:00:00Z",
      }),
      { production: true, now },
    );
    const incomplete = validateDeploymentEnvironment(
      productionEnv({
        CLAUDE_LEGACY_TOKEN: "legacy-Hs3dVc5xZa8qLm2nJf7tRw4yBg9uPk6e",
      }),
      { production: true, now },
    );

    assert.equal(valid.valid, true);
    assert.ok(tooFar.issues.some((issue) => issue.code === "cutoff_too_far"));
    assert.ok(
      incomplete.issues.some((issue) => issue.code === "partial_feature"),
    );
  });

  test("never lets the legacy bridge reuse read, job, or cron credentials", () => {
    const now = new Date("2026-08-29T00:00:00.000Z");
    const result = validateDeploymentEnvironment(
      productionEnv({
        CLAUDE_LEGACY_TOKEN: "read-Jq7pVm4kXz2tNc8sDf5hRw9yBg6uLa3e",
        CLAUDE_LEGACY_TOKEN_CUTOFF_AT: "2026-08-29T12:00:00Z",
      }),
      { production: true, now },
    );

    assert.ok(result.issues.some((issue) => issue.code === "duplicate_secret"));
  });

  test("rejects partially configured optional provider integrations", () => {
    const result = validateDeploymentEnvironment(
      productionEnv({
        NOTION_OAUTH_CLIENT_ID: "notion-id",
        APIFY_API_TOKEN: "apify-token",
      }),
      { production: true },
    );

    assert.equal(result.valid, false);
    assert.equal(
      result.issues.filter((issue) => issue.code === "partial_feature").length,
      2,
    );
  });

  test("does not block ordinary local builds", () => {
    const result = validateDeploymentEnvironment({}, { production: false });

    assert.equal(result.production, false);
    assert.equal(result.valid, true);
  });
});
