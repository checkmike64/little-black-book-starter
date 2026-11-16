import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  isRetiredAlternateEmailChange,
  pendingChangeFieldPolicy,
} from "../lib/pending-change-field-policy.js";

describe("pending-change field policy", () => {
  test("retires legacy alternate-email aliases", () => {
    for (const field of [
      "extra.alt_emails",
      "extra.alt_email",
      "alt_emails",
      "alternate_email",
    ]) {
      assert.equal(
        isRetiredAlternateEmailChange({
          change_type: "field_update",
          payload: { field, proposed_value: "person@example.com" },
        }),
        true,
      );
    }

    assert.equal(
      isRetiredAlternateEmailChange({
        change_type: "new_contact",
        payload: {
          fields: {
            full_name: "Example Person",
            "extra.alt_emails": ["person@example.com"],
          },
        },
      }),
      true,
    );

    assert.equal(
      isRetiredAlternateEmailChange({
        change_type: "contact_candidate",
        payload: {
          candidate: {
            full_name: "Example Person",
            extra: { alt_emails: ["person@example.com"] },
          },
        },
      }),
      true,
    );
  });

  test("allows the primary email field and rejects unknown contact fields", () => {
    assert.deepEqual(
      pendingChangeFieldPolicy({
        change_type: "field_update",
        payload: { fields: { email: "person@example.com" } },
      }),
      {
        retiredFields: [],
        supportedFields: ["email"],
        unsupportedFields: [],
      },
    );

    assert.deepEqual(
      pendingChangeFieldPolicy({
        change_type: "contact_enrichment",
        payload: { fields: { invented_profile_field: "value" } },
      }).unsupportedFields,
      ["invented_profile_field"],
    );
  });

  test("enforces the policy before Claude creates a pending change", () => {
    const route = readFileSync("app/api/claude/pending-changes/route.ts", "utf8");
    const instructions = readFileSync("lib/claude-enrichment.ts", "utf8");

    assert.match(route, /pendingChangeFieldPolicy/);
    assert.match(route, /Alternate email proposals are not supported/);
    assert.match(route, /"new_contact", "contact_candidate"/);
    assert.match(route, /At least one supported contact field is required/);
    assert.match(instructions, /Never use extra\.alt_emails/);
  });
});
