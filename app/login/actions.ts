"use server";

import { redirect } from "next/navigation";
import { authErrorMessage, loginPathWithMessage } from "@/lib/auth-messages";
import { safeReturnPath } from "@/lib/return-path";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function loginPathWithEmail(message: string, next: string, email: string) {
  const path = loginPathWithMessage(message, next);
  if (!email) return path;
  const [pathname, existingQuery = ""] = path.split("?", 2);
  const query = new URLSearchParams(existingQuery);
  query.set("email", email);
  return `${pathname}?${query.toString()}`;
}

export async function signInWithEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = safeReturnPath(formData.get("next"), "/dashboard");
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirect(loginPathWithMessage("missing-env", next));
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL
    ? process.env.NEXT_PUBLIC_SITE_URL
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      shouldCreateUser: false,
    },
  });

  if (error) {
    redirect(loginPathWithEmail(authErrorMessage(error), next, email));
  }

  redirect(loginPathWithEmail("check-email", next, email));
}

export async function verifyEmailCode(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = String(formData.get("token") ?? "").replace(/\s+/g, "");
  const next = safeReturnPath(formData.get("next"), "/dashboard");
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirect(loginPathWithMessage("missing-env", next));
  }

  if (!email || !token) {
    redirect(
      loginPathWithEmail(
        "Enter the email and code from the latest sign-in email.",
        next,
        email,
      ),
    );
  }

  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (error) {
    redirect(loginPathWithEmail(authErrorMessage(error), next, email));
  }

  redirect(next);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  redirect("/login");
}
