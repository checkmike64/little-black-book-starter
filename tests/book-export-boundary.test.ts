import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  bookExportExcludedSections,
  bookExportTables,
  bookExportTenantScopedTables,
  buildBookExportManifest,
  type ExportSection,
} from "../lib/book-export-manifest.js";

function section(
  table: (typeof bookExportTables)[number],
  overrides: Partial<ExportSection> = {},
): ExportSection {
  return {
    key: table.key,
    label: table.label,
    table: table.table,
    count: 3,
    exportedCount: 3,
    limit: table.limit,
    truncated: false,
    ...overrides,
  };
}

describe("portable book export boundary", () => {
  it("reports row caps instead of presenting a partial export as complete", () => {
    const source = readFileSync("lib/book-export.ts", "utf8");

    assert.match(source, /exportedCount/);
    assert.match(source, /truncated/);
    assert.match(source, /totalCount > exportedCount/);
    assert.match(source, /error: "section_read_failed"/);
    assert.doesNotMatch(source, /error: error\.message/);
  });

  it("distinguishes portable client data from disaster recovery", () => {
    const page = readFileSync("app/(portal)/export/page.tsx", "utf8");

    assert.match(page, /portable snapshot/i);
    assert.match(page, /not a disaster-recovery/);
    assert.match(page, /Auth, Storage, configuration, or credentials/);
  });

  it("categorizes the exact current tenant table inventory", () => {
    const manifest = buildBookExportManifest(
      bookExportTables.map((table) => section(table)),
    );
    const excludedTenantTables = bookExportExcludedSections.flatMap((item) =>
      item.tenantScoped ? [...item.tables] : [],
    );

    assert.equal(bookExportTables.length, 16);
    assert.equal(excludedTenantTables.length, 22);
    assert.equal(bookExportTenantScopedTables.length, 38);
    assert.equal(manifest.scopeInventoryReady, true);
    assert.deepEqual(manifest.uncategorized, []);
    assert.deepEqual(manifest.unexpected, []);
    assert.deepEqual(manifest.duplicate, []);
    assert.equal(manifest.offboardingComplete, false);
  });

  it("fails closed when an included section is capped or cannot be read", () => {
    const capped = bookExportTables.map((table, index) =>
      section(
        table,
        index === 0
          ? { count: table.limit + 1, exportedCount: table.limit, truncated: true }
          : index === 1
            ? { count: null, exportedCount: 0, error: "private database detail" }
            : {},
      ),
    );
    const manifest = buildBookExportManifest(capped);

    assert.equal(manifest.portableExportReady, false);
    assert.equal(manifest.capped.length, 1);
    assert.equal(manifest.failed.length, 1);
    assert.equal(manifest.offboardingComplete, false);
  });

  it("keeps the UI operator-only and never presents export as completed offboarding", () => {
    const page = readFileSync("app/(portal)/export/page.tsx", "utf8");
    const privacy = readFileSync("app/(portal)/privacy/page.tsx", "utf8");

    assert.match(page, /await requireOperatorAccess\(\)/);
    assert.match(page, /This portable export does not complete offboarding/);
    assert.match(page, /Excluded Sections/);
    assert.match(page, /section\.error\s*\? `\$\{section\.table\} could not be read/);
    assert.doesNotMatch(privacy, /complete export/i);
    assert.match(privacy, /portable export of applicable relationship[\s\S]*data/i);
  });
});
