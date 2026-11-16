import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildIntakeRevisionHistory,
  changedIntakeSections,
  type IntakeRevisionAuditRow,
} from "../lib/intake-revisions.js";

function row(overrides: Partial<IntakeRevisionAuditRow> = {}): IntakeRevisionAuditRow {
  return {
    id: "revision-1",
    actor_type: "client",
    actor_user_id: "00000000-0000-4000-8000-000000000000",
    action: "tenant.intake.updated",
    before: {
      settings: {
        onboarding: {
          network_thesis: "",
          referral_lanes: "Founders",
        },
        prospecting: {
          buckets: [],
        },
        voice_profile: {
          owner_voice: "",
        },
      },
    },
    after: {
      settings: {
        onboarding: {
          network_thesis: "Private market relationship thesis.",
          referral_lanes: "Founders",
        },
        prospecting: {
          buckets: [{ name: "Podcast hosts", lane: "outreach" }],
        },
        voice_profile: {
          owner_voice: "Direct and concise.",
        },
      },
    },
    created_at: "2026-07-20T12:00:00.000Z",
    ...overrides,
  };
}

describe("intake revisions", () => {
  test("detects changed setup sections from tenant audit settings snapshots", () => {
    assert.deepEqual(changedIntakeSections(row()), [
      "Network thesis",
      "Prospecting buckets",
      "Owner voice",
    ]);
  });

  test("builds operator-readable revision summaries", () => {
    const revisions = buildIntakeRevisionHistory([
      row({
        action: "tenant.settings.updated",
      }),
    ]);

    assert.equal(revisions.length, 1);
    assert.equal(revisions[0]?.actionLabel, "Install settings saved");
    assert.equal(revisions[0]?.actorLabel, "operator");
    assert.match(revisions[0]?.summary ?? "", /Network thesis/);
  });

  test("reports saved revisions without tracked differences", () => {
    const revision = buildIntakeRevisionHistory([
      row({
        before: {
          settings: {
            onboarding: {
              network_thesis: "Same",
            },
          },
        },
        after: {
          settings: {
            onboarding: {
              network_thesis: "Same",
            },
          },
        },
      }),
    ])[0];

    assert.equal(revision?.changedSections.length, 0);
    assert.match(revision?.summary ?? "", /without tracked section changes/);
  });
});
