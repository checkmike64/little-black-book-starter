"use client";

import { useState } from "react";

export function VerificationCopyButton({
  text,
}: {
  text: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyText() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button className="button primary small" onClick={copyText} type="button">
      {copied ? "Copied" : "Copy packet"}
    </button>
  );
}
