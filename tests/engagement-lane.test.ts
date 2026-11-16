import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  recentContactPreventsRescue,
  resolveEngagementLane,
} from "../lib/engagement/lane.js";

const now = new Date("2026-07-29T12:00:00Z");

describe("engagement lanes", () => {
  it("does not rescue a monthly referral partner spoken with four days ago", () => {
    const contact = {
      last_spoke: "2026-07-25",
      relationship_strength: "Cooling",
      relationship_type: ["Referral Partner"],
      touch_cadence: "Monthly",
      trust_level: "Tier 1 - Deep Trust",
    };

    assert.equal(recentContactPreventsRescue({ contact, now }), true);
    assert.equal(
      resolveEngagementLane({
        requestedLane: "rescue",
        classification: "RELATIONSHIP_RESCUE",
        contact,
        now,
      }),
      "partners",
    );
  });

  it("moves a recent non-partner rescue request into active pursuits", () => {
    assert.equal(
      resolveEngagementLane({
        requestedLane: "rescue",
        contact: {
          last_spoke: "2026-07-25",
          relationship_type: ["Peer"],
          touch_cadence: "Monthly",
        },
        now,
      }),
      "active",
    );
  });

  it("keeps rescue for a monthly relationship that is genuinely overdue", () => {
    assert.equal(
      resolveEngagementLane({
        requestedLane: "rescue",
        contact: {
          last_spoke: "2026-05-01",
          relationship_type: ["Referral Partner"],
          touch_cadence: "Monthly",
        },
        now,
      }),
      "rescue",
    );
  });

  it("does not infer rescue from a stale strength label after recent contact", () => {
    assert.equal(
      resolveEngagementLane({
        contact: {
          last_spoke: "2026-07-25",
          relationship_strength: "Cooling",
          relationship_type: ["Peer"],
          touch_cadence: "Monthly",
          trust_level: "Tier 1 - Deep Trust",
        },
        now,
      }),
      "active",
    );
  });

  it("does not manufacture rescue work for dormant relationships", () => {
    assert.equal(
      recentContactPreventsRescue({
        contact: {
          last_spoke: "2020-01-01",
          touch_cadence: "Dormant",
        },
        now,
      }),
      true,
    );
  });
});
