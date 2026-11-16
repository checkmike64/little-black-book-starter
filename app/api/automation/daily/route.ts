import { privateJson } from "@/app/api/claude/_shared";
import { refillEngagementRecommendations } from "@/lib/automation/engagement-refill";
import { refillNetworkingRecommendations } from "@/lib/automation/networking-refill";
import { runContentScansForTenant } from "@/lib/automation/content-scans";
import { reconcileApifyUsageForTenant } from "@/lib/automation/provider-usage";
import { enforceTranscriptRetention } from "@/lib/automation/transcript-retention";
import {
  processQueuedRecordingReceipts,
  reconcileRecordingProviderReceipts,
} from "@/lib/integrations/recordings/ingest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { reconcileProfileEnrichmentGaps } from "@/lib/contact-enrichment-jobs";

type EngagementRun = {
  stage: "engagement";
  tenant_id: string;
  ok: boolean;
  error?: string;
  promoted?: number;
  pending?: number;
  needed?: number;
};

type NetworkingRun = {
  stage: "networking";
  tenant_id: string;
  ok: boolean;
  error?: string;
  generated?: number;
  pending?: number;
  candidates?: number;
};

type ContentScanRun = {
  stage: "content_scan";
  tenant_id: string;
  ok: boolean;
  error?: string;
  started?: number;
  failed?: number;
  available?: number;
  status?: string;
};

type ProviderUsageRun = {
  stage: "provider_usage";
  tenant_id: string;
  ok: boolean;
  error?: string;
  reviewed?: number;
  finalized?: number;
  failed?: number;
};

type RelationshipStrengthRun = {
  stage: "relationship_strength";
  tenant_id: string;
  ok: boolean;
  error?: string;
  updated?: number;
};

type TranscriptRetentionRun = {
  stage: "transcript_retention";
  tenant_id: string;
  ok: boolean;
  error?: string;
  purged?: number;
};

type RecordingQueueRun = {
  stage: "recording_queue";
  tenant_id: string;
  ok: boolean;
  error?: string;
  claimed?: number;
  succeeded?: number;
  ignored?: number;
  retrying?: number;
  reconciled?: number;
  reconciliation_failed?: number;
};

type ProfileEnrichmentRun = {
  stage: "profile_enrichment";
  tenant_id: string;
  ok: boolean;
  error?: string;
  created?: number;
  existing?: number;
  failed?: number;
  incomplete?: number;
  considered?: number;
};

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 500) || "Unknown error";
}

