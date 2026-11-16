import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { resolveAiTaskPolicy } from "../lib/ai/policy.js";
import {
  requiredFieldCompletionError,
  requiredFieldProposalLineageError,
} from "../lib/claude-job-completion.js";
import {
  boundSources,
  canonicalProfileUrl,
  emailOrganizationDomain,
  excerptInSource,
  extractProfileLinks,
  linkedinCandidatesFromSearch,
  parseHtmlPage,
  profileCandidatesFromSearch,
  searchResultsFromApify,
  urlInSources,
  type EnrichmentSource,
} from "../lib/enrichment/evidence.js";
import {
  acceptableNameCorrection,
  buildEnrichmentProposals,
  nameLooksIncomplete,
  enrichmentOutputSchema,
  enrichmentPrompt,
  normalizeEnrichmentOutput,
  requiredFieldDispositions,
  type EnrichmentContactSnapshot,
} from "../lib/enrichment/proposals.js";
import {
  enrichmentRetryDelaySeconds,
  workerCanProcessJob,
} from "../lib/enrichment/schedule.js";
import {
  enrichmentPace,
  normalizeEnrichmentAutomationSettings,
} from "../lib/automation/enrichment-settings.js";

const jobId = "5a5b1a8f-122c-4c45-a8b0-cab9a8596318";
const contactId = "320b1ef7-56c0-42a5-9bc7-691b8624ecb2";

const sources: EnrichmentSource[] = [
  {
    id: "B1",
    kind: "book_profile",
    label: "Book profile",
    url: null,
    observed_at: null,
    text: "Name: Taylor Reed\nEmail: taylor@samplestudio.example.com\nwebsite: https://samplestudio.example.com/",
  },
  {
    id: "N1",
    kind: "meeting_notes",
    label: "Call notes: Alex and Taylor (2026-08-28)",
    url: null,
    observed_at: "2026-08-28",
    text: "Casual peer networking call. Taylor was introduced by Boardy on June 29. Both agreed to start with organic referrals.",
  },
  {
    id: "W1",
    kind: "website",
    label: "Website: sampleperson.example.com",
    url: "https://www.sampleperson.example.com/",
    observed_at: "2026-09-30",
    text: "Title: Taylor Reed | Atlas Studio Inc.\nProfile links on this site: https://www.linkedin.com/in/sampleperson\nI design diagnostic quizzes that pre-qualify premium buyers. Based in New York.",
  },
  {
    id: "L1",
    kind: "linkedin_profile",
    label: "LinkedIn /in/sampleperson",
    url: "https://www.linkedin.com/in/sampleperson",
    observed_at: "2026-09-30",
    text: "Name: Taylor Reed\nHeadline: Founder, Atlas Studio\nLocation: New York, New York, United States",
  },
];

const contact: EnrichmentContactSnapshot = {
  id: contactId,
  full_name: "Taylor Reed",
  email: "taylor@samplestudio.example.com",
  website: "https://samplestudio.example.com/",
  company_name: null,
  role_title: null,
  linkedin: null,
  services_offered: ["Marketing coaching"],
};

function fact(field: string, value: unknown, sourceId: string, excerpt: string, extra: Record<string, unknown> = {}) {
  return { field, value, source_id: sourceId, excerpt, confidence: 0.92, correction_reason: null, ...extra };
}

