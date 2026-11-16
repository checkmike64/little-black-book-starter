export type PortalRole = "owner" | "operator" | null;

export function shouldShowOperatorTools({
  adminMode,
  role,
  setupMode,
}: {
  adminMode?: boolean;
  role: PortalRole;
  setupMode: boolean;
}) {
  return setupMode || (role === "operator" && adminMode === true);
}
