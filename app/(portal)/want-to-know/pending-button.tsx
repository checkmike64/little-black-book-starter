"use client";

import { useFormStatus } from "react-dom";

export function PendingButton({
  className,
  label,
  pendingLabel,
}: {
  className: string;
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button aria-disabled={pending} className={className} disabled={pending} type="submit">
      {pending ? pendingLabel : label}
    </button>
  );
}