describe("evidence helpers", () => {
  test("reads page text, metadata and outbound links", () => {
    const page = parseHtmlPage(
      `<html><head><title>Casey &amp; Co</title><meta name="description" content="Quiz strategy"></head>
       <body><script>evil()</script><p>Hello&nbsp;world</p><a href="/about">About</a>
       <a href="https://instagram.com/caseysamplebiz">IG</a></body></html>`,
      "https://example.com/",
    );
    assert.equal(page.title, "Casey & Co");
    assert.equal(page.description, "Quiz strategy");
    assert.match(page.text, /Hello world/);
    assert.doesNotMatch(page.text, /evil/);
    assert.deepEqual(page.links, ["https://example.com/about", "https://instagram.com/caseysamplebiz"]);
  });

  test("canonicalizes profile URLs and rejects non-profile links", () => {
    assert.deepEqual(canonicalProfileUrl("https://linkedin.com/in/CaseySample/?trk=x"), {
      platform: "linkedin",
      url: "https://www.linkedin.com/in/caseysample",
    });
    assert.equal(canonicalProfileUrl("https://www.linkedin.com/company/acme"), null);
    assert.equal(canonicalProfileUrl("https://www.instagram.com/p/abc123/"), null);
    assert.equal(canonicalProfileUrl("https://twitter.com/intent/tweet"), null);
    assert.deepEqual(canonicalProfileUrl("https://twitter.com/CaseySampleBiz"), {
      platform: "x_twitter",
      url: "https://x.com/CaseySampleBiz",
    });
    const links = extractProfileLinks(["see https://www.instagram.com/caseysamplebiz/ and https://x.com/CaseySampleBiz."]);
    assert.deepEqual(links.instagram, ["https://www.instagram.com/caseysamplebiz/"]);
    assert.deepEqual(links.x_twitter, ["https://x.com/CaseySampleBiz"]);
  });

  test("uses company email domains but not free-mail domains", () => {
    assert.equal(emailOrganizationDomain("casey@sampleagency.example.com"), "sampleagency.example.com");
    assert.equal(emailOrganizationDomain("someone@gmail.com"), null);
    assert.equal(emailOrganizationDomain("not-an-email"), null);
  });

  test("grounds excerpts and URLs in the sources", () => {
    assert.equal(excerptInSource("design   diagnostic quizzes", sources[2]), true);
    assert.equal(excerptInSource("designs podcasts", sources[2]), false);
    assert.equal(urlInSources("https://linkedin.com/in/sampleperson/", sources), true);
    assert.equal(urlInSources("https://www.linkedin.com/in/someoneelse", sources), false);
  });

  test("only picks LinkedIn search hits that name the person", () => {
    const hits = linkedinCandidatesFromSearch(
      [
        { title: "Taylor Reed - Atlas Studio | LinkedIn", url: "https://www.linkedin.com/in/sampleperson", description: "" },
        { title: "Jordan Reed | LinkedIn", url: "https://www.linkedin.com/in/jordanreed", description: "" },
        { title: "Taylor Reed posts", url: "https://www.linkedin.com/posts/sampleperson_x", description: "" },
      ],
      "Taylor Reed",
    );
    assert.deepEqual(hits, ["https://www.linkedin.com/in/sampleperson"]);
  });

  test("collects all name-matched social profiles across the initial search", () => {
    const results = searchResultsFromApify([
      {
        organicResults: [
          { title: "Taylor Reed | Instagram", url: "https://instagram.com/sampleperson/", description: "Taylor Reed at Atlas Studio" },
          { title: "Taylor Reed - YouTube", url: "https://youtube.com/@sampleperson", description: "Taylor Reed videos" },
        ],
      },
      {
        organicResults: [
          { title: "Taylor Reed | Instagram", url: "https://instagram.com/sampleperson/", description: "duplicate" },
          { title: "Taylor Reed", url: "https://x.com/taylor_reed", description: "Founder at Atlas Studio" },
          { title: "Jordan Reed", url: "https://facebook.com/jordan.reed", description: "Different person" },
        ],
      },
    ]);
    assert.equal(results.length, 4);
    assert.deepEqual(profileCandidatesFromSearch(results, "Taylor Reed"), {
      linkedin: [],
      instagram: ["https://www.instagram.com/sampleperson/"],
      x_twitter: ["https://x.com/taylor_reed"],
      youtube: ["https://www.youtube.com/@sampleperson"],
      facebook: [],
    });
  });

  test("keeps owner sources first when trimming to the budget", () => {
    const big = "x".repeat(5_000);
    const kept = boundSources(
      [
        { ...sources[2], text: big },
        { ...sources[0], text: big },
      ],
      6_000,
    );
    assert.equal(kept[0].kind, "book_profile");
    assert.equal(kept.reduce((total, source) => total + source.text.length, 0) <= 6_000, true);
  });
});

