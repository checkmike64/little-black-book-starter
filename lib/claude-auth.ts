import { timingSafeEqual } from "node:crypto";
import {
  isClaudeLegacyCutoverActive,
  type DeploymentEnvironment,
} from "./deployment-environment.ts";

export type ClaudeAccessScope = "read" | "jobs" | "write";

export const claudeTokenEnvironmentKey = {
  read: "CLAUDE_READ_TOKEN",
  jobs: "CLAUDE_JOB_TOKEN",
  write: "CLAUDE_WRITE_TOKEN",
} as const satisfies Record<ClaudeAccessScope, string>;

function tokensMatch(suppliedToken: string | null, expectedToken?: string) {
  const supplied = suppliedToken ? Buffer.from(suppliedToken) : null;
  const expected = expectedToken ? Buffer.from(expectedToken) : null;
  return Boolean(
    supplied &&
      expected &&
      supplied.length === expected.length &&
      timingSafeEqual(supplied, expected),
  );
}

export function resolveClaudeCredential(
  suppliedToken: string | null,
  scope: ClaudeAccessScope,
  env: DeploymentEnvironment = process.env,
  now = Date.now(),
) {
  if (tokensMatch(suppliedToken, env[claudeTokenEnvironmentKey[scope]])) {
    return { authorized: true, credential: "scoped" as const, telemetry: null };
  }

  if (
    isClaudeLegacyCutoverActive(env, now) &&
    tokensMatch(
      suppliedToken,
      hasValue(env.CLAUDE_LEGACY_TOKEN)
        ? env.CLAUDE_LEGACY_TOKEN
        : env.CLAUDE_WRITE_TOKEN,
    )
  ) {
    return {
      authorized: true,
      credential: "legacy" as const,
      telemetry: {
        scope,
        cutoffAt: env.CLAUDE_LEGACY_TOKEN_CUTOFF_AT,
        source: hasValue(env.CLAUDE_LEGACY_TOKEN)
          ? "separate_legacy"
          : "write_fallback",
      },
    };
  }

  return { authorized: false, credential: null, telemetry: null };
}

function hasValue(value: string | undefined) {
  return Boolean(value?.trim());
}
