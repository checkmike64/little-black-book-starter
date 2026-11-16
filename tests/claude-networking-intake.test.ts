import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { normalizedActiveMigrationSql } from "./migration-source.js";
import { groundNetworkingEvidence } from "../lib/networking-evidence-grounding.js";

describe("Claude networking intelligence intake", () => {
  const route = readFileSync("app/api/claude/networking/route.ts", "utf8");
  const migration = normalizedActiveMigrationSql;
  const foundationMigration = readFileSync(
    "supabase/migrations/20260822143000_canonical_tenant_settings_and_workflow_grants.sql",
    "utf8",
  );

  it("uses the private Claude gateway and tenant scope", () => {
    assert.match(route, /authenticateClaudeRequest/);
    assert.match(route, /tenantIdFrom/);
    assert.match(route, /maxBytes: 300_000/);
    assert.match(route, /1 to 25 items/);
  });

  it("requires idempotent, evidence-backed recommendations", () => {
    assert.match(route, /idempotency_key is required/);
    assert.match(route, /summary and why_now are required/);
    assert.match(route, /cleanEvidence/);
    assert.match(route, /priority_score/);
    assert.match(route, /lbb_record_grounded_networking_recommendation/);
    assert.match(route, /networking evidence could not be verified against this pair's stored sources/);
    assert.match(route, /persistedEvidenceForPair/);
    assert.match(route, /const canonicalEvidence = groundedClaims\.map/);
    assert.match(route, /p_evidence: canonicalEvidence/);
    assert.match(route, /p_summary: groundedSummary/);
    assert.match(route, /p_why_now: groundedWhyNow/);
    assert.doesNotMatch(route, /p_summary: summary/);
    assert.doesNotMatch(route, /p_why_now: whyNow/);
    assert.match(route, /participantIds\.length !== 1/);
    assert.match(foundationMigration, /matched_terms_source/);
    assert.match(foundationMigration, /stored_evidence_exact_excerpt/);
    assert.match(foundationMigration, /matched_term_refs/);
  });

  it("rejects forged and cross-contact evidence while deriving stored excerpts", () => {
    const contactA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const contactB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const persisted = [
      { contactId: contactA, sourceRef: "source-a", text: "Ava is seeking operations leaders." },
      { contactId: contactB, sourceRef: "source-b", text: "Bob hosts a systems podcast." },
    ];
    const grounded = groundNetworkingEvidence({
      contactA,
      contactB,
      persisted,
      claims: [
        { contact_id: contactA, source_ref: "source-a", excerpt: "operations leaders" },
        { contact_id: contactB, source_ref: "source-b", excerpt: "systems podcast" },
      ],
    });
    assert.deepEqual(grounded?.map((claim) => claim.excerpt), [
      "operations leaders",
      "systems podcast",
    ]);
    assert.equal(
      groundNetworkingEvidence({
        contactA,
        contactB,
        persisted,
        claims: [
          { contact_id: contactA, source_ref: "forged", excerpt: "global award" },
          { contact_id: contactB, source_ref: "source-b", excerpt: "systems podcast" },
        ],
      }),
      null,
    );
    assert.equal(
      groundNetworkingEvidence({
        contactA,
        contactB,
        persisted,
        claims: [
          { contact_id: contactB, source_ref: "source-a", excerpt: "operations leaders" },
          { contact_id: contactB, source_ref: "source-b", excerpt: "systems podcast" },
        ],
      }),
      null,
    );
    assert.equal(
      groundNetworkingEvidence({
        contactA,
        contactB,
        persisted,
        claims: [
          { contact_id: contactA, source_ref: "source-a", excerpt: "a" },
          { contact_id: contactB, source_ref: "source-b", excerpt: "the" },
        ],
      }),
      null,
    );
  });

  it("preserves relationship facts and owner decisions", () => {
    assert.match(migration, /existing_row\.status = 'already_connected'/);
    assert.match(migration, /existing_row\.status = 'dismissed'/);
    assert.match(migration, /owner_snooze_preserved/);
    assert.match(migration, /networking\.recommendation_upgraded/);
    assert.match(migration, /existing_row\.source in \('network_fit_v1', 'network_fit_v2'\)/);
    assert.match(migration, /prior_introduction/);
    assert.match(migration, /shared_relationship_context/);
    assert.match(migration, /connection_prior in \('strong', 'moderate'\)/);
    const recommendationStart = migration.indexOf(
      "create or replace function public.lbb_record_networking_recommendation",
    );
    const recommendationRemainder = migration.slice(recommendationStart);
    const recommendationFunction = recommendationRemainder.slice(
      0,
      recommendationRemainder.indexOf("-- source:", 1),
    );
    assert.ok(recommendationFunction.length > 0);
    assert.doesNotMatch(recommendationFunction, /on conflict[\s\S]{0,120}do update/i);
  });

  it("keeps the write service-only and auditable", () => {
    assert.match(migration, /security definer/);
    assert.match(migration, /revoke all on function/);
    assert.match(migration, /grant execute[\s\S]*to service_role/);
    assert.match(migration, /networking\.recommendation_created/);
    assert.match(migration, /claude_intelligence_v1/);
  });
});
