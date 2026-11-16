export type DataLoadHealthInput = {
  key: string;
  label: string;
  error?: unknown;
  blocksSurface?: boolean;
};

export type DataLoadHealth = {
  hasFailures: boolean;
  isBlocked: boolean;
  failed: Array<{ key: string; label: string }>;
  blocking: Array<{ key: string; label: string }>;
  notice: string | null;
};

function hasLoadError(error: unknown) {
  return Boolean(error);
}

export function buildDataLoadHealth(scope: string, items: DataLoadHealthInput[]): DataLoadHealth {
  const failed = items
    .filter((item) => hasLoadError(item.error))
    .map(({ key, label }) => ({ key, label }));
  const blocking = items
    .filter((item) => item.blocksSurface && hasLoadError(item.error))
    .map(({ key, label }) => ({ key, label }));

  if (failed.length === 0) {
    return {
      hasFailures: false,
      isBlocked: false,
      failed,
      blocking,
      notice: null,
    };
  }

  const failedLabels = failed.map((item) => item.label).join(", ");
  const notice =
    blocking.length > 0
      ? `${scope} could not load core data (${failedLabels}). Available records are shown only where they were safely loaded.`
      : `${scope} partially loaded. Missing signals: ${failedLabels}. Available records are shown, and unavailable signals are not treated as clear.`;

  return {
    hasFailures: true,
    isBlocked: blocking.length > 0,
    failed,
    blocking,
    notice,
  };
}
