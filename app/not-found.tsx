import { ArrowLeft, BookOpen } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="login-page">
      <section className="login-panel route-state standalone-route-state">
        <div className="route-state-icon" aria-hidden="true">
          <BookOpen />
        </div>
        <div>
          <div className="section-label">Private page unavailable</div>
          <h1>This page is not part of your Book.</h1>
          <p>
            The address may be old, or this area may not be included in the current
            private workspace.
          </p>
        </div>
        <Link className="button primary" href="/dashboard">
          <ArrowLeft aria-hidden="true" size={15} />
          Return to Today
        </Link>
      </section>
    </main>
  );
}
