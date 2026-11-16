"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { IntroductionDraftStatus } from "@/lib/introduction-draft-state";

const REFRESH_INTERVAL_MS = 2_500;
const MAX_AUTOMATIC_REFRESHES = 20;

function isActive(status: string) {
  return status === "queued" || status === "running";
}

function terminalMessage(status: string) {
  if (status === "ready") return "The draft is ready.";
  if (status === "failed" || status === "stale") {
    return "The draft needs attention.";
  }
  return "The draft request changed. Loading its current state.";
}

export function IntroductionDraftRefresh({
  initialStatus,
  introductionId,
  requestId,
}: {
  initialStatus: IntroductionDraftStatus;
  introductionId: string;
  requestId: string;
}) {
  const router = useRouter();
  const refreshCount = useRef(0);
  const checkingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const terminalRefreshTimer = useRef<number | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    isActive(initialStatus)
      ? "The page will update when the draft is ready."
      : terminalMessage(initialStatus),
  );
  const [showManualControl, setShowManualControl] = useState(false);
  const [terminalPendingRefresh, setTerminalPendingRefresh] = useState(false);
  const [isRefreshing, startTransition] = useTransition();

  const refreshPage = useCallback(() => {
    if (terminalRefreshTimer.current !== null) {
      window.clearTimeout(terminalRefreshTimer.current);
      terminalRefreshTimer.current = null;
    }
    setShowManualControl(false);
    startTransition(() => router.refresh());
  }, [router]);

  const checkStatus = useCallback(
    async (manual = false) => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      const controller = new AbortController();
      activeRequest.current = controller;
      try {
        const response = await fetch(
          `/api/introduction-drafts/${encodeURIComponent(introductionId)}/status?request_id=${encodeURIComponent(requestId)}`,
          {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          },
        );
        const body = (await response.json().catch(() => null)) as
          | { status?: string }
          | null;
        const nextStatus = body?.status ?? "unavailable";
        if (!response.ok) {
          if (manual) {
            setStatusMessage("The draft status could not be checked.");
            setShowManualControl(true);
          }
          return;
        }
        if (isActive(nextStatus)) return;

        setStatusMessage(terminalMessage(nextStatus));
        const controlHasFocus = Boolean(
          containerRef.current?.contains(document.activeElement),
        );
        if (manual || controlHasFocus) {
          setTerminalPendingRefresh(true);
          setShowManualControl(true);
          return;
        }
        terminalRefreshTimer.current = window.setTimeout(() => {
          terminalRefreshTimer.current = null;
          refreshPage();
        }, 600);
      } catch {
        if (controller.signal.aborted) return;
        if (manual) {
          setStatusMessage("The draft status could not be checked.");
          setShowManualControl(true);
        }
      } finally {
        if (activeRequest.current === controller) activeRequest.current = null;
        checkingRef.current = false;
      }
    },
    [introductionId, refreshPage, requestId],
  );

  useEffect(() => {
    if (!isActive(initialStatus)) return;
    refreshCount.current = 0;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible" || checkingRef.current) return;
      refreshCount.current += 1;
      void checkStatus(false);
      if (refreshCount.current >= MAX_AUTOMATIC_REFRESHES) {
        window.clearInterval(interval);
        setStatusMessage("The draft is taking longer than usual.");
        setShowManualControl(true);
      }
    }, REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      if (terminalRefreshTimer.current !== null) {
        window.clearTimeout(terminalRefreshTimer.current);
      }
      activeRequest.current?.abort();
    };
  }, [checkStatus, initialStatus]);

  const active = isActive(initialStatus);
  const visuallyHidden = !active && !showManualControl;

  return (
    <div
      className={visuallyHidden ? "sr-only" : "introduction-draft-refresh"}
      ref={containerRef}
    >
      <span aria-live="polite" role="status">{statusMessage}</span>
      {showManualControl ? (
        <button
          className="button small quiet"
          disabled={isRefreshing}
          onClick={() => {
            if (terminalPendingRefresh) refreshPage();
            else void checkStatus(true);
          }}
          type="button"
        >
          {isRefreshing
            ? "Loading…"
            : terminalPendingRefresh
              ? "Show draft"
              : "Check now"}
        </button>
      ) : null}
    </div>
  );
}
