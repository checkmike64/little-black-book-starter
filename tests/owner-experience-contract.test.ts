import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { engagementPlacementReason } from "../lib/engagement/factual-reason.js";
import { networkingProfileBasis } from "../lib/networking/factual-basis.js";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("distilled owner experience", () => {
  test("explains engagement placement with persisted lane facts", () => {
    assert.equal(
      engagementPlacementReason({ lane: "partners", isProspect: false }),
      "This recent post belongs to a contact in Referral Partners.",
    );
    assert.equal(
      engagementPlacementReason({ lane: "active", isProspect: true }),
      "This update matches the purpose you saved for this Want to Know relationship.",
    );
    assert.match(
      engagementPlacementReason({
        lane: "active",
        isProspect: true,
        prospectPurpose: "Podcast hosts",
      }),
      /episode or show milestone/,
    );
  });

  test("builds networking basis only from stored need and offer fields", () => {
    assert.equal(
      networkingProfileBasis(
        {
          full_name: "Ava",
          company_name: null,
          company_description: null,
          role_title: null,
          one_line_summary: null,
          current_asks: "an event photographer",
          wants_help_with: null,
          what_they_want_more_of: null,
          ideal_referral: null,
          podcast_fit: null,
          podcast_url: null,
          services_offered: null,
          could_refer_me_for: null,
        },
        {
          full_name: "Bo",
          company_name: null,
          company_description: null,
          role_title: null,
          one_line_summary: null,
          current_asks: null,
          wants_help_with: null,
          what_they_want_more_of: null,
          ideal_referral: null,
          podcast_fit: null,
          podcast_url: null,
          services_offered: ["event photography"],
          could_refer_me_for: null,
        },
      ),
      "Ava — looking for: an event photographer. Bo — offers: event photography.",
    );
    assert.equal(
      networkingProfileBasis(null, null),
      "No supporting profile facts are stored for this pair. Review both profiles before approving.",
    );
  });

  test("shows the stored facts behind a deterministic podcast match", () => {
    assert.equal(
      networkingProfileBasis(
        {
          full_name: "Justyn",
          company_name: "Growth Co",
          company_description: null,
          role_title: ["Founder"],
          one_line_summary: null,
          current_asks: null,
          wants_help_with: null,
          what_they_want_more_of: null,
          ideal_referral: null,
          podcast_fit: "Looking for podcast guest opportunities about growth",
          podcast_url: null,
          services_offered: null,
          could_refer_me_for: null,
        },
        {
          full_name: "Joe",
          company_name: "Operator Show",
          company_description: null,
          role_title: ["Podcast host"],
          one_line_summary: "Hosts a show for business operators",
          current_asks: null,
          wants_help_with: null,
          what_they_want_more_of: null,
          ideal_referral: null,
          podcast_fit: null,
          podcast_url: "https://example.com/show",
          services_offered: null,
          could_refer_me_for: null,
        },
      ),
      "Justyn — podcast context: Looking for podcast guest opportunities about growth. Joe — saved profile: Hosts a show for business operators.",
    );
  });

  test("keeps Recordings behind the operator boundary and out of owner links", () => {
    const recordings = source("app/(portal)/recordings/page.tsx");
    const nav = source("app/(portal)/portal-nav.tsx");
    const admin = source("app/(portal)/admin/page.tsx");

    assert.match(recordings, /const operatorContext = await requireOperatorAccess\(\);[\s\S]*?await getRecordingsData\(\{\s*context: operatorContext/);
    assert.match(recordings, /<h2 id="recording-timeline-heading">Meeting Inbox<\/h2>/);
    assert.match(admin, /href: "\/recordings"[\s\S]*?Recording administration/);
    assert.doesNotMatch(
      nav.match(/const coreNav:[\s\S]*?\];/)?.[0] ?? "",
      /\/recordings/,
    );
  });

  test("uses private invoice language and removes customer-facing subscription copy", () => {
    const support = source("app/(portal)/support/page.tsx");
    const settings = source("app/(portal)/settings/page.tsx");

    assert.match(support, /Service invoices are handled privately/);
    assert.match(settings, /manages provider billing/);
    assert.doesNotMatch(`${support}\n${settings}`, /subscription|subscribe/i);
  });

  test("removes speculative Why labels and hooks from owner-facing copy", () => {
    const paths = [
      "app/(portal)/ask/page.tsx",
      "app/(portal)/changes/[id]/page.tsx",
      "app/(portal)/contacts/[id]/page.tsx",
      "app/(portal)/engagement/page.tsx",
      "app/(portal)/movement/next-move-capture-form.tsx",
      "app/(portal)/networking/page.tsx",
      "app/(portal)/promises/page.tsx",
    ];
    const ownerCopy = paths.map(source).join("\n");

    for (const phrase of [
      "Why this post?",
      "Why now.",
      "potentially useful match",
      "may be relevant because",
      "timely, low-friction",
      "Why this move",
      "Why this update",
      "No rationale was saved",
      '<h3>Why</h3>',
      'className="k">Why',
    ]) {
      assert.doesNotMatch(ownerCopy, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  test("codifies the factual owner-copy contract", () => {
    const guideline = source("docs/OWNER_COPY_GUIDELINES.md");

    assert.match(guideline, /state what the application can verify/);
    assert.match(guideline, /Do not use hooks such as “The fit\.” or “Why now\.”/);
    assert.match(guideline, /Do not manufacture urgency/);
    assert.match(guideline, /deterministic explanation derived from identified fields/);
    assert.match(guideline, /“Why stay in touch” may remain/);
  });

  test("retires Scoreboard without leaving an owner feature surface", () => {
    const modules = source("lib/modules.ts");
    const retiredRoute = source("app/(portal)/scoreboard/page.tsx");
    const deployment = source("lib/deployment-readiness.ts");
    const movement = source("app/(portal)/movement/page.tsx");

    assert.doesNotMatch(modules, /key: "scoreboard"/);
    assert.match(retiredRoute, /redirect\("\/dashboard"\)/);
    assert.doesNotMatch(deployment, /path: "\/scoreboard"/);
    assert.doesNotMatch(movement, /href="\/scoreboard"/);
  });
});
