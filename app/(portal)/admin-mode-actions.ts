"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminToolsCookieName } from "@/lib/admin-mode";
import { getTenantContext } from "@/lib/tenant-context";

function safeNextPath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export async function setAdminToolVisibility(formData: FormData) {
  const next = safeNextPath(String(formData.get("next") ?? "/dashboard"));
  const requestedMode = String(formData.get("admin_tools") ?? "") === "show";
  const cookieStore = await cookies();
  const context = await getTenantContext();

  if (context?.role !== "operator") {
    cookieStore.delete(adminToolsCookieName);
    redirect(next);
  }

  if (requestedMode) {
    cookieStore.set(adminToolsCookieName, "show", {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  } else {
    cookieStore.delete(adminToolsCookieName);
  }

  redirect(next);
}
