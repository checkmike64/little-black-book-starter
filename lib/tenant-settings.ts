import { featureModules, type ModuleKey } from "@/lib/modules";
import {
  normalizeProspectingBuckets,
  type ProspectingBucketConfig,
} from "@/lib/prospecting-buckets";
import {
  defaultActivitySettings,
  normalizeActivitySettings,
  type ActivitySettings,
} from "@/lib/activity-settings";
import {
  defaultContentScanSettings,
  normalizeContentScanSettings,
  type ContentScanSettings,
} from "@/lib/automation/content-scan-settings";
import {
  defaultEnrichmentAutomationSettings,
  normalizeEnrichmentAutomationSettings,
  type EnrichmentAutomationSettings,
} from "@/lib/automation/enrichment-settings";
import {
  defaultProviderPlans,
  normalizeProviderPlans,
  type ProviderPlans,
} from "@/lib/provider-plans";
import {
  normalizeProductionEvidenceRef,
  type ProductionCheckRecord,
} from "@/lib/production-check-evidence";

import { defaultKeepInTouchSettings, normalizeKeepInTouchSettings, type KeepInTouchSettings } from "@/lib/keep-in-touch";

export type TenantSettings = {
  keep_in_touch: KeepInTouchSettings;
  modules: Record<ModuleKey, boolean>;
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
    buckets: ProspectingBucketConfig[];
  };
  activity: ActivitySettings;
  automation: {
    llm_ranking_enabled: boolean;
    content_scans: ContentScanSettings;
    enrichment: EnrichmentAutomationSettings;
  };
  providers: ProviderPlans;
  delivery: {
    setup_model: "operator_led";
    client_setup_visibility: "hidden";
    owner_review_surface: "changes_only";
    launch_notes: string;
    production_checks: Record<string, ProductionCheckRecord>;
  };
  voice_profile: {
    owner_voice: string;
    assistant_style: string;
    default_outreach_tone: string;
  };
  /**
   * Internal install controls. These remain optional at the type boundary so
   * older manifests can be normalized safely, but normalization always emits
   * concrete values.
   */
  retention?: {
    raw_transcript_days: number;
  };
  prompt_versions?: Record<string, string>;
};

const defaultModules = Object.fromEntries(
  featureModules.map((module) => [module.key, module.defaultEnabled]),
) as Record<ModuleKey, boolean>;

