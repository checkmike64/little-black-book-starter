import type { AdminClient } from "@/lib/server-action-context";
import {
  scoreNetworkingPair,
  selectDiverseMatches,
  selectRecommendationPortfolio,
  type NetworkingContact,
  type NetworkingEvidenceSignal,
  type NetworkingMatch,
} from "@/lib/networking/matching";
import {
  llmAutomationConfigured,
  rankNetworkingCandidates,
  type NetworkingCandidateForLlm,
  type NetworkingRecommendationDraft,
} from "@/lib/automation/llm";
import { normalizeTenantSettings } from "@/lib/tenant-settings";
import { createAiGenerationLedger } from "@/lib/ai/ledger";

type ExistingConnection = {
  id: string;
  contact_a: string;
  contact_b: string;
  source: string | null;
  evidence: Record<string, unknown> | null;
  status: string;
  owner_note: string | null;
  snoozed_until: string | null;
};

type Introduction = {
  person_a: string | null;
  person_b: string | null;
};

type ContextMembership = {
  contact_id: string;
  context_id: string;
  verification_state: string;
};

type RelationshipContext = {
  id: string;
  name: string;
};

type RefillContact = NetworkingContact & {
  trust_level?: string | null;
  relationship_strength?: string | null;
  relationship_type?: string[] | null;
  why_stay_in_touch?: string | null;
  recent_activity?: string | null;
};

type InteractionContext = {
  contact_id: string;
  interactions: {
    id: string;
    occurred_at: string;
    interaction_type: string;
    title: string | null;
    summary: string;
  } | null;
};

type PromiseContext = {
  id: string;
  contact_id: string | null;
  direction: string;
  promise_text: string;
  due_on: string | null;
  evidence: Record<string, unknown> | null;
};

type ContentContext = {
  id: string;
  contact_id: string | null;
  platform: string | null;
  content_type: string | null;
  title: string | null;
  content: string | null;
  relevance: string | null;
  published_at: string;
  source_url: string | null;
};

function pairKey(contactA: string, contactB: string) {
  return contactA < contactB
    ? `${contactA}:${contactB}`
    : `${contactB}:${contactA}`;
}

function appendContext(map: Map<string, string[]>, id: string | null, value: string) {
  if (!id || !value.trim()) return;
  const values = map.get(id) ?? [];
  if (values.length < 8) values.push(value.replace(/\s+/g, " ").trim().slice(0, 500));
  map.set(id, values);
}

function appendSignal(
  map: Map<string, NetworkingEvidenceSignal[]>,
  id: string | null,
  signal: NetworkingEvidenceSignal,
) {
  if (!id || !signal.text.trim()) return;
  const values = map.get(id) ?? [];
  if (values.length < 18) values.push(signal);
  map.set(id, values);
}

function evidenceRole(text: string): NetworkingEvidenceSignal["role"] {
  if (/\b(?:intro(?:duce|duction)?|connect|refer)\w*\b/i.test(text)) {
    return "explicit_introduction";
  }
  if (/\b(?:need|needs|want|wants|looking for|seeking|trying to|asks?|goal|hire|help with)\b/i.test(text)) {
    return "need";
  }
  if (/\b(?:offer|offers|provide|provides|helps?|speciali[sz]es|advises|consults?|builds?|hosts?)\b/i.test(text)) {
    return "offer";
  }
  return "activity";
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return "unknown";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code.slice(0, 80) : "unknown";
}

async function recordNetworkingTelemetry(
  admin: AdminClient,
  tenantId: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  try {
    await admin.from("audit_log").insert({
      tenant_id: tenantId,
      actor_type: "system",
      action,
      table_name: "connections",
      metadata,
    });
  } catch {
    // Recommendation generation must not fail a second time because telemetry is unavailable.
  }
}

