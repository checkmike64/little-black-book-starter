"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type QualityCleanupQueueButtonProps = {
  className?: string;
  contactIds: string[];
  label: string;
  note?: string;
};

export function QualityCleanupQueueButton({
  className = "button hot",
  contactIds,
  label,
  note,
}: QualityCleanupQueueButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function queueCleanup() {
    setError(null);
    setIsPending(true);

    try {
      const body = new URLSearchParams();
      contactIds.forEach((contactId) => body.append("contact_id", contactId));
      body.set("contact_ids", contactIds.join(","));

      const response = await fetch("/quality/queue", {
        body,
        method: "POST",
        redirect: "follow",
      });

      if (!response.ok) {
        setError("Cleanup queue request failed. Please try again.");
        return;
      }

      const destination = new URL(response.url || "/quality", window.location.origin);
      router.replace(`${destination.pathname}${destination.search}`);
    } catch {
      setError("Cleanup queue request failed. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      <button
        className={className}
        disabled={isPending || contactIds.length === 0}
        onClick={queueCleanup}
        type="button"
      >
        {isPending ? "Queueing…" : label}
      </button>
      {note ? <span className="source-note">{note}</span> : null}
      {error ? <span className="source-note" role="alert">{error}</span> : null}
    </>
  );
}
