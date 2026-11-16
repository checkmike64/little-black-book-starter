import { pendingChangeSupportedFieldNames } from "./pending-change-inspection.ts";

export type GroupableProfileChange = {
  id: string;
  contact_id: string | null;
  change_type: string;
  source: string | null;
  payload?: Record<string, unknown> | null;
};

export function isGroupableProfileChange(row: GroupableProfileChange) {
  return Boolean(row.contact_id)
    && ["field_update", "contact_enrichment"].includes(row.change_type)
    && row.source !== "recording_baseline";
}

export function profileChangeGroups<T extends GroupableProfileChange>(rows: T[]) {
  const groups = new Map<string, T[]>();

  for (const row of rows) {
    const key = isGroupableProfileChange(row)
      ? `contact:${row.contact_id}`
      : `change:${row.id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.entries()].map(([key, groupedRows]) => ({
    key,
    rows: groupedRows,
  }));
}

export function ownerChangeDecisionCount(rows: GroupableProfileChange[]) {
  return profileChangeGroups(rows).length;
}

export function ownerChangedPeopleCount(rows: GroupableProfileChange[]) {
  const people = new Set<string>();

  for (const row of rows) {
    people.add(row.contact_id ? `contact:${row.contact_id}` : `change:${row.id}`);
  }

  return people.size;
}

export function ownerChangeUnitCount(rows: GroupableProfileChange[]) {
  return rows.reduce((count, row) => {
    if (!isGroupableProfileChange(row)) return count + 1;

    const supportedFields = pendingChangeSupportedFieldNames({
      change_type: row.change_type,
      payload: row.payload ?? {},
    });

    // A malformed or retired proposal can still require an owner decision.
    // Count it once so the navigation never hides work that remains visible.
    return count + Math.max(1, supportedFields.length);
  }, 0);
}
