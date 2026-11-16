import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildClientInstallManifest,
  formatClientInstallManifest,
  type ManifestTenantSettings,
} from "../lib/client-install-manifest.js";

type SettingsOverrides = Partial<
  Omit<
    ManifestTenantSettings,
    | "delivery"
    | "modules"
    | "onboarding"
    | "quotas"
    | "voice_profile"
    | "write_rules"
  >
> & {
  delivery?: Partial<ManifestTenantSettings["delivery"]>;
  modules?: Partial<ManifestTenantSettings["modules"]>;
  onboarding?: Partial<ManifestTenantSettings["onboarding"]>;
  quotas?: Partial<ManifestTenantSettings["quotas"]>;
  voice_profile?: Partial<ManifestTenantSettings["voice_profile"]>;
  write_rules?: Partial<ManifestTenantSettings["write_rules"]>;
};

function settings(
  overrides: SettingsOverrides = {},
): ManifestTenantSettings {
  const base: ManifestTenantSettings = {
    modules: {
      ask: true,
      networking: true,
      engagement: false,
      want_to_know: true,
    },
    quotas: {
      enrichment_monthly: 25,
      pulse_posts_monthly: 60,
      claude_writes_daily: 100,
    },
    write_rules: {
      mechanical_writes: true,
      judgment_fields: "proposal_only",
      transcript_storage: "intake_full_then_notes",
    },
    onboarding: {
      network_thesis: "Build useful executive relationship memory.",
      referral_lanes: "M&A operators and investor referrals.",
      prospecting_focus: "Strategic acquirers.",
      outreach_focus: "Podcast and guest post opportunities.",
      relationship_rules: "Do not overstate trust.",
      intake_notes: "",
    },
    prospecting: {
      buckets: [
        {
          name: "Podcast hosts",
          goal: "Find useful guest angles.",
          look_for: "Audience overlap.",
          intensity: "Medium",
          lane: "podcast",
        },
      ],
    },
    delivery: {
      setup_model: "operator_led",
      client_setup_visibility: "hidden",
      owner_review_surface: "changes_only",
      launch_notes: "Owner sees the finished Book first.",
    },
    voice_profile: {
      owner_voice: "Direct and warm.",
      assistant_style: "Concise operator.",
      default_outreach_tone: "Useful and light.",
    },
  };

  return {
    ...base,
    ...overrides,
    modules: {
      ...base.modules,
      ...overrides.modules,
    },
    quotas: {
      ...base.quotas,
      ...overrides.quotas,
    },
    write_rules: {
      ...base.write_rules,
      ...overrides.write_rules,
    },
    onboarding: {
      ...base.onboarding,
      ...overrides.onboarding,
    },
    prospecting: {
      ...base.prospecting,
      ...overrides.prospecting,
    },
    delivery: {
      ...base.delivery,
      ...overrides.delivery,
    },
    voice_profile: {
      ...base.voice_profile,
      ...overrides.voice_profile,
    },
  };
}

describe("client install manifest", () => {
  test("summarizes owner visibility, modules, buckets, and write posture", () => {
    const manifest = buildClientInstallManifest({
      tenantName: "Example Client",
      settings: settings(),
    });

    assert.equal(manifest.tenantName, "Example Client");
    assert.equal(manifest.ownerVisibility, "Setup and intake hidden from owner");
    assert.deepEqual(manifest.hiddenModules, ["Engagement"]);
    assert.equal(manifest.prospectingBuckets[0]?.name, "Podcast hosts");
    assert.equal(manifest.writePosture.judgmentFields, "Proposal only");
    assert.equal(manifest.readyForOwnerUse, true);
  });

  test("flags missing setup items conservatively", () => {
    const manifest = buildClientInstallManifest({
      tenantName: "Thin Client",
      settings: settings({
        modules: {
          ask: false,
          networking: false,
          engagement: false,
          want_to_know: false,
        },
        quotas: {
          enrichment_monthly: 0,
          pulse_posts_monthly: 60,
          claude_writes_daily: 100,
        },
        onboarding: {
          network_thesis: "",
        },
        delivery: {
          launch_notes: "",
        },
      }),
    });

    assert.equal(manifest.readyForOwnerUse, false);
    assert.ok(
      manifest.missingSetup.includes("1 · Interview: Capture operating thesis"),
    );
    assert.ok(
      manifest.missingSetup.includes(
        "4 · Module fit: Enable only the workflows sold into this install",
      ),
    );
  });

  test("formats a copyable manifest", () => {
    const text = formatClientInstallManifest(
      buildClientInstallManifest({
        tenantName: "Example Client",
        settings: settings(),
      }),
    );

    assert.match(text, /Client install manifest: Example Client/);
    assert.match(text, /- Podcast hosts \(podcast, Medium intensity\)/);
    assert.match(text, /Mechanical writes: Allowed for observed facts/);
  });
});
