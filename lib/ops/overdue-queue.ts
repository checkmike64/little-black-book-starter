export type OverdueQueuedJobRow = {
  id: string;
  run_after: string;
};

export type OverdueQueueObservationState =
  | "complete"
  | "incomplete"
  | "error";

export type OverdueQueueObservation = {
  cutoffAt: string;
  state: OverdueQueueObservationState;
  overdueProductionCount: number | null;
  overdueControlledTestCount: number | null;
  oldestDueJobId: string | null;
  oldestDueAt: string | null;
  reason:
    | "read_error"
    | "invalid_cutoff"
    | "invalid_count"
    | "inconsistent_count"
    | "inconsistent_oldest"
    | null;
};

type BuildOverdueQueueObservationInput = {
  cutoffAt: string;
  totalDueCount: number | null;
  controlledTestDueCount: number | null;
  oldestProductionDue: OverdueQueuedJobRow | null;
  totalCountError?: unknown;
  controlledTestCountError?: unknown;
  oldestDueError?: unknown;
};

function validCount(value: number | null): value is number {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0;
}

function validDate(value: string) {
  return Number.isFinite(Date.parse(value));
}

function incompleteObservation(
  cutoffAt: string,
  reason: Exclude<OverdueQueueObservation["reason"], "read_error" | null>,
): OverdueQueueObservation {
  return {
    cutoffAt,
    state: "incomplete",
    overdueProductionCount: null,
    overdueControlledTestCount: null,
    oldestDueJobId: null,
    oldestDueAt: null,
    reason,
  };
}

export function overdueQueueCutoffAt(now: Date | number = new Date()) {
  const value = now instanceof Date ? now : new Date(now);
  return value.toISOString();
}

export function buildOverdueQueueObservation({
  cutoffAt,
  totalDueCount,
  controlledTestDueCount,
  oldestProductionDue,
  totalCountError,
  controlledTestCountError,
  oldestDueError,
}: BuildOverdueQueueObservationInput): OverdueQueueObservation {
  if (totalCountError || controlledTestCountError || oldestDueError) {
    return {
      cutoffAt,
      state: "error",
      overdueProductionCount: null,
      overdueControlledTestCount: null,
      oldestDueJobId: null,
      oldestDueAt: null,
      reason: "read_error",
    };
  }

  if (!validDate(cutoffAt)) {
    return incompleteObservation(cutoffAt, "invalid_cutoff");
  }

  if (!validCount(totalDueCount) || !validCount(controlledTestDueCount)) {
    return incompleteObservation(cutoffAt, "invalid_count");
  }

  if (controlledTestDueCount > totalDueCount) {
    return incompleteObservation(cutoffAt, "inconsistent_count");
  }

  const overdueProductionCount = totalDueCount - controlledTestDueCount;
  const hasValidOldest = Boolean(
    oldestProductionDue &&
      oldestProductionDue.id.trim() &&
      validDate(oldestProductionDue.run_after) &&
      Date.parse(oldestProductionDue.run_after) <= Date.parse(cutoffAt),
  );

  if (
    (overdueProductionCount === 0 && oldestProductionDue !== null) ||
    (overdueProductionCount > 0 && !hasValidOldest)
  ) {
    return incompleteObservation(cutoffAt, "inconsistent_oldest");
  }

  return {
    cutoffAt,
    state: "complete",
    overdueProductionCount,
    overdueControlledTestCount: controlledTestDueCount,
    oldestDueJobId: oldestProductionDue?.id ?? null,
    oldestDueAt: oldestProductionDue?.run_after ?? null,
    reason: null,
  };
}
