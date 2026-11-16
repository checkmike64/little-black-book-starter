import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const detailPage = readFileSync("app/(portal)/changes/[id]/page.tsx", "utf8");
const listPage = readFileSync("app/(portal)/changes/page.tsx", "utf8");
const actions = readFileSync("app/(portal)/changes/actions.ts", "utf8");
const route = readFileSync("app/api/claude/pending-changes/route.ts", "utf8");
const data = readFileSync("lib/changes/data.ts", "utf8");
const css = readFileSync("app/globals.css", "utf8");

describe("new-person identity resolution", () => {
  test("leads exact matches through the existing-person update path", () => {
    assert.match(detailPage, /We think this person is already in your Book/);
    assert.match(detailPage, /Update \{recommendedDuplicate\.contact\.full_name\}/);
    assert.match(detailPage, /name="target_contact_id"[\s\S]*recommendedDuplicate\.contact\.id/);
    assert.match(detailPage, /This is a different person/);
    assert.match(detailPage, /name="identity_resolution"[\s\S]*value="create_separate"/);
    assert.doesNotMatch(detailPage, /Merge with selected person/);
  });

  test("compares proposal values against the matched profile and routes the list row as an update", () => {
    assert.match(detailPage, /comparisonContact = recommendedDuplicate\?\.contact \?\? currentContact/);
    assert.match(detailPage, /focused-field-status">Already stored/);
    assert.match(data, /resolved_existing_contact_id/);
    assert.match(listPage, /row\.resolved_existing_contact_id[\s\S]*return "profile"/);
    assert.match(listPage, /Existing person found/);
  });

  test("blocks accidental duplicate creation on the server", () => {
    assert.match(actions, /recommendedExistingContact\(/);
    assert.match(actions, /identity_resolution[\s\S]*create_separate/);
    assert.match(actions, /appears to be the same person/);
    assert.ok(
      actions.indexOf("recommendedExistingContact(")
        < actions.indexOf("await approveNewContactOnce({"),
    );
  });

  test("routes future strong-identity proposals into profile updates", () => {
    assert.match(route, /hasStrongIdentityIdentifier\(recommendedDuplicate\)/);
    assert.match(route, /changeType = "contact_enrichment"/);
    assert.match(route, /contactId = recommendedDuplicate\.contact\.id/);
    assert.match(route, /field !== "full_name"/);
    assert.match(route, /status: "matched_existing_contact"/);
  });

  test("uses a dedicated responsive layout without the overlapping generic mini-list", () => {
    assert.match(detailPage, /identity-resolution-card/);
    assert.match(detailPage, /identity-match-option/);
    assert.match(css, /\.identity-resolution-card[\s\S]*gap: 18px/);
    assert.match(css, /\.identity-match-option[\s\S]*min-height: 44px/);
    assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.identity-resolution-primary/);
  });
});
