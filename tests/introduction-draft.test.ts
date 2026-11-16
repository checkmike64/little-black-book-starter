import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  sanitizeIntroductionEmailDraft,
  type IntroductionEmailContext,
} from "../lib/automation/llm.js";

const context: IntroductionEmailContext = {
  reason: "Justin can help Kyle place strong podcast guests.",
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
    how_we_met: null,
    why_stay_in_touch: null,
    current_asks: null,
    wants_help_with: null,
    referral_fit: null,
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
    role: "Host",
    how_we_met: null,
    why_stay_in_touch: null,
    current_asks: null,
    wants_help_with: null,
    referral_fit: null,
    recent_activity: null,
    relationship_notes: null,
    recent_interactions: [],
    open_promises: [],
    groups: [],
  },
};

test("introduction draft removes full names and em dashes", () => {
  const draft = sanitizeIntroductionEmailDraft(
    {
      subject: "Justin Berkovits and Kyle Gray",
      body: "Hey Justin Berkovits and Kyle Gray,\n\nJustin — Kyle can help with this. Kyle, Justin is worth knowing.",
    },
    context,
  );
  assert.ok(draft);
  assert.doesNotMatch(draft.subject, /Berkovits|Gray/);
  assert.doesNotMatch(draft.body, /Berkovits|Gray|—/);
  assert.match(draft.body, /Justin/);
  assert.match(draft.body, /Kyle/);
});

test("networking keeps the generated draft provider-neutral", () => {
  const page = readFileSync("app/(portal)/networking/page.tsx", "utf8");
  assert.doesNotMatch(page, /mailto:/);
  assert.doesNotMatch(page, /Gmail|Google|\/api\/integrations\/google/i);
  assert.match(page, /Copy this draft into the email service you use\./);
  assert.match(page, /aria-readonly="true"/);
});

test("introduction context excludes raw transcripts and private notes", () => {
  const source = readFileSync("lib/introduction-drafts.ts", "utf8");
  const prompt = readFileSync("lib/automation/llm.ts", "utf8");
  assert.doesNotMatch(source, /private_notes|transcripts/);
  assert.match(source, /recent_interactions/);
  assert.match(source, /open_promises/);
  assert.match(source, /how_i_know_them/);
  assert.match(source, /relationshipLine/);
  assert.match(prompt, /exactly how the owner knows/);
  assert.match(prompt, /fifth-grade reading level/);
  assert.match(prompt, /Apply a humanizer pass/);
  assert.match(prompt, /Apply the owner voice and tone/);
});

test("recommended introductions rebuild fit evidence server-side and retain claim provenance", () => {
  const actions = readFileSync("app/(portal)/introductions/actions.ts", "utf8");
  const drafts = readFileSync("lib/introduction-drafts.ts", "utf8");
  const refill = readFileSync("lib/automation/networking-refill.ts", "utf8");

  assert.match(actions, /Never trust the hidden form field,[\s\S]*prior model prose/);
  assert.match(actions, /matched_terms/);
  assert.match(actions, /resolveIntroductionFitEvidence/);
  assert.match(actions, /connection\.current_contact_match/);
  assert.match(actions, /\.eq\("tenant_id", context\.tenantId\)/);
  assert.match(actions, /relationship_rules/);
  assert.match(actions, /whyContext = `The source-backed fit is:/);
  assert.match(actions, /reason_source: verifiedReasonSource/);
  assert.match(drafts, /connection\.current_contact_match/);
  assert.match(drafts, /reasonFacts\.length === 0/);
  assert.match(drafts, /reason_verified: true/);
  assert.match(drafts, /facts: introductionEvidenceFacts\(draftInput\)/);
  assert.match(drafts, /claims: email\.claims/);
  assert.match(refill, /summary: match\.evidence\.summary/);
  assert.match(refill, /model_summary: draft\?\.summary/);
});
