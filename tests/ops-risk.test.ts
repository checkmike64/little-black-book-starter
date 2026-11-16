import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildOpsRiskSummary,
  isStaleRunningJob,
  type OpsRiskJob,
} from "../lib/ops-risk.js";
import { buildOverdueQueueObservation } from "../lib/ops/overdue-queue.js";

const now = Date.parse("2026-07-20T16:00:00.000Z");
const clearQueue = buildOverdueQueueObservation({
  cutoffAt: "2026-07-20T16:00:00.000Z",
  totalDueCount: 0,
  controlledTestDueCount: 0,
  oldestProductionDue: null,
});

function job(overrides: Partial<OpsRiskJob>): OpsRiskJob {
  return {
    id: "job-1",
    job_type: "contact_enrichment",
    status: "running",
    attempts: 1,
    payload: {},
    result: {},
    run_after: "2026-07-20T15:55:00.000Z",
    locked_at: "2026-07-20T10:30:00.000Z",
    created_at: "2026-07-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("ops stale job detection", () => {
  test("uses locked_at instead of run_after for running handoff freshness", () => {
    assert.equal(
      isStaleRunningJob(
        job({
          run_after: "2026-07-20T15:59:00.000Z",
          locked_at: "2026-07-20T10:00:00.000Z",
        }),
        now,
      ),
      true,
    );
  });

  test("falls back to created_at when a running job has no lock timestamp", () => {
    assert.equal(
      isStaleRunningJob(
        job({
          locked_at: null,
          created_at: "2026-07-20T11:30:00.000Z",
        }),
        now,
      ),
      true,
    );
  });

  test("ignores non-running jobs and fresh running locks", () => {
    assert.equal(isStaleRunningJob(job({ status: "queued" }), now), false);
    assert.equal(
      isStaleRunningJob(job({ locked_at: "2026-07-20T13:00:01.000Z" }), now),
      false,
    );
  });

  test("surfaces stale running jobs in the risk summary", () => {
    const summary = buildOpsRiskSummary({
      audit: [],
      usage: [],
      pending: [],
      jobs: [
        job({
          id: "stale-job",
          locked_at: new Date(Date.now() - 5 * 3_600_000).toISOString(),
        }),
      ],
      overdueQueue: clearQueue,
      readHealth: { complete: true, failedLabels: [] },
    });

    assert.equal(summary.status, "Review");
    assert.equal(summary.nextAction.href, "/ops/jobs/stale-job/handoff");
  });
});
