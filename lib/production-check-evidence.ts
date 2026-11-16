export const productionEvidenceRefMinLength = 6;
export const productionEvidenceRefMaxLength = 500;

export type ProductionCheckRecord = {
  confirmed: boolean;
  confirmed_at: string | null;
  confirmed_by: string | null;
  evidence_ref: string | null;
};

export type ProductionCheckSubmission =
  | { ok: true; confirmed: boolean; evidenceRef: string | null }
  | { ok: false; message: string };

export function normalizeProductionEvidenceRef(value: unknown) {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (
    normalized.length < productionEvidenceRefMinLength ||
    normalized.length > productionEvidenceRefMaxLength ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(normalized) ||
    /^(?:https?|file):\/\//i.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function parseProductionCheckSubmission({
  confirmed,
  evidenceRef,
}: {
  confirmed: boolean;
  evidenceRef: unknown;
}): ProductionCheckSubmission {
  if (!confirmed) {
    return {
      ok: true,
      confirmed: false,
      evidenceRef: null,
    };
  }

  const normalizedEvidenceRef = normalizeProductionEvidenceRef(evidenceRef);
  if (!normalizedEvidenceRef) {
    return {
      ok: false,
      message:
        "Enter an opaque external evidence ID using letters, numbers, dots, colons, slashes, underscores, or hyphens.",
    };
  }

  return {
    ok: true,
    confirmed: true,
    evidenceRef: normalizedEvidenceRef,
  };
}
