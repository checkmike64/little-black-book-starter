"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RetryButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      className="button small ghost"
      disabled={isPending}
      onClick={() => startTransition(() => router.refresh())}
      type="button"
    >
      <RotateCcw aria-hidden="true" size={13} />
      {isPending ? "Trying again..." : "Try again"}
    </button>
  );
}
