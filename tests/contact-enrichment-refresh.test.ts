import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  profileEnrichmentGaps,
  profileGapIdempotencyKey,
  selectProfileGapCandidates,
  type ProfileGapCandidate,
  type ProfileGapContact,
} from "../lib/contact-enrichment-policy.js";
import {
  requiredFieldCompletionError,
  requiredFieldProposalLineageError,
  type RequiredFieldPendingChange,
} from "../lib/claude-job-completion.js";

function contact(id: string, overrides: Partial<ProfileGapContact> = {}): ProfileGapContact {
  return {
    id,
    full_name: `Person ${id}`,
    email: null,
    company_name: null,
    role_title: null,
    one_line_summary: null,
    website: null,
    linkedin: null,
    instagram: null,
    facebook: null,
    x_twitter: null,
    youtube: null,
    ...overrides,
  };
}

test("profile gaps request one primary email and public identity research", () => {
  assert.deepEqual(profileEnrichmentGaps(contact("one")), [
    "primary_email",
    "company_or_role",
    "one_line_summary",
    "website",
    "social_profiles",
  ]);
  assert.deepEqual(
    profileEnrichmentGaps(
      contact("two", {
        email: "primary@example.com",
        company_name: "Example",
        one_line_summary: "Founder at Example.",
        website: "https://example.com",
        linkedin: "https://linkedin.com/in/example",
      }),
    ),
    [],
  );
});

test("profile gap idempotency deduplicates one refresh window and permits a later window", () => {
  const input = {
    contactId: "contact-1",
    gaps: ["social_profiles", "website"] as const,
  };
  const first = profileGapIdempotencyKey({
    ...input,
    gaps: [...input.gaps],
    now: new Date("2026-09-14T08:00:00Z"),
  });
  const replay = profileGapIdempotencyKey({
    ...input,
    gaps: [...input.gaps],
    now: new Date("2026-09-30T20:00:00Z"),
  });
  const later = profileGapIdempotencyKey({
    ...input,
    gaps: [...input.gaps],
    now: new Date("2026-10-01T08:00:00Z"),
  });
  assert.equal(first, replay);
  assert.notEqual(first, later);
});

test("recent jobs do not consume the daily creation capacity", () => {
  const candidates: ProfileGapCandidate[] = Array.from({ length: 303 }, (_, index) => ({
    contact: contact(String(index + 1)),
    gaps: ["social_profiles"],
  }));
  const selected = selectProfileGapCandidates({
    candidates,
    skippedContactIds: new Set(
      Array.from({ length: 300 }, (_, index) => String(index + 1)),
    ),
    limit: 2,
    scanLimit: candidates.length,
  });
  assert.deepEqual(selected.selected.map((candidate) => candidate.contact.id), ["301", "302"]);
  assert.equal(selected.skipped, 300);
  assert.equal(selected.considered, 302);
});

test("completion rejects no-change without field-by-field source coverage", () => {
  const error = requiredFieldCompletionError({
    jobPayload: { required_fields: ["website", "social_profiles"] },
    completionResult: {
      outcome: "no_change_needed",
      required_field_dispositions: {
        website: {
          status: "not_found",
          sources_checked: ["company domain search"],
          reason: "No verified company site was found.",
        },
      },
    },
    createdPendingChangeIds: [],
    createdInteractionIds: [],
  });
  assert.match(error ?? "", /social_profiles/);
});

test("completion rejects a partial proposal and accepts linked dispositions for every field", () => {
  const partial = requiredFieldCompletionError({
    jobPayload: { required_fields: ["website", "linkedin"] },
    completionResult: {
      outcome: "submitted_changes",
      required_field_dispositions: {
        website: { status: "proposed", pending_change_id: "change-1" },
      },
    },
    createdPendingChangeIds: ["change-1"],
    createdInteractionIds: [],
  });
  assert.match(partial ?? "", /linkedin/);

  const complete = requiredFieldCompletionError({
    jobPayload: { required_fields: ["website", "linkedin"] },
    completionResult: {
      outcome: "submitted_changes",
      required_field_dispositions: {
        website: { status: "proposed", pending_change_id: "change-1" },
        linkedin: {
          status: "not_found",
          sources_checked: ["LinkedIn name and company search"],
          reason: "No profile could be matched confidently.",
        },
      },
    },
    createdPendingChangeIds: ["change-1"],
    createdInteractionIds: [],
  });
  assert.equal(complete, null);
});

