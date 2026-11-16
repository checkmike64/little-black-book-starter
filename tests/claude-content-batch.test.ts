import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveContentBatchPosition } from "../lib/claude-content-batch.js";

describe("Claude content batch metadata", () => {
  test("accepts complete and omitted batch metadata", () => {
    assert.deepEqual(
      resolveContentBatchPosition({ batchIndex: 2, batchCount: 3 }),
      {
        batchIndex: 2,
        batchCount: 3,
        inferredSingleBatch: false,
        error: null,
      },
    );
    assert.deepEqual(
      resolveContentBatchPosition({ batchIndex: undefined, batchCount: undefined }),
      {
        batchIndex: null,
        batchCount: null,
        inferredSingleBatch: false,
        error: null,
      },
    );
  });

  test("repairs partial metadata only when the delivery is unambiguously one batch", () => {
    assert.deepEqual(
      resolveContentBatchPosition({ batchIndex: undefined, batchCount: 1 }),
      {
        batchIndex: 1,
        batchCount: 1,
        inferredSingleBatch: true,
        error: null,
      },
    );
    assert.deepEqual(
      resolveContentBatchPosition({ batchIndex: 1, batchCount: undefined }),
      {
        batchIndex: 1,
        batchCount: 1,
        inferredSingleBatch: true,
        error: null,
      },
    );
  });

  test("rejects ambiguous or impossible multi-batch positions", () => {
    assert.match(
      resolveContentBatchPosition({ batchIndex: undefined, batchCount: 2 })
        .error ?? "",
      /must be supplied together/,
    );
    assert.match(
      resolveContentBatchPosition({ batchIndex: 3, batchCount: 2 }).error ?? "",
      /cannot be greater/,
    );
    assert.match(
      resolveContentBatchPosition({ batchIndex: "1", batchCount: 1 }).error ?? "",
      /must be positive integers/,
    );
  });
});
