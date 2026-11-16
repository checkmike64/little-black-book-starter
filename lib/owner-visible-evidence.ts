export type EvidenceWithType = {
  type: string;
};

export function ownerVisibleEvidence<T extends EvidenceWithType>(
  rows: T[],
  adminMode: boolean,
) {
  if (adminMode) return rows;
  return rows.filter((row) => row.type !== "job" && row.type !== "command");
}
