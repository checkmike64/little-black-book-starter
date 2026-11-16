import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  normalizeProductionEvidenceRef,
  parseProductionCheckSubmission,
  productionEvidenceRefMaxLength,
} from "../lib/production-check-evidence.js";

describe("production signoff evidence references", () => {
  test("accepts bounded opaque record identifiers and rejects content or URLs", () => {
    assert.equal(
      normalizeProductionEvidenceRef(" packet-2026/restore:v1 "),
      "packet-2026/restore:v1",
    );
    assert.equal(normalizeProductionEvidenceRef(""), null);
    assert.equal(normalizeProductionEvidenceRef("client name and notes"), null);
    assert.equal(normalizeProductionEvidenceRef("https://records.example/item"), null);
    assert.equal(
      normalizeProductionEvidenceRef("a".repeat(productionEvidenceRefMaxLength + 1)),
      null,
    );
  });

  test("refuses confirmation without a valid external evidence identifier", () => {
    const update = parseProductionCheckSubmission({
      confirmed: true,
      evidenceRef: "",
    });

    assert.equal(update.ok, false);
  });

  test("normalizes a valid reference for an explicit confirmation", () => {
    const update = parseProductionCheckSubmission({
      confirmed: true,
      evidenceRef: " packet-02/support:v2 ",
    });

    assert.deepEqual(update, {
      ok: true,
      confirmed: true,
      evidenceRef: "packet-02/support:v2",
    });
  });

  test("clears every evidence field when a signoff is removed", () => {
    const update = parseProductionCheckSubmission({
      confirmed: false,
      evidenceRef: "",
    });

    assert.deepEqual(update, {
      ok: true,
      confirmed: false,
      evidenceRef: null,
    });
  });
});
