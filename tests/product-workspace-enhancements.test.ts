import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("product workspace enhancements", () => {
  test("keeps profile action and correction paths while removing the scorecard", () => {
    const profile = source("app/(portal)/contacts/[id]/page.tsx");
    assert.doesNotMatch(profile, /scoreContactQuality\(contact\)/);
    assert.doesNotMatch(profile, /person-profile-status/);
    assert.match(profile, /Correct details/);
    assert.match(profile, /Open loops/);
  });

  test("groups Changes by the decision the owner is making", () => {
    const changes = source("app/(portal)/changes/page.tsx");
    assert.match(changes, /New people/);
    assert.match(changes, /Meeting follow-up/);
    assert.match(changes, /Profile updates/);
    assert.match(changes, /changeLane/);
  });

  test("turns existing networking controls into explicit feedback", () => {
    const networking = source("app/(portal)/networking/page.tsx");
    assert.match(networking, /Not useful now/);
    assert.match(networking, /Do not suggest again/);
    assert.match(networking, /snoozeConnectionRecommendation/);
    assert.match(networking, /blockConnectionRecommendation/);
  });

  test("connects client intake to the prepared review workspace", () => {
    const intake = source("app/(portal)/intake/page.tsx");
    assert.match(intake, /href="\/admin\/preinstall"/);
    assert.match(intake, /Review prepared work/);
  });

  test("keeps the new owner work lists usable on narrow screens", () => {
    const css = source("app/globals.css");
    assert.match(css, /\.minimal-list-row \{ align-items: start; grid-template-columns: 1fr;/);
    assert.match(css, /\.minimal-page-header \{ align-items: flex-start; flex-direction: column;/);
    assert.match(css, /\.basis-info-button, \.basis-dialog-close \{ height: 44px; width: 44px; \}/);
  });
});
