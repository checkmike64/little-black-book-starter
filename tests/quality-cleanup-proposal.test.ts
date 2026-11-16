import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  cleanupFieldNeedsOwnerVerification,
  cleanCleanupField,
  normalizeCleanupFieldValue,
} from "../lib/quality-cleanup-proposal.js";

describe("quality cleanup proposal rules", () => {
  test("normalizes scalar, date, boolean, and list field values", () => {
    assert.equal(
      normalizeCleanupFieldValue("company_name", "  Acme Partners  "),
      "Acme Partners",
    );
    assert.equal(normalizeCleanupFieldValue("last_spoke", "2026-07-20"), "2026-07-20");
    assert.equal(normalizeCleanupFieldValue("last_spoke", "July 20"), undefined);
    assert.equal(
      normalizeCleanupFieldValue("relationship_strength_override", "yes"),
      true,
    );
    assert.deepEqual(normalizeCleanupFieldValue("role_title", "CEO, Investor\nAdvisor"), [
      "CEO",
      "Investor",
      "Advisor",
    ]);
  });

  test("rejects unsupported or empty cleanup field inputs", () => {
    assert.equal(cleanCleanupField("company_name"), "company_name");
    assert.equal(cleanCleanupField("drop_table"), null);
    assert.equal(normalizeCleanupFieldValue("company_name", "   "), undefined);
    assert.equal(
      normalizeCleanupFieldValue("relationship_strength_override", "maybe"),
      undefined,
    );
  });

  test("marks judgment-sensitive fields as owner-verification required", () => {
    assert.equal(cleanupFieldNeedsOwnerVerification("trust_level"), true);
    assert.equal(cleanupFieldNeedsOwnerVerification("relationship_strength"), true);
    assert.equal(cleanupFieldNeedsOwnerVerification("private_notes"), true);
    assert.equal(cleanupFieldNeedsOwnerVerification("company_name"), false);
    assert.equal(cleanupFieldNeedsOwnerVerification("recent_activity"), false);
  });
});
