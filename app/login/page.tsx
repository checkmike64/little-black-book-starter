import { KeyRound, LockKeyhole } from "lucide-react";
import { loginMessageFor } from "@/lib/auth-messages";
import { signInWithEmail, verifyEmailCode } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{
    email?: string;
    message?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const message = loginMessageFor(params.message);
  const email = params.email?.trim().toLowerCase() ?? "";

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="eyebrow">Private Access</div>
        <h1>Little Black Book</h1>
        <p className="lede">
          A private relationship operating system for one carefully configured
          client install.
        </p>

        <form className="form-stack" action={signInWithEmail}>
          <input type="hidden" name="next" value={params.next ?? "/dashboard"} />
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              defaultValue={email}
              required
              placeholder="you@example.com"
            />
          </div>
          <button className="button primary" type="submit">
            <LockKeyhole aria-hidden="true" size={15} />
            Send sign-in link
          </button>
        </form>

        <div className="login-divider" aria-hidden="true" />

        <form className="form-stack compact" action={verifyEmailCode}>
          <input type="hidden" name="next" value={params.next ?? "/dashboard"} />
          {email ? <input type="hidden" name="email" value={email} /> : null}
          {email ? (
            <p className="login-email-context">
              Enter the latest code sent to <b>{email}</b>.{" "}
              <a href="/login">Use a different email</a>
            </p>
          ) : null}
          <div className={email ? "form-grid" : "form-grid two-fields"}>
            {!email ? (
              <div className="field">
                <label htmlFor="code-email">Email</label>
                <input
                  id="code-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                />
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="token">Code</label>
              <input
                id="token"
                name="token"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                placeholder="123456"
              />
            </div>
          </div>
          <button className="button ghost" type="submit">
            <KeyRound aria-hidden="true" size={15} />
            Enter email code
          </button>
        </form>

        {message ? (
          <div
            className={`notice login-notice ${message.tone === "error" ? "is-error" : ""}`}
            role={message.tone === "error" ? "alert" : "status"}
          >
            {message.text}
          </div>
        ) : null}
      </section>
    </main>
  );
}
