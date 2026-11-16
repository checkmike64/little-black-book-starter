export const adminToolsCookieName = "lbb_admin_tools";

export type AdminModeRole = "owner" | "operator" | null | undefined;

export function shouldUseAdminTools({
  cookieValue,
  role,
  setupMode = false,
}: {
  cookieValue?: string | null;
  role: AdminModeRole;
  setupMode?: boolean;
}) {
  return setupMode || (role === "operator" && cookieValue === "show");
}
