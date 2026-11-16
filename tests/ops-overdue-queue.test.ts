import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  buildOverdueQueueObservation,
  overdueQueueCutoffAt,
} from "../lib/ops/overdue-queue.js";
import {
  buildOpsRiskSummary,
  type OpsRiskJob,
} from "../lib/ops-risk.js";

const cutoffAt = "2026-09-04T12:00:00.000Z";

function job(attempts: number): OpsRiskJob {
  return {
    id: `job-${attempts}`,
    job_type: "contact_enrichment",
    status: "queued",
    attempts,
    payload: {},
    result: {},
    run_after: "2026-09-04T11:00:00.000Z",
    locked_at: null,
    created_at: "2026-09-04T10:00:00.000Z",
  };
}

function risk(
  overdueQueue: ReturnType<typeof buildOverdueQueueObservation>,
  options: { complete?: boolean; failedLabels?: string[]; jobs?: OpsRiskJob[] } = {},
) {
  return buildOpsRiskSummary({
    audit: [],
    usage: [],
    pending: [],
    jobs: options.jobs ?? [],
    overdueQueue,
    readHealth: {
      complete: options.complete ?? true,
      failedLabels: options.failedLabels ?? [],
    },
  });
}

describe("exact overdue queued-job observation", () => {
  test("uses one deterministic cutoff", () => {
    assert.equal(
      overdueQueueCutoffAt(Date.parse(cutoffAt)),
      cutoffAt,
    );
  });

  for (const attempts of [0, 1]) {
    test(`warns for overdue production work at attempt ${attempts}`, () => {
      const observation = buildOverdueQueueObservation({
        cutoffAt,
        totalDueCount: 1,
        controlledTestDueCount: 0,
        oldestProductionDue: {
          id: `job-${attempts}`,
          run_after: "2026-09-04T11:00:00.000Z",
        },
      });
      const summary = risk(observation, { jobs: [job(attempts)] });

      assert.equal(observation.state, "complete");
      assert.equal(observation.overdueProductionCount, 1);
      assert.equal(summary.status, "Review");
      assert.equal(summary.nextAction.href, `/ops/jobs/job-${attempts}`);
      assert.match(summary.nextAction.detail, /Attempts 0 and 1 are included/);
    });
  }

  test("keeps future queued work clear", () => {
    const observation = buildOverdueQueueObservation({
      cutoffAt,
      totalDueCount: 0,
      controlledTestDueCount: 0,
      oldestProductionDue: null,
    });

    const summary = risk(observation, {
      jobs: [
        {
          ...job(0),
          run_after: "2026-09-04T13:00:00.000Z",
        },
      ],
    });

    assert.equal(observation.state, "complete");
    assert.equal(observation.overdueProductionCount, 0);
    assert.equal(summary.status, "Clear");
  });

  test("excludes controlled test jobs from production pressure", () => {
    const observation = buildOverdueQueueObservation({
      cutoffAt,
      totalDueCount: 1,
      controlledTestDueCount: 1,
      oldestProductionDue: null,
    });
    const summary = risk(observation, {
      jobs: [{ ...job(0), payload: { test_mode: true } }],
    });

    assert.equal(observation.state, "complete");
    assert.equal(observation.overdueProductionCount, 0);
    assert.equal(observation.overdueControlledTestCount, 1);
    assert.equal(summary.status, "Clear");
    assert.match(
      summary.items.find((item) => item.key === "overdue-queue-clear")?.detail ?? "",
      /1 controlled test job was excluded/,
    );
  });

  test("marks inconsistent count and oldest-row observations unknown", () => {
    const badCount = buildOverdueQueueObservation({
      cutoffAt,
      totalDueCount: 1,
      controlledTestDueCount: 2,
      oldestProductionDue: null,
    });
    const missingOldest = buildOverdueQueueObservation({
      cutoffAt,
      totalDueCount: 1,
      controlledTestDueCount: 0,
      oldestProductionDue: null,
    });

    assert.equal(badCount.state, "incomplete");
    assert.equal(badCount.overdueProductionCount, null);
    assert.equal(missingOldest.state, "incomplete");
    assert.equal(risk(missingOldest).status, "Review");
    assert.equal(risk(missingOldest).nextAction.label, "Operational health is unknown");
  });

  test("treats query errors and other missing Ops reads as Review, never Clear", () => {
    const readError = buildOverdueQueueObservation({
      cutoffAt,
      totalDueCount: null,
      controlledTestDueCount: null,
      oldestProductionDue: null,
      totalCountError: new Error("timeout"),
    });
    const otherwiseComplete = buildOverdueQueueObservation({
      cutoffAt,
      totalDueCount: 0,
      controlledTestDueCount: 0,
      oldestProductionDue: null,
    });

    assert.equal(readError.state, "error");
    assert.equal(risk(readError).status, "Review");
    const incompleteReads = risk(otherwiseComplete, {
      complete: false,
      failedLabels: ["recent jobs"],
    });
    assert.equal(incompleteReads.status, "Review");
    assert.match(incompleteReads.nextAction.detail, /recent jobs/);
  });

  test("loads exact counts and the oldest due row outside the recent-50 window", () => {
    const source = readFileSync("lib/ops/data.ts", "utf8");
    const firstOverdueQuery = [
      'supabase',
      '      .from("jobs")',
      '      .select("id", { count: "exact", head: true })',
      '      .eq("tenant_id", tenantId)',
      '      .eq("status", "queued")',
      '      .lte("run_after", queueCutoffAt),',
    ].join("\n");
    const observationQueries = source.slice(
      source.indexOf(firstOverdueQuery),
      source.indexOf("const overdueQueue ="),
    );

    assert.notEqual(source.indexOf(firstOverdueQuery), -1);
    assert.equal(
      observationQueries.match(/count: "exact", head: true/g)?.length,
      2,
    );
    assert.equal(
      observationQueries.match(/\.lte\("run_after", queueCutoffAt\)/g)?.length,
      3,
    );
    assert.match(observationQueries, /\.contains\("payload", \{ test_mode: true \}\)/);
    assert.match(
      observationQueries,
      /\.not\("payload", "cs", JSON\.stringify\(\{ test_mode: true \}\)\)/,
    );
    assert.match(
      observationQueries,
      /\.order\("run_after", \{ ascending: true \}\)[\s\S]*\.limit\(1\)[\s\S]*\.maybeSingle\(\)/,
    );
    assert.doesNotMatch(observationQueries, /\.limit\(50\)/);
  });

  test("loads Ops through the validated effective operator tenant", () => {
    const data = readFileSync("lib/ops/data.ts", "utf8");
    const page = readFileSync("app/(portal)/ops/page.tsx", "utf8");
    const loader = data.slice(data.indexOf("export async function getOpsData"));

    assert.match(page, /const context = await requireOperatorAccess\(\)/);
    assert.match(page, /getOpsData\(context\)/);
    assert.match(loader, /if \(!context \|\| context\.role !== "operator"\)/);
    assert.match(loader, /const supabase = createSupabaseAdminClient\(\)/);
    assert.ok(loader.indexOf("context.role") < loader.indexOf("createSupabaseAdminClient"));
    assert.match(loader, /const tenantId = context\.tenantId/);
    assert.equal(
      data.match(/\.eq\("tenant_id", tenantId\)/g)?.length,
      13,
    );
    assert.doesNotMatch(data, /createSupabaseServerClient/);
  });
});
