import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  deploymentReadiness,
  liveSmokeChecklistForSite,
  liveSmokeCommandForSite,
  ownerModeForbiddenNavLabels,
  ownerFlowSmokeRoutes,
  productionCheckEvidence,
  productionCheckItems,
  productionRedirectUrls,
  requiredVercelEnvironment,
  signedInOwnerSmokeChecklistForSite,
  signedInOwnerSmokeCommandForSite,
  signedInOwnerSmokeRoutes,
} from "../lib/deployment-readiness.js";

function baseEnv(overrides: Record<string, string | undefined> = {}) {
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
    OPERATOR_EMAILS: "alex@littleblackbook.app",
    SUPPORT_EMAIL: "info@test-install.invalid",
    NEXT_PUBLIC_SITE_URL: "https://book.test-install.invalid",
    NEXT_PUBLIC_INSTALL_NAME: "Test install",
    VERCEL: "1",
    VERCEL_URL: "little-black-book.vercel.app",
    ...overrides,
  };
}

function productionSiteCheck(env: Record<string, string | undefined>) {
  const readiness = deploymentReadiness(env);
  return readiness.checks.find((check) => check.label === "Production site URL");
}

function deploymentCommitCheck(env: Record<string, string | undefined>) {
  const readiness = deploymentReadiness(env);
  return readiness.checks.find((check) => check.label === "Deployment commit");
}

