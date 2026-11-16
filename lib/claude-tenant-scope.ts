export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function resolveClaudeTenantId(
  requestedTenantId?: string | null,
  defaultTenantId?: string | null,
  requireDefaultTenant = false,
) {
  const requested = requestedTenantId?.trim() || null;
  const defaultTenant = defaultTenantId?.trim() || null;

  if (requireDefaultTenant && !defaultTenant) return null;

  if (defaultTenant) {
    if (!isUuid(defaultTenant)) return null;
    if (requested && requested !== defaultTenant) return null;
    return defaultTenant;
  }

  return requested && isUuid(requested) ? requested : null;
}