export const defaultTenantSettings: TenantSettings = {
  keep_in_touch: defaultKeepInTouchSettings,
  modules: defaultModules,
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
    network_thesis: "",
    referral_lanes: "",
    prospecting_focus: "",
    outreach_focus: "",
    relationship_rules: "",
    intake_notes: "",
  },
  prospecting: {
    buckets: [],
  },
  activity: defaultActivitySettings,
  automation: {
    llm_ranking_enabled: false,
    content_scans: defaultContentScanSettings,
    enrichment: defaultEnrichmentAutomationSettings,
  },
  providers: defaultProviderPlans,
  delivery: {
    setup_model: "operator_led",
    client_setup_visibility: "hidden",
    owner_review_surface: "changes_only",
    launch_notes: "",
    production_checks: {},
  },
  voice_profile: {
    owner_voice: "",
    assistant_style: "",
    default_outreach_tone: "",
  },
  retention: {
    raw_transcript_days: 30,
  },
  prompt_versions: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeTenantSettings(settings: unknown): TenantSettings {
  const root = isRecord(settings) ? settings : {};
  const modules = isRecord(root.modules) ? root.modules : {};
  const quotas = isRecord(root.quotas) ? root.quotas : {};
  const writeRules = isRecord(root.write_rules) ? root.write_rules : {};
  const onboarding = isRecord(root.onboarding) ? root.onboarding : {};
  const prospecting = isRecord(root.prospecting) ? root.prospecting : {};
  const activity = isRecord(root.activity) ? root.activity : {};
  const automation = isRecord(root.automation) ? root.automation : {};
  const providers = isRecord(root.providers) ? root.providers : {};
  const delivery = isRecord(root.delivery) ? root.delivery : {};
  const voiceProfile = isRecord(root.voice_profile) ? root.voice_profile : {};
  const retention = isRecord(root.retention) ? root.retention : {};
  const promptVersions = isRecord(root.prompt_versions) ? root.prompt_versions : {};

  return {
    keep_in_touch: normalizeKeepInTouchSettings(root.keep_in_touch),
    modules: Object.fromEntries(
      featureModules.map((module) => [
        module.key,
        booleanValue(modules[module.key], module.defaultEnabled),
      ]),
    ) as Record<ModuleKey, boolean>,
    quotas: {
      enrichment_monthly: numberValue(
        quotas.enrichment_monthly,
        defaultTenantSettings.quotas.enrichment_monthly,
      ),
      pulse_posts_monthly: numberValue(
        quotas.pulse_posts_monthly,
        defaultTenantSettings.quotas.pulse_posts_monthly,
      ),
      claude_writes_daily: numberValue(
        quotas.claude_writes_daily,
        defaultTenantSettings.quotas.claude_writes_daily,
      ),
    },
    write_rules: {
      mechanical_writes: booleanValue(
        writeRules.mechanical_writes,
        defaultTenantSettings.write_rules.mechanical_writes,
      ),
      judgment_fields: "proposal_only",
      transcript_storage:
        writeRules.transcript_storage === "detailed_notes"
          ? "detailed_notes"
          : "intake_full_then_notes",
    },
    onboarding: {
      network_thesis: stringValue(onboarding.network_thesis),
      referral_lanes: stringValue(onboarding.referral_lanes),
      prospecting_focus: stringValue(onboarding.prospecting_focus),
      outreach_focus: stringValue(onboarding.outreach_focus),
      relationship_rules: stringValue(onboarding.relationship_rules),
      intake_notes: stringValue(onboarding.intake_notes),
    },
    prospecting: {
      buckets: normalizeProspectingBuckets(prospecting.buckets),
    },
    activity: normalizeActivitySettings(activity),
    automation: {
      llm_ranking_enabled: booleanValue(
        automation.llm_ranking_enabled,
        defaultTenantSettings.automation.llm_ranking_enabled,
      ),
      content_scans: normalizeContentScanSettings(automation.content_scans),
      enrichment: normalizeEnrichmentAutomationSettings(automation.enrichment),
    },
    providers: normalizeProviderPlans(providers),
    delivery: {
      setup_model: "operator_led",
      client_setup_visibility: "hidden",
      owner_review_surface: "changes_only",
      launch_notes: stringValue(delivery.launch_notes),
      production_checks: productionChecksValue(delivery.production_checks),
    },
    voice_profile: {
      owner_voice: stringValue(voiceProfile.owner_voice),
      assistant_style: stringValue(voiceProfile.assistant_style),
      default_outreach_tone: stringValue(voiceProfile.default_outreach_tone),
    },
    retention: {
      raw_transcript_days: Math.max(
        0,
        Math.round(
          numberValue(
            retention.raw_transcript_days,
            defaultTenantSettings.retention?.raw_transcript_days ?? 30,
          ),
        ),
      ),
    },
    prompt_versions: Object.fromEntries(
      Object.entries(promptVersions).flatMap(([key, value]) => {
        const cleanKey = key.trim().slice(0, 100);
        const cleanValue = stringValue(value).slice(0, 160);
        return cleanKey && cleanValue ? [[cleanKey, cleanValue]] : [];
      }),
    ),
  };
}

function productionChecksValue(value: unknown): TenantSettings["delivery"]["production_checks"] {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, raw]) => {
        if (!isRecord(raw)) return null;
        return [
          key,
          {
            confirmed: booleanValue(raw.confirmed, false),
            confirmed_at: stringValue(raw.confirmed_at) || null,
            confirmed_by: stringValue(raw.confirmed_by) || null,
            evidence_ref: normalizeProductionEvidenceRef(raw.evidence_ref),
          },
        ] as const;
      })
      .filter((item): item is readonly [
        string,
        {
          confirmed: boolean;
          confirmed_at: string | null;
          confirmed_by: string | null;
          evidence_ref: string | null;
        },
      ] => Boolean(item)),
  );
}

export function intakeCompletion(settings: TenantSettings) {
  const checks = [
    settings.onboarding.network_thesis,
    settings.onboarding.referral_lanes,
    settings.onboarding.relationship_rules,
    settings.voice_profile.owner_voice,
    settings.voice_profile.assistant_style,
  ];
  const complete = checks.filter((value) => value.trim().length > 0).length;

  return {
    complete,
    total: checks.length,
    percent: Math.round((complete / checks.length) * 100),
  };
}