describe("model output normalization", () => {
  test("treats guest appearances as evidence, not the person's own podcast", () => {
    const prompt = enrichmentPrompt({
      contact,
      ownerName: "Alex",
      today: "2026-10-05",
      sources,
    });
    assert.match(prompt.system, /hosts, produces, or owns/);
    assert.match(prompt.system, /guest appearance.*not their podcast_url/);
  });

  test("keeps grounded facts and rejects ungrounded ones", () => {
    const result = normalizeEnrichmentOutput(
      {
        identity_check: { status: "confirmed", reason: "Site and LinkedIn name Taylor Reed at Atlas Studio." },
        facts: [
          fact("company_name", "Atlas Studio Inc.", "W1", "Taylor Reed | Atlas Studio Inc."),
          fact("linkedin", "https://linkedin.com/in/sampleperson", "L1", "Headline: Founder, Atlas Studio"),
          fact("location", ["New York"], "L1", "New York, New York, United States"),
          fact("role_title", ["CEO"], "W1", "this text is not in the source"),
          fact("one_line_summary", "Quiz strategist", "Z9", "unknown source id"),
          fact("company_description", "Quizzes", "W1", "I design diagnostic quizzes", { confidence: 0.5 }),
        ],
        site_health_notes: [],
      },
      sources,
    );
    assert.deepEqual(result.facts.map((item) => item.field), ["company_name", "linkedin", "location"]);
    assert.equal(result.facts[1].value, "https://www.linkedin.com/in/sampleperson");
    assert.deepEqual(
      result.rejected.map((item) => item.reason),
      ["excerpt_not_in_source", "unknown_source", "low_confidence"],
    );
  });

  test("drops public facts unless the identity is confirmed, but keeps the owner's own notes", () => {
    const result = normalizeEnrichmentOutput(
      {
        identity_check: { status: "ambiguous", reason: "Several people share this name." },
        facts: [
          fact("company_name", "Atlas Studio Inc.", "W1", "Taylor Reed | Atlas Studio Inc."),
          fact("how_we_met", "Boardy intro on June 29.", "N1", "Taylor was introduced by Boardy on June 29"),
        ],
        site_health_notes: [],
      },
      sources,
    );
    assert.deepEqual(result.facts.map((item) => item.field), ["how_we_met"]);
    assert.equal(result.rejected[0].reason, "identity_not_confirmed");
  });

  test("relationship judgments and URLs from the web must meet stricter rules", () => {
    const result = normalizeEnrichmentOutput(
      {
        identity_check: { status: "confirmed", reason: "Match." },
        facts: [
          fact("relationship_type", ["Referral Partner"], "W1", "I design diagnostic quizzes"),
          fact("linkedin", "https://www.linkedin.com/in/impostor", "W1", "I design diagnostic quizzes"),
          fact("relationship_type", ["Best Friend", "Referral Partner"], "N1", "Both agreed to start with organic referrals"),
        ],
        site_health_notes: ["sampleagency.example.com has a certificate error"],
      },
      sources,
    );
    assert.deepEqual(result.rejected.map((item) => item.reason), [
      "owner_only_field_from_public_source",
      "invalid_value",
    ]);
    assert.deepEqual(result.facts.map((item) => [item.field, item.value]), [["relationship_type", ["Referral Partner"]]]);
    assert.deepEqual(result.siteHealthNotes, ["sampleagency.example.com has a certificate error"]);
  });

  test("matches quotes that differ only in punctuation, emoji or spacing", () => {
    assert.equal(excerptInSource("Taylor Reed – Atlas Studio Inc", sources[2]), true);
    assert.equal(excerptInSource("🚀 I design   diagnostic quizzes!", sources[2]), true);
    assert.equal(excerptInSource("I design diagnostic quiz", sources[2]), false);
    assert.equal(excerptInSource("design podcasts that pre-qualify", sources[2]), false);
  });

  test("keeps how-you-met facts to the owner's notes and existing labels", () => {
    const result = normalizeEnrichmentOutput(
      {
        identity_check: { status: "confirmed", reason: "Match." },
        facts: [
          fact("met_date", "2026-09-30", "B1", "Name: Taylor Reed"),
          fact("how_i_know_them", ["boardy intro", "Calendar meeting via Alex"], "N1", "Taylor was introduced by Boardy on June 29"),
          fact("company_name", "Atlas", "W1", "this is not quoted from the site"),
        ],
        site_health_notes: [],
      },
      sources,
      { howIKnowThemVocabulary: ["Referral", "Boardy intro"] },
    );
    assert.deepEqual(result.facts.map((item) => [item.field, item.value]), [["how_i_know_them", ["Boardy intro"]]]);
    assert.deepEqual(
      result.rejected.map((item) => [item.field, item.reason]),
      [["met_date", "owner_only_field_from_public_source"], ["company_name", "excerpt_not_in_source"]],
    );
    assert.equal(result.rejected[1].excerpt, "this is not quoted from the site");
  });

  test("schema allows only the worker's fields", () => {
    const fieldEnum = enrichmentOutputSchema.properties.facts.items.properties.field.enum as readonly string[];
    for (const forbidden of ["email", "phone", "private_notes", "personal_notes", "trust_level", "birthday"]) {
      assert.equal(fieldEnum.includes(forbidden), false, forbidden);
    }
  });
});