function contactOffers(contact: RefillContact) {
  return [
    ...(contact.services_offered ?? []),
    ...(contact.could_refer_me_for ?? []),
    ...(contact.primary_category ?? []),
    ...(contact.top_3_tags ?? []),
    contact.one_line_summary ?? "",
    contact.company_description ?? "",
  ].filter(Boolean).slice(0, 16);
}

function contactAsLlmInput(contact: RefillContact) {
  return {
    id: contact.id,
    name: contact.full_name,
    company: contact.company_name ?? null,
    relationship:
      contact.relationship_strength ?? contact.relationship_type?.join(", ") ?? null,
    how_known: contact.how_we_met ?? null,
    asks: [
      contact.current_asks,
      contact.wants_help_with,
      contact.what_they_want_more_of,
      contact.ideal_referral,
      contact.podcast_fit,
    ].filter(Boolean).join(" | ") || null,
    offers: contactOffers(contact),
    podcast_fit: contact.podcast_fit ?? null,
    why_stay_in_touch: contact.why_stay_in_touch ?? null,
    recent_activity: contact.recent_activity ?? null,
  };
}

function isReplaceableTestRow(connection: ExistingConnection) {
  return (
    connection.source === "source_project_duplicate" &&
    Boolean(
      connection.evidence &&
        "test_duplicate_source_project" in connection.evidence,
    ) &&
    ((connection.status === "suggested" && !connection.snoozed_until) ||
      (connection.status === "dismissed" &&
        connection.owner_note ===
          "Removed copied test recommendation during networking cleanup."))
  );
}

