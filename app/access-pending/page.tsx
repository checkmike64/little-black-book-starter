import { redirect } from "next/navigation";
import { signOut } from "@/app/login/actions";
import { getSupportEmail } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant-context";

export default async function AccessPendingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  if (!user) redirect("/login");
  if (await getTenantContext()) redirect("/dashboard");

  const supportEmail = getSupportEmail();

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="eyebrow">Access pending</div>
        <h1>Your private Book is not assigned yet.</h1>
        <p className="lede">
          You are signed in, but this account does not have an active client
          installation. No relationship data is available until the service
          team completes that assignment.
        </p>
        <div className="notice" role="status">
          Signed in as <b>{user.email ?? "this account"}</b>
        </div>
        <div className="form-stack compact">
          {supportEmail ? (
            <a className="button primary" href={`mailto:${supportEmail}`}>
              Contact the service team
            </a>
          ) : null}
          <form action={signOut}>
            <button className="button ghost" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
