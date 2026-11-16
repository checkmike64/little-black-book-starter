import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ownerChangeDecisionCount,
  ownerChangedPeopleCount,
  ownerChangeUnitCount,
  profileChangeGroups,
} from "../lib/change-review-groups.js";

describe("profile change review groups", () => {
  const caseyRows = Array.from({ length: 5 }, (_, index) => ({
    id: `casey-${index + 1}`,
    contact_id: "casey",
    change_type: index % 2 === 0 ? "contact_enrichment" : "field_update",
    source: "claude_enrichment_2026-09-30",
  }));

  test("turns multiple proposals for one person into one owner decision", () => {
    const groups = profileChangeGroups(caseyRows);

    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.key, "contact:casey");
    assert.equal(groups[0]?.rows.length, 5);
    assert.equal(ownerChangeDecisionCount(caseyRows), 1);
  });

  test("does not collapse unrelated or recording baseline decisions", () => {
    const rows = [
      ...caseyRows,
      {
        id: "akira-1",
        contact_id: "akira",
        change_type: "contact_enrichment",
        source: "claude_enrichment_2026-09-30",
      },
      {
        id: "recording-baseline-1",
        contact_id: "casey",
        change_type: "field_update",
        source: "recording_baseline",
      },
      {
        id: "new-person-1",
        contact_id: null,
        change_type: "new_contact",
        source: "recording_operator",
      },
    ];

    const groups = profileChangeGroups(rows);

    assert.equal(groups.length, 4);
    assert.deepEqual(groups.map((group) => group.key), [
      "contact:casey",
      "contact:akira",
      "change:recording-baseline-1",
      "change:new-person-1",
    ]);
  });

  test("counts profile fields separately from grouped review decisions", () => {
    const rows = [
      {
        ...caseyRows[0],
        payload: { fields: { company_name: "Studio", linkedin: "https://example.com" } },
      },
      {
        ...caseyRows[1],
        payload: { fields: { ideal_referral: "Founders" } },
      },
    ];

    assert.equal(ownerChangeDecisionCount(rows), 1);
    assert.equal(ownerChangeUnitCount(rows), 3);
  });

  test("keeps one count for visible non-profile decisions", () => {
    const rows = [
      {
        id: "new-person-1",
        contact_id: null,
        change_type: "new_contact",
        source: "recording_operator",
        payload: { contact: { full_name: "New person", company_name: "Example" } },
      },
      {
        id: "recording-action-1",
        contact_id: "casey",
        change_type: "recording_action",
        source: "recording_operator",
        payload: { action: "Follow up" },
      },
    ];

    assert.equal(ownerChangeUnitCount(rows), 2);
  });

  test("counts people once across every pending change type", () => {
    const rows = [
      ...caseyRows,
      {
        id: "casey-follow-up",
        contact_id: "casey",
        change_type: "recording_action",
        source: "recording_operator",
      },
      {
        id: "akira-1",
        contact_id: "akira",
        change_type: "contact_enrichment",
        source: "claude_enrichment_2026-09-30",
      },
      {
        id: "new-person-1",
        contact_id: null,
        change_type: "new_contact",
        source: "recording_operator",
      },
    ];

    assert.equal(ownerChangedPeopleCount(rows), 3);
  });
});
