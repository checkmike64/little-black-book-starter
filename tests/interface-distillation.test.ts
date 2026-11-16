import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { locationWithFlag } from "../lib/location-flag.js";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("minimal owner interface", () => {
  test("puts one durable Claude refresh action beside Ask the Book", () => {
    const today = source("app/(portal)/dashboard/page.tsx");
    const actions = source("app/(portal)/dashboard/actions.ts");
    assert.doesNotMatch(today, /DataLoadNotice|recovery="claude"/);
    assert.match(today, /Ask the Book/);
    assert.match(today, /form action=\{requestClaudeRefresh\}/);
    assert.match(today, />\s*Refresh\s*</);
    assert.match(actions, /reconcileProfileEnrichmentGaps/);
    assert.match(actions, /claude\.refresh_requested/);
  });

  test("keeps optional controls behind explicit disclosures", () => {
    const contacts = source("app/(portal)/contacts/book-live-search.tsx");
    const ask = source("app/(portal)/ask/page.tsx");
    assert.match(contacts, /<summary>Filters<\/summary>/);
    assert.match(ask, /<summary>Options<\/summary>/);
    assert.match(ask, /id="ask-history"/);
  });

  test("shows flags only when a country is explicitly present", () => {
    assert.deepEqual(locationWithFlag(["Mexico City", "Mexico"]), {
      flag: "🇲🇽",
      label: "Mexico City · Mexico",
    });
    assert.deepEqual(locationWithFlag(["London", "United Kingdom"]), {
      flag: "🇬🇧",
      label: "London · United Kingdom",
    });
    assert.deepEqual(locationWithFlag(["Remote"]), { flag: null, label: "Remote" });
    assert.equal(locationWithFlag(null), null);
  });

  test("puts Networking depth in an accessible on-demand dialog", () => {
    const page = source("app/(portal)/networking/page.tsx");
    const dialog = source("app/(portal)/networking/networking-basis-dialog.tsx");
    assert.match(page, /<NetworkingBasisDialog/);
    assert.match(dialog, /showModal\(\)/);
    assert.match(dialog, /<dialog/);
    assert.match(dialog, /aria-label={`Why/);
  });

  test("allows a manual promise without weakening owner review proposals", () => {
    const page = source("app/(portal)/promises/page.tsx");
    const actions = source("app/(portal)/promises/actions.ts");
    assert.match(page, /<summary className="button hot">Create manually<\/summary>/);
    assert.match(page, /action={createManualPromise}/);
    assert.match(actions, /source: "manual"/);
    assert.match(actions, /review_status: "accepted"/);
    assert.match(actions, /\.eq\("tenant_id", context\.tenantId\)/);
  });

  test("queues new-person research once and registers known public profiles", () => {
    const actions = source("app/(portal)/changes/actions.ts");
    const intake = source("app/(portal)/contacts/new/actions.ts");
    const scans = source("lib/automation/content-scans.ts");
    for (const text of [actions, intake]) {
      assert.match(text, /enqueueInitialContactEnrichment/);
      assert.match(text, /public_profile_discovery/);
      assert.match(text, /syncContactContentScanSources/);
    }
    assert.match(actions, /newContactCreated: true/);
    assert.match(scans, /export async function syncContactContentScanSources/);
    assert.match(scans, /onConflict: "tenant_id,platform,source_url"/);
    assert.match(scans, /ignoreDuplicates: true/);
  });

  test("uses the approved text-only shell and keeps account controls optional", () => {
    const nav = source("app/(portal)/portal-nav.tsx");
    const layout = source("app/(portal)/layout.tsx");
    const design = source("DESIGN.md");

    assert.doesNotMatch(nav, /LedgerIcon|nav-chapter|ledger-icon/);
    assert.doesNotMatch(layout, /wordmark-seal|Private relationship system/);
    assert.match(layout, /<summary>Account<\/summary>/);
    assert.match(design, /Navigation is label-only|text-only navigation/i);
    assert.match(design, /no chapter number, glyph, terminal, or decorative badge/i);
  });

  test("keeps list pages concise and moves depth behind review or details", () => {
    const today = source("app/(portal)/dashboard/page.tsx");
    const changes = source("app/(portal)/changes/page.tsx");
    const profile = source("app/(portal)/contacts/[id]/page.tsx");

    assert.doesNotMatch(today, /buildTodayAttention|additionalAttention|View Changes/);
    assert.match(today, /row\.items\.slice\(0, 3\)/);
    assert.match(today, /<summary>Recent activity<\/summary>/);
    assert.match(changes, /className="changes-view-tabs"/);
    assert.doesNotMatch(changes, /className="change-comparison-list"/);
    assert.match(profile, /\{ key: "details", label: "Details" \}/);
    assert.doesNotMatch(profile, /\{ key: "edit", label: "Edit" \}/);
  });
});
