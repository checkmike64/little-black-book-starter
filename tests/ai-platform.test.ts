import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  aiGatewayConfigured,
  resolveAiTaskPolicy,
} from "../lib/ai/policy.js";
import {
  aiGatewayGenerationAttribution,
  aiGatewayQuotaEntityId,
  aiGatewayTags,
  assertAiAuditContext,
  classifyAiGenerationError,
  estimateAiTokens,
} from "../lib/ai/router.js";
import {
  introductionEvidenceFacts,
  validateIntroductionClaims,
  type GroundedIntroductionOutput,
} from "../lib/ai/introduction-grounding.js";
import type { IntroductionEmailContext } from "../lib/automation/llm.js";

const introduction: IntroductionEmailContext = {
  reason: "Justin can help Kyle find strong podcast guests.",
  reason_verified: true,
  voice: {
    owner_voice: "Direct and warm.",
    assistant_style: "Plain language.",
    default_outreach_tone: "Peer to peer.",
  },
  person_a: {
    first_name: "Justin",
    full_name: "Justin Berkovits",
    company: "One Company",
    role: "Founder",
    how_we_met: "Justin and I met at the Summit.",
    why_stay_in_touch: null,
    current_asks: null,
    wants_help_with: null,
    referral_fit: "Can place podcast guests.",
    recent_activity: null,
    relationship_notes: null,
    recent_interactions: [],
    open_promises: [],
    groups: [],
  },
  person_b: {
    first_name: "Kyle",
    full_name: "Kyle Gray",
    company: "Two Company",
    role: "Podcast host",
    how_we_met: "Kyle and I met through our coaching group.",
    why_stay_in_touch: null,
    current_asks: "Wants thoughtful podcast guests.",
    wants_help_with: null,
    referral_fit: null,
    recent_activity: null,
    relationship_notes: null,
    recent_interactions: [],
    open_promises: [],
    groups: [],
  },
};

