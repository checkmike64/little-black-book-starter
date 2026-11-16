"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

type PendingSubmitButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "type"
> & {
  children: ReactNode;
  pendingLabel: string;
};

export function PendingSubmitButton({
  children,
  disabled,
  pendingLabel,
  ...props
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      {...props}
      aria-busy={pending || undefined}
      className={`${props.className ?? ""} pending-submit-button`.trim()}
      data-pending={pending ? "true" : undefined}
      disabled={disabled || pending}
      type="submit"
    >
      <span aria-hidden="true" className="pending-submit-resting">
        {children}
      </span>
      <span
        aria-hidden="true"
        className="pending-submit-active"
      >
        <span aria-hidden="true" className="pending-submit-mark" />
        {pendingLabel}
      </span>
      <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {pending ? pendingLabel : ""}
      </span>
    </button>
  );
}
