"use client";

import { Home, RotateCcw } from "lucide-react";
import Link from "next/link";

export default function PortalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="route-state" role="alert">
      <div className="route-state-icon" aria-hidden="true">
        <RotateCcw />
      </div>
      <div>
        <div className="section-label">Private workspace interrupted</div>
        <h1>This view could not be opened safely.</h1>
        <p>
          Nothing was changed. Try the view again, or return to Today while the
          connection recovers.
        </p>
      </div>
      <div className="actions">
        <button className="button hot" onClick={reset} type="button">
          <RotateCcw aria-hidden="true" size={15} />
          Try again
        </button>
        <Link className="button ghost" href="/dashboard">
          <Home aria-hidden="true" size={15} />
          Return to Today
        </Link>
      </div>
    </div>
  );
}