describe("AI task policy and routing safeguards", () => {
  it("uses current provider-neutral OpenAI and Anthropic Gateway models", () => {
    const engagement = resolveAiTaskPolicy("engagement_rank", { env: {} });
    const networking = resolveAiTaskPolicy("networking_rank", { env: {} });
    assert.equal(engagement.primaryModel, "openai/gpt-5.4");
    assert.deepEqual(engagement.fallbackModels, ["anthropic/claude-sonnet-4.6"]);
    assert.equal(networking.primaryModel, "anthropic/claude-sonnet-4.6");
    assert.deepEqual(networking.fallbackModels, ["openai/gpt-5.4"]);
  });

  it("accepts valid task overrides and rejects malformed model IDs", () => {
    const overridden = resolveAiTaskPolicy("ask_answer", {
      env: {
        LBB_AI_ASK_ANSWER_PRIMARY_MODEL: "openai/gpt-5.4-mini",
        LBB_AI_ASK_ANSWER_FALLBACK_MODEL: "not-a-gateway-model",
      },
    });
    assert.equal(overridden.primaryModel, "openai/gpt-5.4-mini");
    assert.deepEqual(overridden.fallbackModels, ["anthropic/claude-sonnet-4.6"]);
  });

  it("requires server-side Gateway authentication", () => {
    assert.equal(aiGatewayConfigured({}), false);
    assert.equal(aiGatewayConfigured({ AI_GATEWAY_API_KEY: "test" }), true);
    assert.equal(aiGatewayConfigured({ VERCEL_OIDC_TOKEN: "test" }), true);
  });

  it("classifies budget, rate, timeout, and provider errors without leaking details", () => {
    assert.equal(classifyAiGenerationError({ statusCode: 402 }).kind, "budget");
    assert.equal(classifyAiGenerationError({ statusCode: 429 }).kind, "rate_limit");
    assert.equal(classifyAiGenerationError({ name: "TimeoutError" }).kind, "timeout");
    assert.equal(classifyAiGenerationError({ statusCode: 503 }).kind, "unavailable");
    assert.equal(estimateAiTokens("12345678"), 2);
  });

  it("attributes requests by product, feature, task, prompt, and tenant", () => {
    const tags = aiGatewayTags({
      task: "ask_answer",
      feature: "ask",
      promptVersion: "ask v1",
      tenantId: "TENANT 123",
      extra: ["Trigger:Owner"],
    });
    assert.ok(tags.includes("product:little-black-book"));
    assert.ok(tags.includes("feature:ask"));
    assert.ok(tags.includes("task:ask_answer"));
    assert.ok(tags.includes("prompt:ask-v1"));
    assert.ok(tags.includes("tenant:tenant-123"));
    assert.ok(tags.includes("trigger:owner"));
  });

  it("uses the project budget unless tenant quota entities are explicitly enabled", () => {
    const tenantId = "tenant-123";
    assert.equal(aiGatewayQuotaEntityId(tenantId, {}), undefined);
    assert.equal(
      aiGatewayQuotaEntityId(tenantId, {
        LBB_AI_TENANT_QUOTAS_ENABLED: "true",
      }),
      tenantId,
    );
  });

  it("records the actual Gateway primary model and generation correlation", () => {
    assert.deepEqual(
      aiGatewayGenerationAttribution({
        providerMetadata: {
          gateway: {
            generationId: "gen_primary-123",
            routing: {
              canonicalSlug: "openai/gpt-5.4",
              finalProvider: "openai",
              modelAttemptCount: 1,
            },
          },
        },
        primaryModel: "openai/gpt-5.4",
        fallbackModels: ["anthropic/claude-sonnet-4.6"],
      }),
      {
        servedModel: "openai/gpt-5.4",
        servedProvider: "openai",
        gatewayGenerationId: "gen_primary-123",
        modelAttemptCount: 1,
      },
    );
  });

  it("attributes a Gateway fallback to the model that actually succeeded", () => {
    assert.deepEqual(
      aiGatewayGenerationAttribution({
        providerMetadata: {
          gateway: {
            generationId: "gen_fallback-456",
            routing: {
              originalModelId: "openai/gpt-5.4",
              canonicalSlug: "anthropic/claude-sonnet-4.6",
              finalProvider: "anthropic",
              modelAttemptCount: 2,
              modelAttempts: [
                {
                  canonicalSlug: "openai/gpt-5.4",
                  success: false,
                },
                {
                  canonicalSlug: "anthropic/claude-sonnet-4.6",
                  success: true,
                },
              ],
            },
          },
        },
        primaryModel: "openai/gpt-5.4",
        fallbackModels: ["anthropic/claude-sonnet-4.6"],
      }),
      {
        servedModel: "anthropic/claude-sonnet-4.6",
        servedProvider: "anthropic",
        gatewayGenerationId: "gen_fallback-456",
        modelAttemptCount: 2,
      },
    );
  });

  it("fails closed on unconfigured models or missing Gateway correlation", () => {
    const baseInput = {
      primaryModel: "openai/gpt-5.4",
      fallbackModels: ["anthropic/claude-sonnet-4.6"],
    } as const;

    assert.equal(
      aiGatewayGenerationAttribution({
        ...baseInput,
        providerMetadata: {
          gateway: {
            generationId: "gen_unconfigured-789",
            routing: {
              canonicalSlug: "unknown/unconfigured-model",
              finalProvider: "unknown",
              modelAttemptCount: 1,
            },
          },
        },
      }),
      null,
    );
    assert.equal(
      aiGatewayGenerationAttribution({
        ...baseInput,
        providerMetadata: {
          gateway: {
            generationId: "gen_missing-attempt-count",
            routing: {
              canonicalSlug: "openai/gpt-5.4",
              finalProvider: "openai",
            },
          },
        },
      }),
      null,
    );
    assert.equal(
      aiGatewayGenerationAttribution({
        ...baseInput,
        providerMetadata: {
          gateway: {
            routing: {
              canonicalSlug: "openai/gpt-5.4",
              finalProvider: "openai",
              modelAttemptCount: 1,
            },
          },
        },
      }),
      null,
    );
    assert.equal(
      aiGatewayGenerationAttribution({
        ...baseInput,
        providerMetadata: {
          gateway: {
            generationId: "bad id with spaces",
            routing: {
              canonicalSlug: "openai/gpt-5.4",
              finalProvider: "openai",
              modelAttemptCount: 1,
            },
          },
        },
      }),
      null,
    );
    assert.equal(
      aiGatewayGenerationAttribution({
        ...baseInput,
        providerMetadata: {
          gateway: {
            generationId: "gen_missing-provider",
            routing: {
              canonicalSlug: "openai/gpt-5.4",
              modelAttemptCount: 1,
            },
          },
        },
      }),
      null,
    );
  });

  it("refuses tenant AI work without its required audit ledger", () => {
    assert.throws(
      () => assertAiAuditContext({ tenantId: "tenant-1" }),
      /append-only audit ledger/i,
    );
    assert.doesNotThrow(() =>
      assertAiAuditContext({ tenantId: "tenant-1", ledger: async () => {} }),
    );
  });

  it("records AI audit and token usage through one transactional receipt", () => {
    const ledger = readFileSync("lib/ai/ledger.ts", "utf8");
    const migration = readFileSync(
      "supabase/migrations/20260822143000_canonical_tenant_settings_and_workflow_grants.sql",
      "utf8",
    );
    assert.match(ledger, /lbb_record_ai_generation_ledger/);
    assert.doesNotMatch(ledger, /from\("audit_log"\)/);
    assert.match(migration, /create or replace function public\.lbb_record_ai_generation_ledger/i);
    assert.match(migration, /AI actor does not belong to this tenant/i);
  });

  it("keeps AI generation ledgers content-free at both application and database boundaries", () => {
    const ledger = readFileSync("lib/ai/ledger.ts", "utf8");
    const migration = readFileSync(
      "supabase/migrations/20260825155748_validate_ai_generation_ledger_metadata.sql",
      "utf8",
    );

    assert.match(ledger, /content_recorded:\s*false/);
    assert.doesNotMatch(
      ledger,
      /\b(?:prompt|system|input|output|messages|content|completion|result|text)\s*:/i,
    );
    assert.match(migration, /jsonb_typeof\(p_metadata\) <> 'object'/i);
    assert.match(migration, /jsonb_object_keys\(p_metadata\)/i);
    assert.match(migration, /content-free schema/i);
    assert.match(migration, /p_metadata \?\| forbidden_keys/i);
    assert.match(
      migration,
      /p_metadata -> 'content_recorded' is distinct from 'false'::jsonb/i,
    );
    assert.match(migration, /Completed AI ledger receipt has an invalid state/i);
    assert.match(migration, /served model is outside its routing policy/i);
    assert.match(migration, /Failed AI ledger receipt has an invalid state/i);
    assert.match(
      migration,
      /revoke execute on function public\.lbb_record_ai_generation_ledger\([\s\S]*from public, anon, authenticated/i,
    );
    assert.match(
      migration,
      /grant execute on function public\.lbb_record_ai_generation_ledger\([\s\S]*to service_role/i,
    );
  });
});

describe("fact-grounded introduction drafts", () => {
  const supported: GroundedIntroductionOutput = {
    subject: "Justin and Kyle",
    body: [
      "Hey Justin and Kyle,",
      "Justin is the Founder at One Company.",
      "Kyle is the Podcast host at Two Company.",
      "Justin can help Kyle find strong podcast guests.",
      "I will let you two take it from here.",
    ].join("\n\n"),
    claims: [
      {
        text: "Justin is the Founder at One Company.",
        evidence_ids: ["person_a.identity"],
      },
      {
        text: "Kyle is the Podcast host at Two Company.",
        evidence_ids: ["person_b.identity"],
      },
      {
        text: "Justin can help Kyle find strong podcast guests.",
        evidence_ids: ["introduction.reason"],
      },
    ],
  };

  it("creates stable evidence IDs and accepts fully cited facts", () => {
    const ids = introductionEvidenceFacts(introduction).map((fact) => fact.id);
    assert.ok(ids.includes("introduction.reason"));
    assert.ok(ids.includes("person_a.identity"));
    assert.ok(ids.includes("person_b.how_owner_knows"));
    assert.equal(validateIntroductionClaims(supported, introduction), true);
  });

  it("rejects nonexistent evidence, uncited facts, and invented numbers", () => {
    assert.equal(
      validateIntroductionClaims(
        {
          ...supported,
          claims: [
            ...supported.claims.slice(0, 2),
            { text: supported.claims[2].text, evidence_ids: ["person_a.award"] },
          ],
        },
        introduction,
      ),
      false,
    );
    assert.equal(
      validateIntroductionClaims(
        { ...supported, body: `${supported.body}\n\nKyle has 10,000 listeners.` },
        introduction,
      ),
      false,
    );
  });

  it("rejects plausible-sounding facts that are not entailed by cited identity evidence", () => {
    const adversarialClaims = [
      "Justin won a global award at One Company.",
      "Justin raised a new funding round for One Company.",
      "Justin doubled client revenue at One Company.",
      "Justin is a certified executive coach at One Company.",
      "Justin and Kyle have worked together for years.",
    ];

    for (const fabricated of adversarialClaims) {
      assert.equal(
        validateIntroductionClaims(
          {
            subject: "Introduction: Justin and Kyle",
            body: [
              "Hey Justin and Kyle,",
              fabricated,
              "Kyle Gray; Podcast host; Two Company.",
              "Justin Berkovits; Founder; One Company.",
              "Justin can help Kyle find strong podcast guests.",
            ].join("\n\n"),
            claims: [
              { text: fabricated, evidence_ids: ["person_a.identity"] },
              {
                text: "Kyle Gray; Podcast host; Two Company.",
                evidence_ids: ["person_b.identity"],
              },
              {
                text: "Justin Berkovits; Founder; One Company.",
                evidence_ids: ["person_a.identity"],
              },
              {
                text: "Justin can help Kyle find strong podcast guests.",
                evidence_ids: ["introduction.reason"],
              },
            ],
          },
          introduction,
        ),
        false,
        fabricated,
      );
    }
  });

  it("never exempts short facts or closing-phrase injections from grounding", () => {
    for (const fabricated of [
      "Kyle won.",
      "Kyle quit.",
      "They are rich.",
      "Take it from here, Kyle won a global award.",
    ]) {
      assert.equal(
        validateIntroductionClaims(
          { ...supported, body: `${supported.body}\n\n${fabricated}` },
          introduction,
        ),
        false,
        fabricated,
      );
    }
  });

  it("never promotes an unverified introduction reason into evidence", () => {
    const unverified = { ...introduction, reason_verified: false };
    assert.equal(
      introductionEvidenceFacts(unverified).some(
        (fact) => fact.id === "introduction.reason",
      ),
      false,
    );
    assert.equal(validateIntroductionClaims(supported, unverified), false);
  });

  it("rejects role and relationship inversions even when every word exists", () => {
    const invertedReason = "Kyle can help Justin find strong podcast guests.";
    assert.equal(
      validateIntroductionClaims(
        {
          ...supported,
          body: supported.body.replace(
            "Justin can help Kyle find strong podcast guests.",
            invertedReason,
          ),
          claims: [
            ...supported.claims.slice(0, 2),
            { text: invertedReason, evidence_ids: ["introduction.reason"] },
          ],
        },
        introduction,
      ),
      false,
    );
    assert.equal(
      validateIntroductionClaims(
        {
          ...supported,
          body: supported.body.replace(
            "Justin is the Founder at One Company.",
            "Kyle is the Founder at One Company.",
          ),
          claims: [
            {
              text: "Kyle is the Founder at One Company.",
              evidence_ids: ["person_a.identity", "person_b.identity"],
            },
            ...supported.claims.slice(1),
          ],
        },
        introduction,
      ),
      false,
    );
  });
});
