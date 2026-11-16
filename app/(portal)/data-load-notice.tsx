import type { DataLoadHealth } from "@/lib/data-load-health";
import { RetryButton } from "@/app/(portal)/retry-button";
import Link from "next/link";

export function DataLoadNotice({
  health,
  recovery = "retry",
}: {
  health: DataLoadHealth;
  recovery?: "retry" | "claude";
}) {
  if (!health.notice) return null;

  const claudeRecovery = recovery === "claude";

  return (
    <div
      className={`notice data-load-notice ${health.isBlocked ? "is-blocker" : ""}`}
      role={health.isBlocked ? "alert" : "status"}
    >
      <div>
        <b>{health.isBlocked ? "Information is missing" : "Some information is missing"}</b>
        <span>
          {claudeRecovery
            ? "Ask your concierge team to refresh this Book in Claude."
            : "Try loading this page again before making a decision."}
        </span>
        <details className="data-load-detail">
          <summary>What is missing</summary>
          <span>{health.failed.map((item) => item.label).join(", ")}</span>
        </details>
      </div>
      <div className="data-load-actions">
        {claudeRecovery ? (
          <Link className="button ghost small" href="/support">Request a refresh</Link>
        ) : (
          <RetryButton />
        )}
      </div>
    </div>
  );
}
