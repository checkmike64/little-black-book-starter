import {
  clientInstallModulePlan,
  clientInstallPlan,
} from "@/lib/client-install-plan";
import { featureModules } from "@/lib/modules";
import { formatProspectingBucketLines } from "@/lib/prospecting-buckets";
import type { TenantSettings } from "@/lib/tenant-settings";

function filled(value: string, fallback: string) {
  return value.trim() || fallback;
}

export function buildInstallBrief({
  tenantName,
  settings,
}: {
  tenantName: string;
  settings: TenantSettings;
}) {
  const launchPlan = clientInstallPlan(settings)
    .map(
      (step) =>
        `${step.phase}: ${step.label} (${step.status}; ${
          step.ownerVisible ? "owner visible" : "operator only"
        }) - ${step.detail}`,
    )
    .join("\n");
  const modulePlan = clientInstallModulePlan(settings)
    .map(
      (module) =>
        `${module.label}: ${module.enabled ? "enabled" : "hidden"} - ${
          module.operatingUse
        }`,
    )
    .join("\n");
  const enabledModules = featureModules
    .filter((module) => settings.modules[module.key])
    .map((module) => module.label)
    .join(", ");
  const disabledModules = featureModules
    .filter((module) => !settings.modules[module.key])
    .map((module) => module.label)
    .join(", ");
  const prospectingBuckets = formatProspectingBucketLines(
    settings.prospecting.buckets,
  );

  return [
    `Little Black Book install brief for ${tenantName}`,
    "",
    "Operating thesis:",
    filled(settings.onboarding.network_thesis, "Not captured yet."),
    "",
    "Referral lanes:",
    filled(settings.onboarding.referral_lanes, "Not captured yet."),
    "",
    "Prospecting focus:",
    filled(settings.onboarding.prospecting_focus, "Not captured yet."),
    "",
    "Prospecting bucket blueprint:",
    filled(
      prospectingBuckets,
      "Use default buckets until client-specific buckets are captured.",
    ),
    "",
    "Outreach focus:",
    filled(settings.onboarding.outreach_focus, "Not captured yet."),
    "",
    "Relationship rules:",
    filled(settings.onboarding.relationship_rules, "Not captured yet."),
    "",
    "Voice and assistant behavior:",
    `Owner voice: ${filled(settings.voice_profile.owner_voice, "Not captured yet.")}`,
    `Assistant style: ${filled(settings.voice_profile.assistant_style, "Not captured yet.")}`,
    `Default outreach tone: ${filled(settings.voice_profile.default_outreach_tone, "Not captured yet.")}`,
    "",
    "Enabled modules:",
    enabledModules || "None enabled.",
    "",
    "Hidden modules:",
    disabledModules || "None hidden.",
    "",
    "Module operating plan:",
    modulePlan,
    "",
    "Delivery posture:",
    "Setup model: operator-led concierge deployment.",
    "Client setup visibility: hidden from the executive owner.",
    "Owner review surface: pending changes only.",
    "",
    "Client launch plan:",
    launchPlan,
    "",
    "Write posture:",
    `Mechanical writes: ${settings.write_rules.mechanical_writes ? "allowed" : "disabled"}.`,
    "Judgment fields: proposal only.",
    `Transcript storage: ${
      settings.write_rules.transcript_storage === "detailed_notes"
        ? "detailed notes only"
        : "full intake transcript first, then detailed notes"
    }.`,
    "",
    "Quotas:",
    `Monthly enrichments: ${settings.quotas.enrichment_monthly}`,
    `Monthly pulse posts: ${settings.quotas.pulse_posts_monthly}`,
    `Daily Claude writes: ${settings.quotas.claude_writes_daily}`,
    "",
    "Managed provider plans:",
    `Apify: ${settings.providers.apify.enabled ? "enabled" : "disabled"}; $${settings.providers.apify.monthly_cost_limit_usd.toFixed(2)} monthly provider-cost limit; ${settings.providers.apify.markup_percent}% usage markup; $${settings.providers.apify.included_usage_usd.toFixed(2)} included.`,
    `Outscraper: ${settings.providers.outscraper.enabled ? "enabled" : "disabled"}; $${settings.providers.outscraper.monthly_cost_limit_usd.toFixed(2)} monthly provider-cost limit; ${settings.providers.outscraper.markup_percent}% usage markup; $${settings.providers.outscraper.included_usage_usd.toFixed(2)} included.`,
    "Credentials: operator-owned and hidden from the executive owner.",
    "",
    "Launch notes:",
    filled(settings.delivery.launch_notes, "None captured yet."),
    "",
    "Additional intake notes:",
    filled(settings.onboarding.intake_notes, "None captured yet."),
  ].join("\n");
}
