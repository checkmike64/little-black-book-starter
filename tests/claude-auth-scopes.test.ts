import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  claudeTokenEnvironmentKey,
  resolveClaudeCredential,
  type ClaudeAccessScope,
} from "../lib/claude-auth.js";

const routes = {
  read: ["app/api/claude/research-context/route.ts"],
  jobs: [
    "app/api/claude/jobs/route.ts",
    "app/api/claude/jobs/[id]/complete/route.ts",
    "app/api/claude/jobs/[id]/fail/route.ts",
  ],
  write: [
    "app/api/claude/calendar/route.ts",
    "app/api/claude/content/route.ts",
    "app/api/claude/interactions/route.ts",
    "app/api/claude/networking/route.ts",
    "app/api/claude/pending-changes/route.ts",
    "app/api/claude/signals/route.ts",
  ],
} as const;

const scopeTokens = {
  read: "read-Jq7pVm4kXz2tNc8sDf5hRw9yBg6uLa3e",
  jobs: "jobs-Qm8vXt5nKp2sDf7hRw4yBg9uLa6eJc3z",
  write: "write-Rt6bYn3mHs9kPw4xCv7jDf2qLa8eZg5u",
} as const satisfies Record<ClaudeAccessScope, string>;

const scopedEnvironment = {
  CLAUDE_READ_TOKEN: scopeTokens.read,
  CLAUDE_JOB_TOKEN: scopeTokens.jobs,
  CLAUDE_WRITE_TOKEN: scopeTokens.write,
};

describe("Claude route capability boundaries", () => {
  test("assigns every privileged route one explicit credential scope", () => {
    for (const [scope, paths] of Object.entries(routes)) {
      for (const path of paths) {
        const source = readFileSync(join(process.cwd(), path), "utf8");
        assert.match(
          source,
          new RegExp(`authenticateClaudeRequest\\(request, "${scope}"\\)`),
          `${path} must require the ${scope} capability`,
        );
      }
    }
  });

  test("maps scopes to distinct server-only environment variables", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/claude-auth.ts"),
      "utf8",
    );

    assert.match(source, /read: "CLAUDE_READ_TOKEN"/);
    assert.match(source, /jobs: "CLAUDE_JOB_TOKEN"/);
    assert.match(source, /write: "CLAUDE_WRITE_TOKEN"/);
    assert.doesNotMatch(source, /NEXT_PUBLIC_CLAUDE/);
  });

  test("keeps expected unsigned probes out of production error telemetry", () => {
    const content = readFileSync(
      join(process.cwd(), "app/api/claude/content/route.ts"),
      "utf8",
    );
    const signals = readFileSync(
      join(process.cwd(), "app/api/claude/signals/route.ts"),
      "utf8",
    );
    const research = readFileSync(
      join(process.cwd(), "app/api/claude/research-context/route.ts"),
      "utf8",
    );

    assert.match(content, /event\.stage !== "authentication"/);
    assert.match(signals, /event\.stage !== "authentication"/);
    assert.match(research, /console\.info\("claude_research_context"/);
  });

  test("accepts only the credential assigned to the requested scope", () => {
    for (const scope of Object.keys(scopeTokens) as ClaudeAccessScope[]) {
      const accepted = resolveClaudeCredential(
        scopeTokens[scope],
        scope,
        scopedEnvironment,
      );
      assert.equal(accepted.authorized, true);
      assert.equal(accepted.credential, "scoped");

      for (const [otherScope, token] of Object.entries(scopeTokens)) {
        if (otherScope === scope) continue;
        const rejected = resolveClaudeCredential(token, scope, scopedEnvironment);
        assert.equal(rejected.authorized, false);
        assert.equal(rejected.credential, null);
      }
    }
  });

  test("accepts the legacy credential only before cutoff and exposes no secret in telemetry", () => {
    const legacyToken = scopeTokens.write;
    const now = Date.parse("2026-08-29T00:00:00Z");
    const legacyEnvironment = {
      ...scopedEnvironment,
      CLAUDE_LEGACY_TOKEN_CUTOFF_AT: "2026-08-29T01:00:00Z",
    };
    const accepted = resolveClaudeCredential(
      legacyToken,
      "read",
      legacyEnvironment,
      now,
    );
    assert.equal(accepted.authorized, true);
    assert.equal(accepted.credential, "legacy");
    assert.deepEqual(accepted.telemetry, {
      scope: "read",
      cutoffAt: "2026-08-29T01:00:00Z",
      source: "write_fallback",
    });
    assert.doesNotMatch(JSON.stringify(accepted.telemetry), new RegExp(legacyToken));

    const writeRequest = resolveClaudeCredential(
      legacyToken,
      "write",
      legacyEnvironment,
      now,
    );
    assert.equal(writeRequest.credential, "scoped");
    assert.equal(writeRequest.telemetry, null);

    const expired = resolveClaudeCredential(
      legacyToken,
      "read",
      legacyEnvironment,
      Date.parse("2026-08-29T01:00:00Z"),
    );
    assert.equal(expired.authorized, false);
  });
});