describe("deployment readiness", () => {
  test("lists the required support contact explicitly", () => {
    assert.ok(requiredVercelEnvironment.includes("SUPPORT_EMAIL"));
  });

  test("requires production email delivery and a current fallback-code exercise", () => {
    const auth = productionCheckItems.find(
      (item) => item.key === "auth_email_template_ready",
    );

    assert.equal(auth?.label, "Auth email delivery is production-ready");
    assert.match(auth?.detail ?? "", /production SMTP provider/);
    assert.match(auth?.detail ?? "", /fallback-code sign-in exercise/);
  });
  test("accepts a configured production site URL", () => {
    const readiness = deploymentReadiness(baseEnv());
    const siteUrl = productionSiteCheck(baseEnv());

    assert.equal(readiness.ready, true);
    assert.equal(readiness.blockingCount, 0);
    assert.equal(siteUrl?.tone, "ok");
    assert.equal(siteUrl?.value, "https://book.test-install.invalid");
  });

  test("requires every Claude capability token and the automation secret", () => {
    const readiness = deploymentReadiness(
      baseEnv({ CLAUDE_JOB_TOKEN: undefined, CRON_SECRET: undefined }),
    );

    assert.equal(readiness.ready, false);
    assert.deepEqual(
      readiness.checks
        .filter((check) => check.tone === "warn")
        .map((check) => check.label),
      ["Claude job token", "Automation secret", "Production environment policy"],
    );
  });

  test("surfaces the authoritative Supabase project identity", () => {
    const valid = deploymentReadiness(baseEnv()).checks.find(
      (check) => check.label === "Supabase project identity",
    );
    const missing = deploymentReadiness(
      baseEnv({ SUPABASE_PROJECT_REF: undefined }),
    ).checks.find((check) => check.label === "Supabase project identity");

    assert.equal(valid?.tone, "ok");
    assert.equal(valid?.value, "abcdefghijklmnopqrst");
    assert.equal(missing?.tone, "warn");
  });

  test("warns when production site URL is missing or invalid", () => {
    const missing = productionSiteCheck(baseEnv({ NEXT_PUBLIC_SITE_URL: undefined }));
    const invalid = productionSiteCheck(baseEnv({ NEXT_PUBLIC_SITE_URL: "CLIENT_DOMAIN" }));

    assert.equal(missing?.tone, "warn");
    assert.equal(missing?.value, "Missing");
    assert.equal(invalid?.tone, "warn");
    assert.equal(invalid?.value, "Invalid");
  });

  test("blocks localhost site URLs in Vercel deployments", () => {
    const siteUrl = productionSiteCheck(
      baseEnv({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }),
    );

    assert.equal(siteUrl?.tone, "warn");
    assert.equal(siteUrl?.value, "Localhost");
  });

  test("surfaces the Vercel source commit when available", () => {
    const check = deploymentCommitCheck(
      baseEnv({
        VERCEL_GIT_COMMIT_REF: "main",
        VERCEL_GIT_COMMIT_SHA: "fa76fcdb1fbd1234567890abcdef1234567890ab",
      }),
    );

    assert.equal(check?.tone, "ok");
    assert.equal(check?.value, "fa76fcd");
    assert.match(check?.detail ?? "", /main/);
  });

  test("formats auth redirect URLs and live smoke commands from a normalized origin", () => {
    assert.deepEqual(productionRedirectUrls("https://example.com/"), [
      "https://example.com/auth/callback",
      "http://localhost:3000/auth/callback",
    ]);

    assert.match(
      liveSmokeCommandForSite("https://example.com/some/path?ignored=true"),
      /pnpm smoke:live https:\/\/example\.com$/,
    );
  });

  test("builds an owner-flow live smoke checklist for production handoff", () => {
    const checklist = liveSmokeChecklistForSite("https://example.com/some/path?ignored=true");

    assert.equal(checklist.target, "https://example.com");
    assert.equal(checklist.ownerRoutes.length, ownerFlowSmokeRoutes.length);
    assert.deepEqual(
      checklist.ownerRoutes.map((route) => route.path),
      [
        "/dashboard",
        "/contacts",
        "/engagement",
        "/ask",
        "/movement",
        "/changes",
        "/want-to-know",
      ],
    );
    assert.match(checklist.command, /pnpm smoke:live https:\/\/example\.com$/);
    assert.ok(
      checklist.evidence.some((item) => item.includes("Unsigned Claude write calls")),
    );
  });

  test("builds a signed-in owner smoke checklist for production handoff", () => {
    const checklist = signedInOwnerSmokeChecklistForSite("https://example.com/dashboard");

    assert.equal(checklist.target, "https://example.com");
    assert.equal(checklist.routes.length, signedInOwnerSmokeRoutes.length);
    assert.deepEqual(
      checklist.routes.map((route) => route.expectedHeading),
      [
        "Today",
        "My Book",
        "Engagement",
        "Ask the Book",
        "Next Moves",
        "Changes",
        "Want to Know",
      ],
    );
    assert.ok(checklist.evidence.some((item) => item.includes("Owner routes render")));
    assert.ok(checklist.forbiddenNavLabels.includes("Ops"));
    assert.ok(ownerModeForbiddenNavLabels.includes("Deployment"));
    assert.match(checklist.command, /LBB_SMOKE_COOKIE/);
    assert.equal(
      checklist.command,
      signedInOwnerSmokeCommandForSite("https://example.com/dashboard"),
    );
  });

  test("summarizes persisted production check evidence", () => {
    const confirmedAt = "2026-07-20T12:00:00.000Z";
    const evidence = productionCheckEvidence({
      delivery: {
        production_checks: Object.fromEntries(
          productionCheckItems.map((item) => [
            item.key,
            {
              confirmed: true,
              confirmed_at: confirmedAt,
              confirmed_by: "alex@example.com",
              evidence_ref: `packet/${item.key}`,
            },
          ]),
        ),
      },
    });

    assert.equal(evidence.ready, true);
    assert.equal(evidence.confirmed, productionCheckItems.length);
    assert.equal(evidence.missing, 0);
    assert.equal(evidence.items[0]?.confirmedAt, confirmedAt);
    assert.equal(
      evidence.items[0]?.evidenceRef,
      `packet/${productionCheckItems[0]?.key}`,
    );
  });

  test("fails closed when a checked item has no external evidence reference", () => {
    const evidence = productionCheckEvidence({
      delivery: {
        production_checks: {
          supabase_project_isolated: {
            confirmed: true,
            confirmed_at: "2026-07-20T12:00:00.000Z",
            confirmed_by: "operator@example.com",
            evidence_ref: null,
          },
        },
      },
    });

    assert.equal(evidence.items[0]?.confirmed, false);
    assert.equal(evidence.items[0]?.evidenceRef, null);
  });
});
