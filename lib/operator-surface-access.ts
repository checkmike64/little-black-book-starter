export type OperatorSurfaceRole = "owner" | "operator" | null;

export function shouldAllowOperatorSurface({
  adminMode,
  role,
  setupMode,
}: {
  adminMode: boolean;
  role: OperatorSurfaceRole;
  setupMode: boolean;
}) {
  return setupMode || (role === "operator" && adminMode);
}