describe("proposal building", () => {
  const normalized = normalizeEnrichmentOutput(
    {
      identity_check: { status: "confirmed", reason: "Site and LinkedIn match." },
      facts: [
        fact("company_name", "Atlas Studio Inc.", "W1", "Taylor Reed | Atlas Studio Inc."),
        fact("linkedin", "https://www.linkedin.com/in/sampleperson", "L1", "Headline: Founder, Atlas Studio"),
        fact("services_offered", ["Diagnostic quiz design"], "W1", "I design diagnostic quizzes", {
          correction_reason: "The saved service is vaguer than what her site offers now.",
        }),
        fact("website", "https://www.sampleperson.example.com/", "W1", "Taylor Reed | Atlas Studio Inc.", {
          correction_reason: null,
        }),
        fact("how_we_met", "Boardy intro on June 29.", "N1", "Taylor was introduced by Boardy on June 29"),
        fact("relationship_type", ["Referral Partner"], "N1", "Both agreed to start with organic referrals"),
      ],
      site_health_notes: [],
    },
    sources,
  );

  test("fills blanks, routes corrections separately, and never silently overwrites", () => {
    const { proposals, skipped } = buildEnrichmentProposals({
      jobId,
      contact,
      facts: normalized.facts,
      identity: normalized.identity,
      siteHealthNotes: [],
      existingProposals: [],
      now: new Date("2026-09-30T12:00:00Z"),
      generation: { promptVersion: "contact_enrichment_v1", gatewayGenerationId: "gen_1", model: "anthropic/claude-sonnet-4.6" },
    });
    const byGroup = Object.fromEntries(proposals.map((proposal) => [proposal.group, proposal]));
    assert.deepEqual(Object.keys(byGroup), ["profile", "context", "referral", "corrections"]);
    assert.deepEqual(byGroup.profile.fieldNames, ["company_name", "linkedin"]);
    assert.equal(byGroup.profile.riskLevel, "low");
    assert.equal(byGroup.referral.riskLevel, "high");
    assert.equal(byGroup.corrections.riskLevel, "high");
    assert.deepEqual((byGroup.corrections.payload.previous_values as Record<string, unknown>).services_offered, [
      "Marketing coaching",
    ]);
    assert.deepEqual(skipped, [{ field: "website", reason: "would_overwrite" }]);
    const evidence = byGroup.profile.payload.evidence as Record<string, unknown>;
    assert.equal(evidence.source_job_id, jobId);
    assert.equal(typeof evidence.verification_summary, "string");
    assert.equal(byGroup.profile.idempotencyKey, `enrichment_worker:${jobId}:profile`);
  });

  test("does not re-ask about fields already pending or values recently dismissed", () => {
    const { proposals, skipped } = buildEnrichmentProposals({
      jobId,
      contact,
      facts: normalized.facts,
      identity: normalized.identity,
      siteHealthNotes: [],
      existingProposals: [
        { status: "pending", created_at: "2026-09-29T00:00:00Z", fields: { company_name: "Atlas" } },
        { status: "dismissed", created_at: "2026-09-01T00:00:00Z", fields: { linkedin: "https://linkedin.com/in/sampleperson/" } },
        { status: "dismissed", created_at: "2025-01-01T00:00:00Z", fields: { how_we_met: "Boardy intro on June 29." } },
      ],
      now: new Date("2026-09-30T12:00:00Z"),
      generation: { promptVersion: "v", gatewayGenerationId: null, model: null },
    });
    assert.deepEqual(
      skipped.filter((item) => item.reason !== "would_overwrite"),
      [
        { field: "company_name", reason: "already_pending" },
        { field: "linkedin", reason: "previously_dismissed" },
      ],
    );
    assert.equal(proposals.some((proposal) => proposal.fieldNames.includes("how_we_met")), true);
  });

  test("dispositions satisfy the job-completion validator", () => {
    const { proposals } = buildEnrichmentProposals({
      jobId,
      contact,
      facts: normalized.facts,
      identity: normalized.identity,
      siteHealthNotes: [],
      existingProposals: [],
      now: new Date("2026-09-30T12:00:00Z"),
      generation: { promptVersion: "v", gatewayGenerationId: null, model: null },
    });
    const created = proposals.map((proposal, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index}`,
      fields: proposal.payload.fields as Record<string, unknown>,
      payload: proposal.payload,
    }));
    const requiredFields = ["primary_email", "company_or_role", "one_line_summary", "website", "social_profiles"];
    const dispositions = requiredFieldDispositions({
      requiredFields,
      contact: { ...contact, email: null },
      created,
      sourcesChecked: ["Website https://samplestudio.example.com/", "LinkedIn https://www.linkedin.com/in/sampleperson"],
      identityReason: "Site and LinkedIn match.",
    });
    assert.equal(dispositions.primary_email.status, "owner_confirmation_required");
    assert.equal(dispositions.company_or_role.status, "proposed");
    assert.equal(dispositions.social_profiles.status, "proposed");
    assert.equal(dispositions.website.status, "verified_current");
    assert.equal(dispositions.one_line_summary.status, "not_found");

    const podcast = requiredFieldDispositions({
      requiredFields: ["podcast_presence"],
      contact,
      created: [{
        id: "00000000-0000-4000-8000-000000000099",
        fields: { podcast_url: "https://example.com/taylor-show" },
      }],
      sourcesChecked: ["Google podcast search"],
      identityReason: "The show page names Taylor Reed as host.",
    });
    assert.deepEqual(podcast.podcast_presence, {
      status: "proposed",
      pending_change_id: "00000000-0000-4000-8000-000000000099",
    });

    const completion = { outcome: "submitted_changes", required_field_dispositions: dispositions };
    const jobPayload = { contact_id: contactId, required_fields: requiredFields };
    assert.equal(
      requiredFieldCompletionError({
        jobPayload,
        completionResult: completion,
        createdPendingChangeIds: created.map((row) => row.id),
        createdInteractionIds: [],
      }),
      null,
    );
    assert.equal(
      requiredFieldProposalLineageError({
        jobId,
        jobPayload,
        jobCreatedAt: "2026-09-17T11:00:00Z",
        completionResult: completion,
        expectedContactId: contactId,
        pendingChanges: created.map((row) => ({
          id: row.id,
          contact_id: contactId,
          change_type: "contact_enrichment",
          payload: row.payload,
          status: "pending",
          created_at: "2026-09-30T12:00:00Z",
        })),
      }),
      null,
    );
  });
});

describe("name corrections", () => {
  test("only incomplete saved names can be corrected, and only plausibly", () => {
    for (const name of ["Brob", "John", "Timpearceemail", "Mark Herre at SEOgame", "Bond (surname unconfirmed)"]) {
      assert.equal(nameLooksIncomplete(name), true, name);
    }
    assert.equal(nameLooksIncomplete("Taylor Reed"), false);
    assert.equal(acceptableNameCorrection("Brob", "Braden Roberts"), true);
    assert.equal(acceptableNameCorrection("Timpearceemail", "Tim Pearce"), true);
    assert.equal(acceptableNameCorrection("Mark Herre at SEOgame", "Mark Herre"), true);
    assert.equal(acceptableNameCorrection("John", "Sarah Lee"), false);
    assert.equal(acceptableNameCorrection("Taylor Reed", "Taylor A. Reed"), false);
    assert.equal(acceptableNameCorrection("John", "John"), false);
  });

  test("a name correction is a your-call proposal with the previous value", () => {
    const named = normalizeEnrichmentOutput(
      {
        identity_check: { status: "confirmed", reason: "LinkedIn matches." },
        facts: [fact("full_name", "Taylor Reed", "L1", "Name: Taylor Reed", { correction_reason: "Saved name is a handle." })],
        site_health_notes: [],
      },
      sources,
    );
    const handle = buildEnrichmentProposals({
      jobId,
      contact: { ...contact, full_name: "Treed" },
      facts: named.facts,
      identity: named.identity,
      siteHealthNotes: [],
      existingProposals: [],
      now: new Date("2026-10-01T12:00:00Z"),
      generation: { promptVersion: "v", gatewayGenerationId: null, model: null },
    });
    assert.equal(handle.proposals[0].group, "corrections");
    assert.equal(handle.proposals[0].riskLevel, "high");
    assert.deepEqual(handle.proposals[0].payload.previous_values, { full_name: "Treed" });
    const complete = buildEnrichmentProposals({
      jobId,
      contact: { ...contact, full_name: "Taylor J Reed" },
      facts: named.facts,
      identity: named.identity,
      siteHealthNotes: [],
      existingProposals: [],
      now: new Date("2026-10-01T12:00:00Z"),
      generation: { promptVersion: "v", gatewayGenerationId: null, model: null },
    });
    assert.deepEqual(complete.skipped, [{ field: "full_name", reason: "name_not_incomplete" }]);
  });
});

describe("pacing and policy", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  test("defaults to 25 people a day, two per run, and can be switched off", () => {
    const defaults = normalizeEnrichmentAutomationSettings(undefined);
    const pace = enrichmentPace(defaults, {}, now);
    assert.deepEqual(pace, { enabled: true, dailyLimit: 25, perRunLimit: 2, catchingUp: false, catchupEndsAt: null });
    assert.equal(enrichmentPace(defaults, { LBB_ENRICHMENT_WORKER_ENABLED: "false" }, now).enabled, false);
    assert.equal(enrichmentPace({ ...defaults, enabled: false }, {}, now).enabled, false);
    assert.equal(enrichmentPace({ ...defaults, daily_limit: 0 }, {}, now).enabled, false);
    assert.equal(normalizeEnrichmentAutomationSettings({ daily_limit: 999 }).daily_limit, 200);
  });

  test("a catch-up window speeds up research until it ends, and far-future windows are ignored", () => {
    const settings = normalizeEnrichmentAutomationSettings({ catchup_until: "2026-10-02T12:00:00Z" });
    const catchingUp = enrichmentPace(settings, {}, now);
    assert.equal(catchingUp.catchingUp, true);
    assert.equal(catchingUp.dailyLimit, 150);
    assert.equal(catchingUp.perRunLimit, 4);
    assert.equal(enrichmentPace(settings, {}, new Date("2026-10-03T00:00:00Z")).dailyLimit, 25);
    const typo = normalizeEnrichmentAutomationSettings({ catchup_until: "2099-01-01T00:00:00Z" });
    assert.equal(enrichmentPace(typo, {}, now).catchingUp, false);
    assert.equal(enrichmentPace(settings, { LBB_ENRICHMENT_DAILY_LIMIT: "40" }, now).dailyLimit, 40);
  });

  test("leaves person-in-the-loop jobs for a Claude project", () => {
    assert.equal(workerCanProcessJob({ contact_id: contactId, trigger: "profile_gap_refresh" }), true);
    assert.equal(workerCanProcessJob({ contact_id: contactId, trigger: "approved_contact_enrichment" }), false);
    assert.equal(workerCanProcessJob({ contact_id: contactId, trigger: "owner_context_revision" }), false);
    assert.equal(workerCanProcessJob({ contact_id: contactId, command_focus: { intent: "draft" } }), false);
    assert.equal(workerCanProcessJob({ contact_id: contactId, test_mode: true }), false);
    assert.equal(workerCanProcessJob({}), false);
  });

  test("backs off on failures and waits longer on AI budget problems", () => {
    assert.equal(enrichmentRetryDelaySeconds(1, null), 1_800);
    assert.equal(enrichmentRetryDelaySeconds(5, null), 7_200);
    assert.equal(enrichmentRetryDelaySeconds(1, "budget"), 21_600);
  });

  test("registers the AI task and its ledger allowlist", () => {
    const policy = resolveAiTaskPolicy("contact_enrichment", { env: {} });
    assert.equal(policy.feature, "enrichment");
    const migration = readFileSync(
      new URL("../../supabase/migrations/20261001000000_contact_enrichment_ai_ledger.sql", import.meta.url),
      "utf8",
    );
    assert.match(migration, /'contact_enrichment'/);
    assert.match(migration, /p_metadata ->> 'task' = 'contact_enrichment' and p_metadata ->> 'feature' <> 'enrichment'/);
    const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    assert.equal(vercel.crons.some((cron) => cron.path === "/api/automation/enrichment"), true);
  });
});
