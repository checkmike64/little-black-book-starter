type ManifestModuleKey =
  | "ask"
  | "networking"
  | "engagement"
  | "want_to_know";

export type ManifestTenantSettings = {
  modules: Record<ManifestModuleKey, boolean>;
  quotas: {
    enrichment_monthly: number;
    pulse_posts_monthly: number;
    claude_writes_daily: number;
  };
  write_rules: {
    mechanical_writes: boolean;
    judgment_fields: "proposal_only";
    transcript_storage: "detailed_notes" | "intake_full_then_notes";
  };
  onboarding: {
    network_thesis: string;
    referral_lanes: string;
    prospecting_focus: string;
    outreach_focus: string;
    relationship_rules: string;
    intake_notes: string;
  };
  prospecting: {
    buckets: Array<{
      name: string;
      goal?: string;
      look_for?: string;
      lane: string;
      intensity: string;
    }>;
  };
  delivery: {
    setup_model: "operator_led";
    client_setup_visibility: "hidden";
    owner_review_surface: "changes_only";
    launch_notes: string;
  };
  voice_profile: {
    owner_voice: string;
    assistant_style: string;
    default_outreach_tone: string;
  };
};

export type ClientInstallManifest = {
  tenantName: string;
  setupModel: "operator_led";
  ownerVisibility: string;
  ownerReviewSurface: string;
  enabledModules: string[];
  hiddenModules: string[];
  prospectingBuckets: Array<{
    name: string;
    lane: string;
    intensity: string;
  }>;
  writePosture: {
    mechanicalWrites: string;
    judgmentFields: string;
    transcriptStorage: string;
  };
  missingSetup: string[];
  readyForOwnerUse: boolean;
};

function transcriptStorageLabel(
  value: ManifestTenantSettings["write_rules"]["transcript_storage"],
) {
  return value === "detailed_notes"
    ? "Detailed notes only"
    : "Full intake transcript first, then detailed notes";
}

const moduleLabels: Record<ManifestModuleKey, string> = {
  ask: "Ask",
  networking: "Networking",
  engagement: "Engagement",
  want_to_know: "Want to Know",
};

function filled(value: string) {
  return value.trim().length > 0;
}

function missingSetupItems(settings: ManifestTenantSettings) {
  return [
    filled(settings.onboarding.network_thesis) &&
    filled(settings.onboarding.referral_lanes) &&
    filled(settings.onboarding.relationship_rules) &&
    filled(settings.voice_profile.owner_voice) &&
    filled(settings.voice_profile.assistant_style)
      ? null
      : "1 · Interview: Capture operating thesis",
    settings.quotas.enrichment_monthly > 0
      ? null
      : "3 · Enrichment: Queue verification-first enrichment",
    Object.values(settings.modules).some(Boolean)
      ? null
      : "4 · Module fit: Enable only the workflows sold into this install",
    filled(settings.voice_profile.assistant_style)
      ? null
      : "5 · Claude: Install the client-specific Claude instructions",
    filled(settings.delivery.launch_notes)
      ? null
      : "6 · Handoff: Launch the owner-facing relationship system",
  ].filter((item): item is string => Boolean(item));
}

export function buildClientInstallManifest({
  settings,
  tenantName,
}: {
  settings: ManifestTenantSettings;
  tenantName: string;
}): ClientInstallManifest {
  const moduleEntries = Object.entries(settings.modules) as Array<
    [ManifestModuleKey, boolean]
  >;
  const missingSetup = missingSetupItems(settings);

  return {
    tenantName,
    setupModel: "operator_led",
    ownerVisibility:
      settings.delivery.client_setup_visibility === "hidden"
        ? "Setup and intake hidden from owner"
        : "Review owner setup visibility",
    ownerReviewSurface:
      settings.delivery.owner_review_surface === "changes_only"
        ? "Pending Changes only"
        : "Review owner review surface",
    enabledModules: moduleEntries
      .filter(([, enabled]) => enabled)
      .map(([key]) => moduleLabels[key]),
    hiddenModules: moduleEntries
      .filter(([, enabled]) => !enabled)
      .map(([key]) => moduleLabels[key]),
    prospectingBuckets: settings.prospecting.buckets.map((bucket) => ({
      name: bucket.name,
      lane: bucket.lane || "client-specific",
      intensity: bucket.intensity,
    })),
    writePosture: {
      mechanicalWrites: settings.write_rules.mechanical_writes
        ? "Allowed for observed facts"
        : "Disabled",
      judgmentFields: "Proposal only",
      transcriptStorage: transcriptStorageLabel(settings.write_rules.transcript_storage),
    },
    missingSetup,
    readyForOwnerUse: missingSetup.length === 0,
  };
}

export function formatClientInstallManifest(manifest: ClientInstallManifest) {
  return [
    `Client install manifest: ${manifest.tenantName}`,
    "",
    `Setup model: ${manifest.setupModel.replaceAll("_", " ")}`,
    `Owner visibility: ${manifest.ownerVisibility}`,
    `Owner review surface: ${manifest.ownerReviewSurface}`,
    "",
    "Enabled modules:",
    manifest.enabledModules.length
      ? manifest.enabledModules.map((module) => `- ${module}`).join("\n")
      : "- None enabled",
    "",
    "Hidden modules:",
    manifest.hiddenModules.length
      ? manifest.hiddenModules.map((module) => `- ${module}`).join("\n")
      : "- None hidden",
    "",
    "Prospecting buckets:",
    manifest.prospectingBuckets.length
      ? manifest.prospectingBuckets
          .map(
            (bucket) =>
              `- ${bucket.name} (${bucket.lane}, ${bucket.intensity} intensity)`,
          )
          .join("\n")
      : "- Default buckets only",
    "",
    "Write posture:",
    `- Mechanical writes: ${manifest.writePosture.mechanicalWrites}`,
    `- Judgment fields: ${manifest.writePosture.judgmentFields}`,
    `- Transcript storage: ${manifest.writePosture.transcriptStorage}`,
    "",
    "Missing setup:",
    manifest.missingSetup.length
      ? manifest.missingSetup.map((item) => `- ${item}`).join("\n")
      : "- None",
  ].join("\n");
}
