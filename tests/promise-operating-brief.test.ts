import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildPromiseOperatingBrief,
  type PromiseOperatingBriefRow,
} from "../lib/promise-operating-brief.js";

const now = new Date("2026-07-22T12:00:00Z");

function promise(
  overrides: Partial<PromiseOperatingBriefRow> = {},
): PromiseOperatingBriefRow {
  return {
    id: "promise-1",
    contact_id: "contact-1",
    direction: "owner_owes_contact",
    due_on: "2026-07-23",
    promise_text: "Send the investor list",
    status: "open",
    source: "call_transcript",
    contacts: {
      id: "contact-1",
      full_name: "Alicia Stone",
      company_name: "Stone Capital",
    },
    ...overrides,
  };
}

describe("promise operating brief", () => {
  test("prioritizes owner promise debt over waiting-on-others loops", () => {
    const brief = buildPromiseOperatingBrief(
      [
        promise({
          id: "waiting",
          direction: "contact_owes_owner",
          due_on: "2026-07-20",
          promise_text: "Send the fund thesis",
        }),
        promise({
          id: "owner",
          due_on: "2026-07-21",
          promise_text: "Send the founder list",
        }),
      ],
      now,
    );

    assert.equal(brief.pressure, "trust_risk");
    assert.equal(brief.lead?.id, "owner");
    assert.equal(brief.actionHref, "/contacts/contact-1");
    assert.equal(brief.movementHref, "/movement?view=hot");
  });

  test("surfaces waiting-on-others when the owner owes nothing", () => {
    const brief = buildPromiseOperatingBrief(
      [
        promise({
          direction: "contact_owes_owner",
          due_on: "2026-07-24",
          promise_text: "Send intro details",
        }),
      ],
      now,
    );

    assert.equal(brief.pressure, "waiting_on_other");
    assert.match(brief.headline, /Follow up/);
    assert.equal(brief.filterHref, "/promises?filter=contact");
    assert.equal(brief.tone, "gold");
  });

  test("routes clear promise ledgers toward Ask for missed commitments", () => {
    const brief = buildPromiseOperatingBrief(
      [
        promise({
          status: "completed",
        }),
      ],
      now,
    );

    assert.equal(brief.pressure, "clear");
    assert.equal(brief.lead, null);
    assert.equal(brief.actionHref, "/ask?mode=search&q=open%20promises");
    assert.equal(brief.metrics.find((metric) => metric.label === "Closed")?.value, 1);
  });
});