export async function refillNetworkingRecommendations({
  admin,
  tenantId,
  settings: rawSettings,
  targetPending,
}: {
  admin: AdminClient;
  tenantId: string;
  settings: unknown;
  targetPending?: number;
}) {
  const settings = normalizeTenantSettings(rawSettings);
  const reservoirTarget = Math.min(
    80,
    Math.max(targetPending ?? 0, settings.activity.networking_daily_limit * 10, 30),
  );

  const recentCutoff = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const [
    contactsResult,
    connectionsResult,
    introductionsResult,
    contextsResult,
    membershipsResult,
    interactionsResult,
    promisesResult,
    contentResult,
  ] =
    await Promise.all([
      admin
        .from("contacts")
        .select(
          "id, full_name, company_name, company_description, one_line_summary, trust_level, relationship_strength, relationship_type, how_we_met, current_asks, wants_help_with, what_they_want_more_of, services_offered, ideal_referral, do_not_refer_for, could_refer_me_for, podcast_fit, podcast_url, primary_category, top_3_tags, keywords, why_stay_in_touch, recent_activity",
        )
        .eq("tenant_id", tenantId)
        .is("archived_at", null)
        .limit(500),
      admin
        .from("connections")
        .select(
          "id, contact_a, contact_b, source, evidence, status, owner_note, snoozed_until",
        )
        .eq("tenant_id", tenantId)
        .limit(10000),
      admin
        .from("introductions")
        .select("person_a, person_b")
        .eq("tenant_id", tenantId)
        .limit(10000),
      admin
        .from("relationship_contexts")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .is("archived_at", null)
        .limit(1000),
      admin
        .from("relationship_context_memberships")
        .select("contact_id, context_id, verification_state")
        .eq("tenant_id", tenantId)
        .limit(20000),
      admin
        .from("interaction_contacts")
        .select(
          "contact_id, interactions!interaction_contacts_tenant_interaction_fkey!inner(id, occurred_at, interaction_type, title, summary)",
        )
        .eq("tenant_id", tenantId)
        .gte("interactions.occurred_at", recentCutoff)
        .limit(2000),
      admin
        .from("promises")
        .select("id, contact_id, direction, promise_text, due_on, evidence")
        .eq("tenant_id", tenantId)
        .eq("status", "open")
        .limit(1000),
      admin
        .from("content_items")
        .select("id, contact_id, platform, content_type, title, content, relevance, published_at, source_url")
        .eq("tenant_id", tenantId)
        .not("contact_id", "is", null)
        .or(`published_at.gte.${recentCutoff},content_type.eq.website_snapshot`)
        .order("published_at", { ascending: false })
        .limit(2000),
    ]);

  if (
    contactsResult.error ||
    connectionsResult.error ||
    introductionsResult.error ||
    contextsResult.error ||
    membershipsResult.error ||
    interactionsResult.error ||
    promisesResult.error ||
    contentResult.error
  ) {
    const failures = [
      ["contacts", contactsResult.error],
      ["connections", connectionsResult.error],
      ["introductions", introductionsResult.error],
      ["relationship_contexts", contextsResult.error],
      ["relationship_context_memberships", membershipsResult.error],
      ["interactions", interactionsResult.error],
      ["promises", promisesResult.error],
      ["content_items", contentResult.error],
    ]
      .filter((entry) => Boolean(entry[1]))
      .map(([dependency, error]) => ({ dependency, code: errorCode(error) }));
    await recordNetworkingTelemetry(
      admin,
      tenantId,
      "automation.networking_refill_failed",
      { phase: "load", failures },
    );
    throw new Error("The networking recommendation reservoir could not be reviewed.");
  }

  const contacts = (contactsResult.data ?? []) as unknown as RefillContact[];
  const existingConnections = (connectionsResult.data ?? []) as ExistingConnection[];
  const obsoleteSuggestionIds = new Set(
    existingConnections
      .filter(
        (connection) =>
          connection.status === "suggested" &&
          ["network_fit_v2", "network_intelligence_v1", "claude_intelligence_v1"].includes(
            connection.source ?? "",
          ),
      )
      .map((connection) => connection.id),
  );
  if (obsoleteSuggestionIds.size > 0) {
    const retiredAt = new Date().toISOString();
    const { error: retirementError } = await admin
      .from("connections")
      .update({
        status: "dismissed",
        owner_note: "Retired after the relational evidence and portfolio policy upgrade.",
        updated_at: retiredAt,
      })
      .eq("tenant_id", tenantId)
      .in("id", [...obsoleteSuggestionIds]);
    await recordNetworkingTelemetry(
      admin,
      tenantId,
      retirementError
        ? "automation.networking_stale_retirement_failed"
        : "automation.networking_stale_retired",
      {
        generator_version: "network_fit_v3",
        row_count: obsoleteSuggestionIds.size,
        ...(retirementError ? { code: errorCode(retirementError) } : {}),
      },
    );
  }
  const currentConnections = existingConnections.filter(
    (connection) => !obsoleteSuggestionIds.has(connection.id),
  );
  const blockedPairs = new Set(
    currentConnections
      .filter((connection) => !isReplaceableTestRow(connection))
      .map((connection) => pairKey(connection.contact_a, connection.contact_b)),
  );
  const now = Date.now();
  const activePending = currentConnections.filter(
    (connection) =>
      connection.status === "suggested" &&
      !isReplaceableTestRow(connection) &&
      (!connection.snoozed_until || Date.parse(connection.snoozed_until) <= now),
  ).length;
  if (activePending >= reservoirTarget) {
    return {
      generated: 0,
      pending: activePending,
      candidates: 0,
      target: reservoirTarget,
    };
  }

  for (const introduction of (introductionsResult.data ?? []) as Introduction[]) {
    if (introduction.person_a && introduction.person_b) {
      blockedPairs.add(pairKey(introduction.person_a, introduction.person_b));
    }
  }

  const contextNames = new Map(
    ((contextsResult.data ?? []) as RelationshipContext[]).map((context) => [
      context.id,
      context.name,
    ]),
  );
  const allContextNamesByContact = new Map<string, string[]>();
  for (const membership of (membershipsResult.data ?? []) as ContextMembership[]) {
    if (membership.verification_state === "confirmed") {
      appendContext(
        allContextNamesByContact,
        membership.contact_id,
        contextNames.get(membership.context_id) ?? "",
      );
    }
  }

  const recentInteractions = new Map<string, string[]>();
  const evidenceSignals = new Map<string, NetworkingEvidenceSignal[]>();
  for (const row of (interactionsResult.data ?? []) as unknown as InteractionContext[]) {
    if (!row.interactions) continue;
    const interactionText = `${row.interactions.title ?? ""} ${row.interactions.summary}`.trim();
    appendContext(
      recentInteractions,
      row.contact_id,
      `${row.interactions.occurred_at.slice(0, 10)} ${row.interactions.interaction_type}: ${row.interactions.title ?? row.interactions.summary}`,
    );
    appendSignal(evidenceSignals, row.contact_id, {
      source_kind: "conversation",
      source_ref: `interactions:${row.interactions.id}`,
      role: evidenceRole(interactionText),
      text: interactionText,
      observed_at: row.interactions.occurred_at,
    });
  }
  const openPromises = new Map<string, string[]>();
  for (const row of (promisesResult.data ?? []) as PromiseContext[]) {
    appendContext(
      openPromises,
      row.contact_id,
      `${row.direction}${row.due_on ? ` due ${row.due_on}` : ""}: ${row.promise_text}`,
    );
    appendSignal(evidenceSignals, row.contact_id, {
      source_kind: "promise",
      source_ref: `promises:${row.id}`,
      role: evidenceRole(row.promise_text),
      text: row.promise_text,
      observed_at: row.due_on,
    });
  }
  const recentContent = new Map<string, string[]>();
  for (const row of (contentResult.data ?? []) as ContentContext[]) {
    const contentText = `${row.title ?? ""} ${row.relevance ?? ""} ${row.content ?? ""}`.trim();
    const isWebsiteProfile = row.content_type === "website_snapshot";
    appendContext(
      recentContent,
      row.contact_id,
      isWebsiteProfile
        ? `website profile: ${row.relevance ?? row.title ?? row.content ?? ""}`
        : `${row.published_at.slice(0, 10)} ${row.platform ?? "content"}: ${row.relevance ?? row.title ?? row.content ?? ""}`,
    );
    appendSignal(evidenceSignals, row.contact_id, {
      source_kind: "content",
      source_ref: row.source_url || `content_items:${row.id}`,
      role: isWebsiteProfile ? "offer" : evidenceRole(contentText),
      text: contentText,
      observed_at: isWebsiteProfile ? null : row.published_at,
    });
  }

  for (const contact of contacts) {
    contact.evidence_signals = evidenceSignals.get(contact.id) ?? [];
  }

  const matches: NetworkingMatch[] = [];
  for (let aIndex = 0; aIndex < contacts.length; aIndex += 1) {
    const contactA = contacts[aIndex];
    if (/do not refer/i.test(contactA.trust_level ?? "")) continue;
    for (let bIndex = aIndex + 1; bIndex < contacts.length; bIndex += 1) {
      const contactB = contacts[bIndex];
      if (
        /do not refer/i.test(contactB.trust_level ?? "") ||
        blockedPairs.has(pairKey(contactA.id, contactB.id))
      ) {
        continue;
      }
      const match = scoreNetworkingPair(contactA, contactB, {
        relationshipRules: settings.onboarding.relationship_rules,
      });
      if (match) matches.push(match);
    }
  }

  const needed = Math.max(0, reservoirTarget - activePending);
  let rankedDrafts: NetworkingRecommendationDraft[] = [];
  let modelAdjudicated = false;
  const candidateById = new Map<string, NetworkingMatch>();
  if (
    settings.automation.llm_ranking_enabled &&
    llmAutomationConfigured() &&
    matches.length > 0
  ) {
    const candidates: NetworkingCandidateForLlm[] = matches
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map((match) => {
        const id = pairKey(match.contactA.id, match.contactB.id);
        candidateById.set(id, match);
        const contactA = match.contactA as RefillContact;
        const contactB = match.contactB as RefillContact;
        return {
          id,
          contact_a: contactAsLlmInput(contactA),
          contact_b: contactAsLlmInput(contactB),
          deterministic_reason: match.evidence.summary,
          match_type: match.evidence.match_type,
          matched_terms: match.matchedTerms,
          context: {
            recent_interactions: [
              ...(recentInteractions.get(contactA.id) ?? []).map(
                (value) => `${contactA.full_name}: ${value}`,
              ),
              ...(recentInteractions.get(contactB.id) ?? []).map(
                (value) => `${contactB.full_name}: ${value}`,
              ),
            ],
            open_promises: [
              ...(openPromises.get(contactA.id) ?? []).map(
                (value) => `${contactA.full_name}: ${value}`,
              ),
              ...(openPromises.get(contactB.id) ?? []).map(
                (value) => `${contactB.full_name}: ${value}`,
              ),
            ],
            recent_content: [
              ...(recentContent.get(contactA.id) ?? []).map(
                (value) => `${contactA.full_name}: ${value}`,
              ),
              ...(recentContent.get(contactB.id) ?? []).map(
                (value) => `${contactB.full_name}: ${value}`,
              ),
            ],
            groups: [
              ...(allContextNamesByContact.get(contactA.id) ?? []).map(
                (name) => `${contactA.full_name}: ${name}`,
              ),
              ...(allContextNamesByContact.get(contactB.id) ?? []).map(
                (name) => `${contactB.full_name}: ${name}`,
              ),
            ],
          },
        };
      });
    try {
      rankedDrafts = await rankNetworkingCandidates(candidates, {
        network_thesis: [
          settings.onboarding.network_thesis,
          settings.onboarding.relationship_rules
            ? `Hard relationship rules: ${settings.onboarding.relationship_rules}`
            : "",
        ].filter(Boolean).join("\n"),
        referral_lanes: settings.onboarding.referral_lanes,
      }, {
        tenantId,
        tags: ["trigger:automation"],
        ledger: createAiGenerationLedger(admin),
      });
      modelAdjudicated = true;
      await admin.from("audit_log").insert({
        tenant_id: tenantId,
        actor_type: "system",
        action: "automation.networking_llm_ranking_used",
        table_name: "connections",
        metadata: {
          candidate_count: candidates.length,
          selected_ids: rankedDrafts.map((draft) => draft.id),
        },
      });
    } catch (error) {
      rankedDrafts = [];
      await recordNetworkingTelemetry(
        admin,
        tenantId,
        "automation.networking_llm_ranking_failed",
        {
          phase: "ranking",
          candidate_count: candidates.length,
          code: errorCode(error),
          fallback: "deterministic_network_fit_v3",
        },
      );
    }
  }

  const modelSelected = rankedDrafts
    .sort((a, b) => b.priority_score - a.priority_score)
    .map((draft) => ({ match: candidateById.get(draft.id), draft }))
    .filter(
      (row): row is { match: NetworkingMatch; draft: NetworkingRecommendationDraft } =>
        Boolean(row.match),
    )
    .slice(0, Math.max(needed * 3, needed));

  const selected = modelAdjudicated
    ? selectRecommendationPortfolio(modelSelected.map((row) => row.match), needed)
    : selectRecommendationPortfolio(
        selectDiverseMatches(matches, Math.max(needed * 3, needed), 3),
        needed,
      );
  if (!modelAdjudicated && selected.length < needed) {
    const selectedKeys = new Set(
      selected.map((match) => pairKey(match.contactA.id, match.contactB.id)),
    );
    selected.push(
      ...selectRecommendationPortfolio(
        matches.filter(
          (match) => !selectedKeys.has(pairKey(match.contactA.id, match.contactB.id)),
        ),
        needed - selected.length,
      ),
    );
  }
  if (selected.length === 0) {
    return {
      generated: 0,
      pending: activePending,
      candidates: matches.length,
      target: reservoirTarget,
    };
  }

  const generatedAt = new Date().toISOString();
  const modelDraftById = new Map(modelSelected.map((row) => [row.draft.id, row.draft]));
  const rows = selected.map((match) => {
    const contactA = match.contactA.id < match.contactB.id ? match.contactA : match.contactB;
    const contactB = match.contactA.id < match.contactB.id ? match.contactB : match.contactA;
    const draft = modelDraftById.get(pairKey(match.contactA.id, match.contactB.id));
    return {
      tenant_id: tenantId,
      contact_a: contactA.id,
      contact_b: contactB.id,
      source: draft ? "network_intelligence_v2" : "network_fit_v3",
      status: "suggested",
      owner_note: null,
      confirmed_at: null,
      snoozed_until: null,
      confidence: Math.min(0.999, Math.max(0, draft?.confidence ?? match.confidence)),
      evidence: {
        // The owner-facing fit and downstream draft evidence stay anchored to
        // deterministic relationship facts. Model prose is retained only as a
        // separately labeled, extractively validated interpretation.
        summary: match.evidence.summary,
        model_summary: draft?.summary ?? null,
        why_now: draft?.why_now ?? null,
        match_type: match.evidence.match_type,
        model_match_type: draft?.match_type ?? null,
        direction: match.direction,
        matched_terms: match.matchedTerms,
        matched_terms_source: "deterministic_relationship_evidence",
        claims: match.evidence.claims,
        confidence_basis: match.evidence.confidence_basis,
        policy_checks: match.evidence.policy_checks,
        evidence_tags: draft?.evidence_tags ?? [],
        relationship_context: {
          [contactA.id]: {
            how_known: contactA.how_we_met ?? null,
            why_stay_in_touch: contactA.why_stay_in_touch ?? null,
            recent_interactions: recentInteractions.get(contactA.id) ?? [],
            open_promises: openPromises.get(contactA.id) ?? [],
            recent_content: recentContent.get(contactA.id) ?? [],
            groups: allContextNamesByContact.get(contactA.id) ?? [],
          },
          [contactB.id]: {
            how_known: contactB.how_we_met ?? null,
            why_stay_in_touch: contactB.why_stay_in_touch ?? null,
            recent_interactions: recentInteractions.get(contactB.id) ?? [],
            open_promises: openPromises.get(contactB.id) ?? [],
            recent_content: recentContent.get(contactB.id) ?? [],
            groups: allContextNamesByContact.get(contactB.id) ?? [],
          },
        },
        score: draft?.priority_score ?? match.score,
        generated_at: generatedAt,
        generator_version: draft ? "network_intelligence_v2" : "network_fit_v3",
      },
      updated_at: generatedAt,
    };
  });

  const { error } = await admin
    .from("connections")
    .upsert(rows, { onConflict: "tenant_id,contact_a,contact_b" });
  if (error) {
    await recordNetworkingTelemetry(
      admin,
      tenantId,
      "automation.networking_refill_failed",
      {
        phase: "save",
        row_count: rows.length,
        code: errorCode(error),
      },
    );
    throw new Error("New networking recommendations could not be saved.");
  }

  await admin.from("audit_log").insert({
    tenant_id: tenantId,
    actor_type: "system",
    action: "automation.networking_refilled",
    table_name: "connections",
    metadata: {
      generated: rows.length,
      candidate_count: matches.length,
      pending_before: activePending,
      reservoir_target: reservoirTarget,
      generator_version:
        modelSelected.length > 0 ? "network_intelligence_v2" : "network_fit_v3",
      model_ranked: modelSelected.length > 0,
    },
  });

  return {
    generated: rows.length,
    pending: activePending + rows.length,
    candidates: matches.length,
    target: reservoirTarget,
  };
}