function reportStageFailure({
  stage,
  tenantId,
  error,
}: {
  stage: string;
  tenantId: string;
  error: unknown;
}) {
  const message = safeErrorMessage(error);
  console.error("[automation.daily] stage failed", {
    stage,
    tenant_id: tenantId,
    error: message,
  });
  return message;
}

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`,
  );
}

function automationStateError(error: unknown) {
  if (!error || typeof error !== "object") return safeErrorMessage(error);
  const candidate = error as { code?: unknown; message?: unknown };
  return {
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    message:
      typeof candidate.message === "string"
        ? safeErrorMessage(candidate.message)
        : "Unknown database error",
  };
}

async function waitForRetry(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return privateJson({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return privateJson(
      { error: "The private data connection is unavailable." },
      { status: 500 },
    );
  }

  const loadAutomationState = () => admin.from("tenants").select("id, settings");
  let tenants = await loadAutomationState();
  if (tenants.error) {
    console.warn("[automation.daily] initial state load failed; retrying", {
      tenants: automationStateError(tenants.error),
    });
    await waitForRetry(500);
    tenants = await loadAutomationState();
  }
  if (tenants.error) {
    console.error("[automation.daily] state load failed", {
      tenants: automationStateError(tenants.error),
    });
    return privateJson(
      { error: "Automation state could not be loaded." },
      { status: 500 },
    );
  }

  const contentScanResults: ContentScanRun[] = [];
  const providerUsageResults: ProviderUsageRun[] = [];
  const engagementResults: EngagementRun[] = [];
  const networkingResults: NetworkingRun[] = [];
  const relationshipStrengthResults: RelationshipStrengthRun[] = [];
  const transcriptRetentionResults: TranscriptRetentionRun[] = [];
  const recordingQueueResults: RecordingQueueRun[] = [];
  const profileEnrichmentResults: ProfileEnrichmentRun[] = [];
  try {
    const reconciliation = await reconcileRecordingProviderReceipts({ admin });
    const result = await processQueuedRecordingReceipts({ admin, limit: 3 });
    for (const tenant of tenants.data ?? []) {
      const tenantOutcomes = result.outcomes.filter(
        (outcome) => outcome.tenant_id === tenant.id,
      );
      const tenantReconciliation = reconciliation.outcomes.filter(
        (outcome) => outcome.tenant_id === tenant.id,
      );
      recordingQueueResults.push({
        stage: "recording_queue",
        tenant_id: tenant.id,
        ok: true,
        claimed: tenantOutcomes.length,
        succeeded: tenantOutcomes.filter((outcome) => outcome.status === "succeeded").length,
        ignored: tenantOutcomes.filter((outcome) => outcome.status === "ignored").length,
        retrying: tenantOutcomes.filter((outcome) => !outcome.ok).length,
        reconciled: tenantReconciliation.reduce(
          (total, outcome) => total + outcome.enqueued,
          0,
        ),
        reconciliation_failed: tenantReconciliation.filter(
          (outcome) => !outcome.ok,
        ).length,
      });
    }
  } catch (caught) {
    for (const tenant of tenants.data ?? []) {
      recordingQueueResults.push({
        stage: "recording_queue",
        tenant_id: tenant.id,
        ok: false,
        error: reportStageFailure({
          stage: "recording_queue",
          tenantId: tenant.id,
          error: caught,
        }),
      });
    }
  }
  for (const tenant of tenants.data ?? []) {
    try {
      const result = await reconcileProfileEnrichmentGaps({
        admin,
        tenantId: tenant.id,
        limit: 5,
      });
      profileEnrichmentResults.push({
        stage: "profile_enrichment",
        tenant_id: tenant.id,
        ok: result.failed === 0,
        ...result,
      });
    } catch (caught) {
      profileEnrichmentResults.push({
        stage: "profile_enrichment",
        tenant_id: tenant.id,
        ok: false,
        error: reportStageFailure({
          stage: "profile_enrichment",
          tenantId: tenant.id,
          error: caught,
        }),
      });
    }
    try {
      const result = await enforceTranscriptRetention({
        admin,
        tenantId: tenant.id,
      });
      transcriptRetentionResults.push({
        stage: "transcript_retention",
        tenant_id: tenant.id,
        ok: true,
        ...result,
      });
    } catch (caught) {
      transcriptRetentionResults.push({
        stage: "transcript_retention",
        tenant_id: tenant.id,
        ok: false,
        error: reportStageFailure({
          stage: "transcript_retention",
          tenantId: tenant.id,
          error: caught,
        }),
      });
    }
    try {
      const { data, error } = await admin.rpc("lbb_refresh_relationship_strength", {
        p_tenant_id: tenant.id,
      });
      if (error) throw error;
      const result = data as { updated_count?: number } | null;
      relationshipStrengthResults.push({
        stage: "relationship_strength",
        tenant_id: tenant.id,
        ok: true,
        updated: result?.updated_count ?? 0,
      });
    } catch (caught) {
      relationshipStrengthResults.push({
        stage: "relationship_strength",
        tenant_id: tenant.id,
        ok: false,
        error: reportStageFailure({
          stage: "relationship_strength",
          tenantId: tenant.id,
          error: caught,
        }),
      });
    }
    try {
      const result = await reconcileApifyUsageForTenant({
        admin,
        tenantId: tenant.id,
      });
      providerUsageResults.push({
        stage: "provider_usage",
        tenant_id: tenant.id,
        ok: true,
        ...result,
      });
    } catch (caught) {
      providerUsageResults.push({
        stage: "provider_usage",
        tenant_id: tenant.id,
        ok: false,
        error: reportStageFailure({
          stage: "provider_usage",
          tenantId: tenant.id,
          error: caught,
        }),
      });
    }
    try {
      const result = await runContentScansForTenant({
        admin,
        tenantId: tenant.id,
        rawSettings: tenant.settings,
      });
      contentScanResults.push({
        stage: "content_scan",
        tenant_id: tenant.id,
        ok: true,
        ...result,
      });
    } catch (caught) {
      contentScanResults.push({
        stage: "content_scan",
        tenant_id: tenant.id,
        ok: false,
        error: reportStageFailure({
          stage: "content_scan",
          tenantId: tenant.id,
          error: caught,
        }),
      });
    }
    try {
      const result = await refillEngagementRecommendations({
        admin,
        tenantId: tenant.id,
        settings: tenant.settings,
      });
      engagementResults.push({
        stage: "engagement",
        tenant_id: tenant.id,
        ok: true,
        ...result,
      });
    } catch (caught) {
      engagementResults.push({
        stage: "engagement",
        tenant_id: tenant.id,
        ok: false,
        error: reportStageFailure({
          stage: "engagement",
          tenantId: tenant.id,
          error: caught,
        }),
      });
    }
    try {
      const result = await refillNetworkingRecommendations({
        admin,
        tenantId: tenant.id,
        settings: tenant.settings,
      });
      networkingResults.push({
        stage: "networking",
        tenant_id: tenant.id,
        ok: true,
        ...result,
      });
    } catch (caught) {
      networkingResults.push({
        stage: "networking",
        tenant_id: tenant.id,
        ok: false,
        error: reportStageFailure({
          stage: "networking",
          tenantId: tenant.id,
          error: caught,
        }),
      });
    }
  }

  const failures = [
    ...recordingQueueResults.filter((result) => !result.ok),
    ...profileEnrichmentResults.filter((result) => !result.ok),
    ...transcriptRetentionResults.filter((result) => !result.ok),
    ...relationshipStrengthResults.filter((result) => !result.ok),
    ...providerUsageResults.filter((result) => !result.ok),
    ...contentScanResults.filter((result) => !result.ok),
    ...engagementResults.filter((result) => !result.ok),
    ...networkingResults.filter((result) => !result.ok),
  ];
  if ((tenants.data ?? []).length > 0) {
    const { error: auditError } = await admin.from("audit_log").insert(
      (tenants.data ?? []).map((tenant) => {
        const tenantFailures = failures.filter(
          (result) => result.tenant_id === tenant.id,
        );
        return {
          tenant_id: tenant.id,
          actor_type: "system",
          action: tenantFailures.length
            ? "automation.daily_failed"
            : "automation.daily_completed",
          table_name: "integration_connections",
          metadata: {
            engagement_runs: engagementResults.filter(
              (result) => result.tenant_id === tenant.id,
            ).length,
            relationship_strength_updated:
              relationshipStrengthResults.find(
                (result) => result.tenant_id === tenant.id,
              )?.updated ?? 0,
            raw_transcripts_purged:
              transcriptRetentionResults.find(
                (result) => result.tenant_id === tenant.id,
              )?.purged ?? 0,
            recording_receipts_claimed:
              recordingQueueResults.find(
                (result) => result.tenant_id === tenant.id,
              )?.claimed ?? 0,
            networking_generated:
              networkingResults.find(
                (result) => result.tenant_id === tenant.id,
              )?.generated ?? 0,
            provider_costs_finalized:
              providerUsageResults.find(
                (result) => result.tenant_id === tenant.id,
              )?.finalized ?? 0,
            content_scan_runs:
              contentScanResults.find(
                (result) => result.tenant_id === tenant.id,
              )?.started ?? 0,
            profile_enrichment_jobs_queued:
              profileEnrichmentResults.find(
                (result) => result.tenant_id === tenant.id,
              )?.created ?? 0,
            incomplete_profiles_reviewed:
              profileEnrichmentResults.find(
                (result) => result.tenant_id === tenant.id,
              )?.considered ?? 0,
            failure_count: tenantFailures.length,
            failed_stages: tenantFailures.map((result) => ({
              stage: result.stage,
              error: result.error ?? "Unknown error",
            })),
          },
        };
      }),
    );
    if (auditError) {
      console.error("[automation.daily] audit write failed", {
        error: automationStateError(auditError),
      });
    }
  }

  return privateJson(
    {
      provider_usage: providerUsageResults,
      content_scans: contentScanResults,
      relationship_strength: relationshipStrengthResults,
      transcript_retention: transcriptRetentionResults,
      recording_queue: recordingQueueResults,
      profile_enrichment: profileEnrichmentResults,
      engagement: engagementResults,
      networking: networkingResults,
      completed_at: new Date().toISOString(),
    },
    { status: failures.length ? 500 : 200 },
  );
}