test("required-field proposal completion enforces job, time, status, contact, and field lineage", () => {
  const jobId = "10000000-0000-4000-8000-000000000001";
  const contactId = "20000000-0000-4000-8000-000000000001";
  const pendingId = "30000000-0000-4000-8000-000000000001";
  const row: RequiredFieldPendingChange = {
    id: pendingId,
    contact_id: contactId,
    change_type: "contact_enrichment",
    status: "pending",
    created_at: "2026-09-16T10:01:00.000Z",
    payload: {
      fields: { email: "primary@example.com" },
      evidence: { source_job_id: jobId },
    },
  };
  const input = {
    jobId,
    jobPayload: { required_fields: ["primary_email"] },
    jobCreatedAt: "2026-09-16T10:00:00.000Z",
    completionResult: {
      required_field_dispositions: {
        primary_email: { status: "proposed", pending_change_id: pendingId },
      },
    },
    expectedContactId: contactId,
    pendingChanges: [row],
  };

  assert.equal(requiredFieldProposalLineageError(input), null);
  assert.match(
    requiredFieldProposalLineageError({
      ...input,
      pendingChanges: [{ ...row, change_type: "new_contact" }],
    }) ?? "",
    /field-update or contact-enrichment/,
  );
  assert.match(
    requiredFieldProposalLineageError({
      ...input,
      pendingChanges: [{ ...row, status: "approved" }],
    }) ?? "",
    /still-pending/,
  );
  assert.match(
    requiredFieldProposalLineageError({
      ...input,
      pendingChanges: [{ ...row, created_at: "2026-09-16T09:59:59.000Z" }],
    }) ?? "",
    /after this job was admitted/,
  );
  assert.match(
    requiredFieldProposalLineageError({
      ...input,
      pendingChanges: [{
        ...row,
        payload: { ...row.payload, evidence: { source_job_id: "wrong-job" } },
      }],
    }) ?? "",
    /source_job_id/,
  );
  assert.match(
    requiredFieldProposalLineageError({
      ...input,
      pendingChanges: [{
        ...row,
        payload: { fields: { website: "https://example.com" }, evidence: { source_job_id: jobId } },
      }],
    }) ?? "",
    /without a usable value/,
  );
  assert.match(
    requiredFieldProposalLineageError({
      ...input,
      pendingChanges: [{
        ...row,
        payload: { fields: { email: null }, evidence: { source_job_id: jobId } },
      }],
    }) ?? "",
    /without a usable value/,
  );
  assert.match(
    requiredFieldProposalLineageError({
      ...input,
      pendingChanges: [{
        ...row,
        payload: { fields: { email: ["primary@example.com"] }, evidence: { source_job_id: jobId } },
      }],
    }) ?? "",
    /without a usable value/,
  );
});

test("required-field field groups accept company or role and supported social profiles", () => {
  const jobId = "10000000-0000-4000-8000-000000000001";
  const contactId = "20000000-0000-4000-8000-000000000001";
  const makeRow = (id: string, fields: Record<string, unknown>): RequiredFieldPendingChange => ({
    id,
    contact_id: contactId,
    change_type: "contact_enrichment",
    status: "pending",
    created_at: "2026-09-16T10:01:00.000Z",
    payload: { fields, evidence: { source_job_id: jobId } },
  });
  const companyId = "30000000-0000-4000-8000-000000000001";
  const socialId = "30000000-0000-4000-8000-000000000002";
  assert.equal(
    requiredFieldProposalLineageError({
      jobId,
      jobPayload: { required_fields: ["company_or_role", "social_profiles"] },
      jobCreatedAt: "2026-09-16T10:00:00.000Z",
      completionResult: {
        required_field_dispositions: {
          company_or_role: { status: "proposed", pending_change_id: companyId },
          social_profiles: { status: "proposed", pending_change_id: socialId },
        },
      },
      expectedContactId: contactId,
      pendingChanges: [
        makeRow(companyId, { role_title: ["Founder"] }),
        makeRow(socialId, { linkedin: "https://linkedin.com/in/person" }),
      ],
    }),
    null,
  );
  assert.match(
    requiredFieldProposalLineageError({
      jobId,
      jobPayload: { required_fields: ["company_or_role"] },
      jobCreatedAt: "2026-09-16T10:00:00.000Z",
      completionResult: {
        required_field_dispositions: {
          company_or_role: { status: "proposed", pending_change_id: companyId },
        },
      },
      expectedContactId: contactId,
      pendingChanges: [makeRow(companyId, { role_title: [] })],
    }) ?? "",
    /without a usable value/,
  );
  assert.match(
    requiredFieldProposalLineageError({
      jobId,
      jobPayload: { required_fields: ["social_profiles"] },
      jobCreatedAt: "2026-09-16T10:00:00.000Z",
      completionResult: {
        required_field_dispositions: {
          social_profiles: { status: "proposed", pending_change_id: socialId },
        },
      },
      expectedContactId: contactId,
      pendingChanges: [makeRow(socialId, { linkedin: null, instagram: " " })],
    }) ?? "",
    /without a usable value/,
  );
});

