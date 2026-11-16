const CLOCK_SKEW_ALLOWANCE_MS = 5 * 60 * 1000;

export function canAdvanceLastSpoke(
  occurredAt: string,
  now = new Date(),
) {
  const occurredAtMs = Date.parse(occurredAt);

  return (
    Number.isFinite(occurredAtMs) &&
    occurredAtMs <= now.getTime() + CLOCK_SKEW_ALLOWANCE_MS
  );
}
