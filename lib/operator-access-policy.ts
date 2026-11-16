export type OperatorAccessContext = {
  role: string | null | undefined;
  setupUserEmail?: string | null;
  operatorEmails?: string[];
};

export function normalizeOperatorEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() || null;
}

export function isAllowlistedOperatorEmail(
  email: string | null | undefined,
  operatorEmails: string[],
) {
  const normalized = normalizeOperatorEmail(email);
  if (!normalized) return false;
  return operatorEmails
    .map((operatorEmail) => normalizeOperatorEmail(operatorEmail))
    .includes(normalized);
}

export function canAccessOperatorTools({
  role,
  setupUserEmail,
  operatorEmails = [],
}: OperatorAccessContext) {
  if (role === "operator") return true;
  if (role) return false;
  return isAllowlistedOperatorEmail(setupUserEmail, operatorEmails);
}

export function isOperatorMode(role: string | null | undefined) {
  return role === "operator";
}
