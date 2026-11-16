import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

describe("contact profile research", () => {
  test("shows all supported public profile links and a bounded search action", () => {
    const page = readFileSync("app/(portal)/contacts/[id]/page.tsx", "utf8");
    const data = readFileSync("lib/contact-detail/data.ts", "utf8");

    for (const field of ["linkedin", "instagram", "facebook", "x_twitter", "youtube"]) {
      assert.match(page, new RegExp(`contact\\.${field}`));
      assert.match(data, new RegExp(field));
    }
    assert.match(page, /Search for profiles/);
    assert.match(page, /activeEnrichmentJob/);
    assert.match(page, /latestEnrichmentJob/);
    assert.match(page, /requestContactEnrichment/);
    assert.match(page, /research_request_id/);
    assert.match(page, /missingResearchFields\.join/);
    assert.doesNotMatch(page, /Enrich this profile/);
  });

  test("keeps profile research behind operator access", () => {
    const page = readFileSync("app/(portal)/contacts/[id]/page.tsx", "utf8");
    const actions = readFileSync("app/(portal)/contacts/[id]/actions.ts", "utf8");
    const researchAction = actions.match(
      /export async function requestContactEnrichment[\s\S]*?\n}\n\nexport async function updateContactPosture/,
    )?.[0] ?? "";

    assert.match(page, /adminMode \? \(/);
    assert.match(researchAction, /await requireOperatorAccess\(\)/);
    assert.match(researchAction, /enqueueProfileResearch/);
    assert.doesNotMatch(researchAction, /\.from\("jobs"\)\.insert/);
  });

  test("does not reserve an empty icon column in the contact link layout", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const reachRule = css.match(/\.reach-link \{([\s\S]*?)\n\}/)?.[1] ?? "";

    assert.match(reachRule, /display: flex/);
    assert.doesNotMatch(reachRule, /grid-template-columns/);

    const ledgerCss = readFileSync("app/private-ledger.css", "utf8");
    const headerRule = ledgerCss.match(/\.person-header \{([\s\S]*?)\n\}/)?.[1] ?? "";
    assert.match(headerRule, /background: transparent/);
    assert.doesNotMatch(headerRule, /var\(--black\)/);
  });
});
