export function isAskLandingRequest(
  query: string,
  mode: string,
  selectedRunId: string | null,
) {
  return query.length === 0 && mode === "search" && !selectedRunId;
}
