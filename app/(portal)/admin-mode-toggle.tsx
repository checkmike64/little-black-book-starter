"use client";

import { ShieldCheck } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { setAdminToolVisibility } from "@/app/(portal)/admin-mode-actions";

export function AdminModeToggle({ adminMode }: { adminMode: boolean }) {
  const pathname = usePathname() ?? "/dashboard";
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const next = query ? `${pathname}?${query}` : pathname;

  return (
    <form action={setAdminToolVisibility} className="admin-mode-form">
      <input
        name="admin_tools"
        type="hidden"
        value={adminMode ? "hide" : "show"}
      />
      <input name="next" type="hidden" value={next} />
      <button className="button quiet admin-mode-button" type="submit">
        <ShieldCheck aria-hidden={true} />
        {adminMode ? "Hide management tools" : "Show management tools"}
      </button>
      <div className="admin-mode-note">
        {adminMode
          ? "Management navigation is visible."
          : "Executive navigation is active."}
      </div>
    </form>
  );
}
