import {
  pendingChangeSupportedFieldNames,
  pendingChangeUnsupportedKeys,
  type PendingChangeInspectionInput,
} from "./pending-change-inspection.ts";

const retiredAlternateEmailFields = new Set([
  "alt_email",
  "alt_emails",
  "alternate_email",
  "alternate_emails",
  "extra.alt_email",
  "extra.alt_emails",
]);

function normalizedFieldName(value: string) {
  return value.trim().toLowerCase();
}

function rawProposalFieldNames(payload: Record<string, unknown>) {
  const names = new Set<string>();
  if (typeof payload.field === "string") names.add(payload.field);

  for (const containerKey of ["fields", "contact", "candidate"]) {
    const container = payload[containerKey];
    if (!container || typeof container !== "object" || Array.isArray(container)) continue;

    for (const [field, value] of Object.entries(container as Record<string, unknown>)) {
      names.add(field);
      if (field === "extra" && value && typeof value === "object" && !Array.isArray(value)) {
        Object.keys(value as Record<string, unknown>).forEach((nested) => {
          names.add(`extra.${nested}`);
        });
      }
    }
  }

  return [...names];
}

export function isRetiredAlternateEmailField(value: string) {
  return retiredAlternateEmailFields.has(normalizedFieldName(value));
}

export function pendingChangeFieldPolicy(change: PendingChangeInspectionInput) {
  const supportedFields = pendingChangeSupportedFieldNames(change);
  const unsupportedFields = pendingChangeUnsupportedKeys(change);
  const retiredFields = Array.from(
    new Set([
      ...unsupportedFields.filter(isRetiredAlternateEmailField),
      ...rawProposalFieldNames(change.payload).filter(isRetiredAlternateEmailField),
    ]),
  );

  return {
    retiredFields,
    supportedFields,
    unsupportedFields,
  };
}

export function isRetiredAlternateEmailChange(change: PendingChangeInspectionInput) {
  return pendingChangeFieldPolicy(change).retiredFields.length > 0;
}
