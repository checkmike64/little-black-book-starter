import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildExportHandoffReadiness,
  formatExportHandoffSummary,
  type ExportHandoffSummaryInput,
} from "../lib/export-handoff-summary.js";

function input(overrides: Partial<ExportHandoffSummaryInput> = {}): ExportHandoffSummaryInput {
  return {
    exportedAt: "2026-07-20T12:00:00.000Z",
    tenantName: "Moll Group",
    manifest: {
      tenantName: "Moll Group",
      readyForOwnerUse: true,
      ownerVisibility: "Setup and intake hidden from owner",
      ownerReviewSurface: "Pending Changes only",
      enabledModules: ["Ask", "Networking"],
      hiddenModules: ["Engagement"],
      missingSetup: [],
      writePosture: {
        mechanicalWrites: "Allowed for observed facts",
        judgmentFields: "Proposal only",
        transcriptStorage: "Full intake transcript first, then detailed notes",
      },
    },
    sections: [
      { key: "contacts", label: "Contacts", table: "contacts", count: 10 },
      { key: "pending_changes", label: "Pending changes", table: "pending_changes", count: 0 },
      {
        key: "relationship_actions",
        label: "Relationship actions",
        table: "relationship_actions",
        count: 3,
      },
      { key: "jobs", label: "Claude jobs", table: "jobs", count: 2 },
      { key: "ask_runs", label: "Saved Ask runs", table: "ask_runs", count: 1 },
      { key: "audit_log", label: "Audit log", table: "audit_log", count: 4 },
      { key: "field_provenance", label: "Field provenance", table: "field_provenance", count: 5 },
    ],
    ...overrides,
  };
}

describe("export handoff summary", () => {
  test("marks complete export evidence ready", () => {
    const readiness = buildExportHandoffReadiness(input());

    assert.equal(readiness.ready, true);
    assert.equal(readiness.counts.contacts, 10);
    assert.equal(readiness.counts.askRuns, 1);
    assert.equal(readiness.counts.relationshipActions, 3);
    assert.equal(readiness.nextActions.length, 0);
  });

  test("blocks handoff when review or evidence is missing", () => {
    const readiness = buildExportHandoffReadiness(
      input({
        manifest: {
          ...input().manifest,
          readyForOwnerUse: false,
          missingSetup: ["Launch notes"],
        },
        sections: [
          { key: "contacts", label: "Contacts", table: "contacts", count: 0 },
          { key: "pending_changes", label: "Pending changes", table: "pending_changes", count: 3 },
          { key: "jobs", label: "Claude jobs", table: "jobs", count: 0 },
          { key: "ask_runs", label: "Saved Ask runs", table: "ask_runs", count: 0 },
          {
            key: "relationship_actions",
            label: "Relationship actions",
            table: "relationship_actions",
            count: 0,
          },
        ],
      }),
    );

    assert.equal(readiness.ready, false);
    assert.match(readiness.blockers.join(" "), /pending change/);
    assert.match(readiness.blockers.join(" "), /no contacts/);
    assert.ok(readiness.nextActions.some((action) => action.href === "/movement"));
  });

  test("formats a concise text packet", () => {
    const text = formatExportHandoffSummary(input());

    assert.match(text, /Little Black Book export handoff: Moll Group/);
    assert.match(text, /Saved Ask runs: 1/);
    assert.match(text, /Relationship actions: 3/);
    assert.match(text, /Operator next actions:/);
    assert.match(text, /Setup and intake hidden from owner/);
  });

  test("blocks handoff evidence when a portable export section is capped", () => {
    const readiness = buildExportHandoffReadiness(
      input({
        sections: input().sections.map((section, index) =>
          index === 0
            ? {
                ...section,
                count: 11,
                exportedCount: 10,
                limit: 10,
                truncated: true,
              }
            : section,
        ),
      }),
    );

    assert.equal(readiness.ready, false);
    assert.match(readiness.blockers.join(" "), /failed or was capped/);
    assert.ok(readiness.nextActions.some((action) => action.href === "/export"));
  });
});