test("scalar required fields reject null and array proposals", () => {
  const jobId = "10000000-0000-4000-8000-000000000001";
  const contactId = "20000000-0000-4000-8000-000000000001";
  const pendingId = "30000000-0000-4000-8000-000000000001";

  for (const requiredField of ["one_line_summary", "website"]) {
    for (const proposedValue of [null, ["wrong-type"]]) {
      assert.match(
        requiredFieldProposalLineageError({
          jobId,
          jobPayload: { required_fields: [requiredField] },
          jobCreatedAt: "2026-09-16T10:00:00.000Z",
          completionResult: {
            required_field_dispositions: {
              [requiredField]: { status: "proposed", pending_change_id: pendingId },
            },
          },
          expectedContactId: contactId,
          pendingChanges: [{
            id: pendingId,
            contact_id: contactId,
            change_type: "field_update",
            status: "pending",
            created_at: "2026-09-16T10:01:00.000Z",
            payload: {
              fields: { [requiredField]: proposedValue },
              evidence: { source_job_id: jobId },
            },
          }],
        }) ?? "",
        /without a usable value/,
      );
    }
  }
});

test("a direct role-title requirement accepts only a nonempty string array", () => {
  const jobId = "10000000-0000-4000-8000-000000000001";
  const contactId = "20000000-0000-4000-8000-000000000001";
  const pendingId = "30000000-0000-4000-8000-000000000001";
  const input = {
    jobId,
    jobPayload: { required_fields: ["role_title"] },
    jobCreatedAt: "2026-09-16T10:00:00.000Z",
    completionResult: {
      required_field_dispositions: {
        role_title: { status: "proposed", pending_change_id: pendingId },
      },
    },
    expectedContactId: contactId,
  };
  const row = (roleTitle: unknown): RequiredFieldPendingChange => ({
    id: pendingId,
    contact_id: contactId,
    change_type: "contact_enrichment",
    status: "pending",
    created_at: "2026-09-16T10:01:00.000Z",
    payload: {
      fields: { role_title: roleTitle },
      evidence: { source_job_id: jobId },
    },
  });

  assert.equal(
    requiredFieldProposalLineageError({
      ...input,
      pendingChanges: [row(["Founder"])],
    }),
    null,
  );
  assert.match(
    requiredFieldProposalLineageError({
      ...input,
      pendingChanges: [row("Founder")],
    }) ?? "",
    /without a usable value/,
  );
  assert.match(
    requiredFieldProposalLineageError({
      ...input,
      pendingChanges: [row([])],
    }) ?? "",
    /without a usable value/,
  );
});

test("a failed and reclaimed job can complete with the same idempotent proposal", () => {
  const jobId = "10000000-0000-4000-8000-000000000001";
  const contactId = "20000000-0000-4000-8000-000000000001";
  const pendingId = "30000000-0000-4000-8000-000000000001";
  const proposalCreatedAt = "2026-09-16T10:01:00.000Z";
  const latestReclaimAt = "2026-09-16T11:00:00.000Z";

  assert.ok(Date.parse(proposalCreatedAt) < Date.parse(latestReclaimAt));
  assert.equal(
    requiredFieldProposalLineageError({
      jobId,
      jobPayload: { required_fields: ["website"] },
      jobCreatedAt: "2026-09-16T10:00:00.000Z",
      completionResult: {
        required_field_dispositions: {
          website: { status: "proposed", pending_change_id: pendingId },
        },
      },
      expectedContactId: contactId,
      pendingChanges: [{
        id: pendingId,
        contact_id: contactId,
        change_type: "contact_enrichment",
        status: "pending",
        created_at: proposalCreatedAt,
        payload: {
          fields: { website: "https://example.com" },
          evidence: { source_job_id: jobId },
        },
      }],
    }),
    null,
  );
});

test("Today refresh is a durable Claude queue action, not a browser reload", () => {
  const page = readFileSync("app/(portal)/dashboard/page.tsx", "utf8");
  const actions = readFileSync("app/(portal)/dashboard/actions.ts", "utf8");
  const daily = readFileSync("app/api/automation/daily/route.ts", "utf8");
  const claim = readFileSync("app/api/claude/jobs/route.ts", "utf8");

  assert.doesNotMatch(page, /DataLoadNotice/);
  assert.match(page, /form action=\{requestClaudeRefresh\}/);
  assert.match(page, />\s*Refresh\s*</);
  assert.match(actions, /reconcileProfileEnrichmentGaps/);
  assert.match(actions, /claude\.refresh_requested/);
  assert.match(actions, /result\.failed > 0/);
  assert.match(actions, /Use Refresh again/);
  assert.match(daily, /stage: "profile_enrichment"/);
  assert.match(claim, /required_fields: safeStringList/);
  assert.match(claim, /const requiredSteps = safeStringList/);
  assert.match(claim, /required_steps: Array\.from/);
  assert.match(claim, /research_policy: cleanText/);
  assert.doesNotMatch(actions, /router\.refresh|window\.location\.reload/);
});
