import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const jobs = readFileSync("lib/contact-enrichment-jobs.ts", "utf8");
const worker = readFileSync("lib/enrichment/worker.ts", "utf8");
const scans = readFileSync("lib/automation/content-scans.ts", "utf8");
const actions = readFileSync("app/(portal)/changes/actions.ts", "utf8");
const proposals = readFileSync("lib/enrichment/proposals.ts", "utf8");

describe("initial contact discovery", () => {
  test("queues one comprehensive discovery contract for every new Book contact", () => {
    assert.match(jobs, /initial_discovery: true/);
    assert.match(jobs, /"website",\s*"social_profiles",\s*"podcast_presence"/);
    assert.match(jobs, /"website",\s*"social_profiles",\s*"recent_posts",\s*"podcast_presence"/);
    assert.match(jobs, /idempotencyKey: `initial-contact-enrichment:\$\{contactId\}`/);
    assert.match(jobs, /trigger: "calendar_review" \| "manual_add" \| "approved_new_contact"/);
  });

  test("always performs the identity, social, and podcast searches on initial discovery", () => {
    assert.match(worker, /initialDiscovery = \["manual_add", "calendar_review", "approved_new_contact"\]/);
    assert.match(worker, /`"\$\{contact\.full_name\}" podcast`/);
    assert.match(worker, /LinkedIn Instagram YouTube Facebook Twitter/);
    assert.match(worker, /searchQueries\.join\("\\n"\)/);
    assert.match(proposals, /hosts, produces, or owns/);
    assert.match(proposals, /podcast_presence: \["podcast_url"\]/);
  });

  test("immediately scans saved sources and newly approved or corrected sources", () => {
    assert.match(jobs, /priorityContactIds: \[contactId\]/);
    assert.match(scans, /priorityContactIds\?: string\[\]/);
    assert.match(scans, /\.in\("contact_id", priorityBookContactIds\)/);
    assert.match(actions, /reason: "approved_profile_source"/);
    assert.match(actions, /reason: "corrected_profile_source"/);
    assert.match(actions, /"x_twitter",\s*"youtube"/);
    assert.match(scans, /linkedin, instagram, facebook, x_twitter, youtube, website/);
  });

  test("keeps profile discoveries in the existing single person-level review", () => {
    assert.match(proposals, /enrichmentProposalGroups = \["profile", "context", "referral", "corrections"\]/);
    assert.match(proposals, /profile: \(name, count\) => `\$\{name\}: public profile/);
    assert.match(actions, /post_approval_enrichment: "suppressed"/);
  });
});
