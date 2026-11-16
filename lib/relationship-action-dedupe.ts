type ExistingRelationshipAction = {
  action_type: string;
  id: string;
  status: string;
  title: string;
};

function normalizeActionTitle(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function findDuplicateOpenRelationshipAction(
  actions: ExistingRelationshipAction[],
  candidate: { actionType: string; title: string | null },
) {
  const candidateTitle = normalizeActionTitle(candidate.title);
  if (!candidateTitle) return null;

  return (
    actions.find(
      (action) =>
        ["open", "deferred"].includes(action.status) &&
        action.action_type === candidate.actionType &&
        normalizeActionTitle(action.title) === candidateTitle,
    ) ?? null
  );
}
