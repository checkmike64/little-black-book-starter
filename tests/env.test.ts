import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isProductionRuntime, isSetupModeAllowed } from "../lib/env.js";

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...overrides,
  };
}

describe("environment setup mode", () => {
  test("requires explicit setup mode even outside deployed production", () => {
    assert.equal(isProductionRuntime(env({ NODE_ENV: "production" })), false);
    assert.equal(isSetupModeAllowed(env({ NODE_ENV: "production" })), false);
    assert.equal(
      isSetupModeAllowed(env({ NODE_ENV: "development", ALLOW_SETUP_MODE: "true" })),
      true,
    );
  });

  test("fails closed on deployed production unless setup mode is explicit", () => {
    assert.equal(isProductionRuntime(env({ VERCEL_ENV: "production" })), true);
    assert.equal(isSetupModeAllowed(env({ VERCEL_ENV: "production" })), false);
    assert.equal(
      isSetupModeAllowed(env({ VERCEL_ENV: "production", ALLOW_SETUP_MODE: "true" })),
      true,
    );
  });

  test("can explicitly disable setup mode in any environment", () => {
    assert.equal(isSetupModeAllowed(env({ ALLOW_SETUP_MODE: "false" })), false);
  });
});
