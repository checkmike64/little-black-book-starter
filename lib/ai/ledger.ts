import type { AdminClient } from "@/lib/server-action-context";
import type {
  AiGenerationLedger,
  AiGenerationLedgerEntry,
} from "@/lib/ai/router";

function ledgerMetadata(entry: AiGenerationLedgerEntry) {
  return {
    task: entry.task,
    feature: entry.feature,
    prompt_version: entry.promptVersion,
    prompt_hash: entry.promptHash,
    primary_model: entry.primaryModel,
    fallback_models: entry.fallbackModels,
    served_model: entry.servedModel,
    response_id: entry.responseId,
    gateway_generation_id: entry.gatewayGenerationId,
    model_attempt_count: entry.modelAttemptCount,
    final_provider: entry.finalProvider,
    input_tokens: entry.inputTokens,
    output_tokens: entry.outputTokens,
    total_tokens: entry.totalTokens,
    latency_ms: entry.latencyMs,
    finish_reason: entry.finishReason,
    error_kind: entry.errorKind,
    error_code: entry.errorCode,
    content_recorded: false,
  };
}

export function createAiGenerationLedger(admin: AdminClient): AiGenerationLedger {
  return async (entry) => {
    if (!entry.tenantId) {
      throw new Error("AI generation ledger requires a tenant.");
    }
    const metadata = ledgerMetadata(entry);
    const { data, error } = await admin.rpc("lbb_record_ai_generation_ledger", {
      p_tenant_id: entry.tenantId,
      p_actor_user_id: entry.userId,
      p_status: entry.status,
      p_total_tokens: entry.totalTokens,
      p_metadata: metadata,
    });
    if (error || !data) {
      throw new Error("AI generation receipt could not be recorded atomically.");
    }
  };
}
