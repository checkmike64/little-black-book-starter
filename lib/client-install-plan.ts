import { featureModules, type ModuleKey } from "@/lib/modules";
import { prospectingBucketExamples } from "@/lib/prospecting-buckets";
import type { TenantSettings } from "@/lib/tenant-settings";

export type ClientInstallStep = {
  phase: string;
  label: string;
  detail: string;
  status: "ready" | "needs_input" | "blocked";
  ownerVisible: boolean;
};

export type ClientInstallModulePlan = {
  key: ModuleKey;
  label: string;
  enabled: boolean;
  operatingUse: string;
  ownerVisible: boolean;
};

function filled(value: string) {
  return value.trim().length > 0;
}

function statusFrom(...values: string[]): ClientInstallStep["status"] {
  return values.every(filled) ? "ready" : "needs_input";
}

function moduleUse(key: ModuleKey, settings: TenantSettings) {
  if (key === "ask") {
    return "Query the Book across people, asks, promises, activity, and Claude evidence.";
  }

  if (key === "networking") {
    return filled(settings.onboarding.referral_lanes)
      ? `Drive warm paths around: ${settings.onboarding.referral_lanes.slice(0, 180)}`
      : "Drive introductions, referral safety, promises, and relationship movement.";
  }

  if (key === "engagement") {
    return filled(settings.onboarding.outreach_focus)
      ? `Support outreach around: ${settings.onboarding.outreach_focus.slice(0, 180)}`
      : "Support outreach rhythm, reactivation, follow-up, and public-facing opportunities.";
  }

  if (key === "want_to_know") {
    const bucketExamples = prospectingBucketExamples(settings);
    if (settings.prospecting.buckets.length > 0) {
      return `Track outer-ring targets by configured buckets: ${bucketExamples.slice(0, 180)}`;
    }

    return filled(settings.onboarding.prospecting_focus)
      ? `Track targets around: ${settings.onboarding.prospecting_focus.slice(0, 180)}`
      : "Track people the owner wants to meet, understand, or route into prospecting.";
  }

  return "Show owner-facing momentum, promises, follow-up posture, and relationship health.";
}

export function clientInstallModulePlan(settings: TenantSettings): ClientInstallModulePlan[] {
  return featureModules.map((module) => ({
    key: module.key,
    label: module.label,
    enabled: settings.modules[module.key],
    operatingUse: moduleUse(module.key, settings),
    ownerVisible: settings.modules[module.key],
  }));
}

export function clientInstallPlan(settings: TenantSettings): ClientInstallStep[] {
  return [
    {
      phase: "1 · Interview",
      label: "Capture operating thesis",
      detail:
        "Store the client-specific thesis, referral lanes, relationship rules, owner voice, and assistant style before importing large amounts of data.",
      status: statusFrom(
        settings.onboarding.network_thesis,
        settings.onboarding.referral_lanes,
        settings.onboarding.relationship_rules,
        settings.voice_profile.owner_voice,
        settings.voice_profile.assistant_style,
      ),
      ownerVisible: false,
    },
    {
      phase: "2 · Data",
      label: "Convert source material into Supabase",
      detail:
        "Import contacts and correspondence summaries through Claude or controlled scripts. Newly scanned content should land in Supabase as structured relational fields.",
      status: "ready",
      ownerVisible: false,
    },
    {
      phase: "3 · Enrichment",
      label: "Queue verification-first enrichment",
      detail:
        "Use Claude jobs for enrichment proposals, then route judgment-heavy findings into pending changes for owner approval.",
      status: settings.quotas.enrichment_monthly > 0 ? "ready" : "needs_input",
      ownerVisible: false,
    },
    {
      phase: "4 · Module fit",
      label: "Enable only the workflows sold into this install",
      detail:
        "The executive sees the finished Book and enabled modules only. Intake, deployment, Ops, setup, and raw configuration stay operator-only.",
      status: clientInstallModulePlan(settings).some((module) => module.enabled)
        ? "ready"
        : "blocked",
      ownerVisible: false,
    },
    {
      phase: "5 · Claude",
      label: "Install the client-specific Claude instructions",
      detail:
        "Give Claude the install brief, write posture, module plan, and verification rules. Claude should use app endpoints, never browser secrets.",
      status: statusFrom(settings.voice_profile.assistant_style),
      ownerVisible: false,
    },
    {
      phase: "6 · Handoff",
      label: "Launch the owner-facing relationship system",
      detail:
        "Smoke test login, Ask, contact profiles, pending changes, enabled modules, and export before giving the executive the production URL.",
      status: filled(settings.delivery.launch_notes) ? "ready" : "needs_input",
      ownerVisible: true,
    },
  ];
}

export function clientInstallReadiness(settings: TenantSettings) {
  const plan = clientInstallPlan(settings);
  const ready = plan.filter((step) => step.status === "ready").length;
  const blocked = plan.filter((step) => step.status === "blocked").length;
  const needsInput = plan.filter((step) => step.status === "needs_input").length;

  return {
    ready,
    blocked,
    needsInput,
    total: plan.length,
    percent: Math.round((ready / plan.length) * 100),
  };
}
