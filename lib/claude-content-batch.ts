export type ContentBatchPosition = {
  batchIndex: number | null;
  batchCount: number | null;
  inferredSingleBatch: boolean;
  error: string | null;
};

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, 1_000_000)
    : null;
}

export function resolveContentBatchPosition({
  batchIndex: batchIndexInput,
  batchCount: batchCountInput,
}: {
  batchIndex: unknown;
  batchCount: unknown;
}): ContentBatchPosition {
  const batchIndexMissing =
    batchIndexInput === null || batchIndexInput === undefined;
  const batchCountMissing =
    batchCountInput === null || batchCountInput === undefined;
  let batchIndex = positiveInteger(batchIndexInput);
  let batchCount = positiveInteger(batchCountInput);
  let inferredSingleBatch = false;

  if (
    (!batchIndexMissing && batchIndex === null) ||
    (!batchCountMissing && batchCount === null)
  ) {
    return {
      batchIndex,
      batchCount,
      inferredSingleBatch,
      error:
        "batch_index and batch_count must be positive integers when supplied.",
    };
  }

  // A single-request delivery has only one possible position. Accept the
  // partial metadata shape emitted by older scheduled Claude runs without
  // weakening validation for a true multi-batch delivery.
  if (batchIndexMissing && batchCount === 1) {
    batchIndex = 1;
    inferredSingleBatch = true;
  } else if (batchIndex === 1 && batchCountMissing) {
    batchCount = 1;
    inferredSingleBatch = true;
  }

  if ((batchIndex === null) !== (batchCount === null)) {
    return {
      batchIndex,
      batchCount,
      inferredSingleBatch,
      error:
        "batch_index and batch_count must be supplied together as positive integers.",
    };
  }

  if (batchIndex && batchCount && batchIndex > batchCount) {
    return {
      batchIndex,
      batchCount,
      inferredSingleBatch,
      error: "batch_index cannot be greater than batch_count.",
    };
  }

  return { batchIndex, batchCount, inferredSingleBatch, error: null };
}
