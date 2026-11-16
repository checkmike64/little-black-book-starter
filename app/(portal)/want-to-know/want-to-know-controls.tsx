"use client";

import type { ReactNode, RefObject } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import styles from "./want-to-know-controls.module.css";

type OpenPanel = "plan" | "more";

type DisclosureContextValue = {
  close: (restoreFocus?: boolean) => void;
  isOpen: (id: string) => boolean;
  openId: string | null;
  registerSurface: (id: string, node: HTMLElement | null) => void;
  registerTrigger: (id: string, node: HTMLButtonElement | null) => void;
  toggle: (id: string) => void;
};

const DisclosureContext = createContext<DisclosureContextValue | null>(null);

/**
 * Coordinates every person action rail on the page. There is deliberately one
 * provider around the whole register rather than one provider per row: opening
 * any Plan or More surface closes the previously open surface.
 */
export function WantToKnowDisclosureProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openIdRef = useRef<string | null>(null);
  const surfaces = useRef(new Map<string, HTMLElement>());
  const triggers = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    openIdRef.current = openId;
  }, [openId]);

  const close = useCallback((restoreFocus = false) => {
    const closingId = openIdRef.current;
    openIdRef.current = null;
    setOpenId(null);

    if (restoreFocus && closingId) {
      window.requestAnimationFrame(() => triggers.current.get(closingId)?.focus());
    }
  }, []);

  const toggle = useCallback((id: string) => {
    setOpenId((current) => {
      const next = current === id ? null : id;
      openIdRef.current = next;
      return next;
    });
  }, []);

  const registerSurface = useCallback((id: string, node: HTMLElement | null) => {
    if (node) surfaces.current.set(id, node);
    else surfaces.current.delete(id);
  }, []);

  const registerTrigger = useCallback(
    (id: string, node: HTMLButtonElement | null) => {
      if (node) triggers.current.set(id, node);
      else triggers.current.delete(id);
    },
    [],
  );

  useEffect(() => {
    let focusCloseFrame: number | null = null;

    function triggerIdFor(target: Node) {
      for (const [id, trigger] of triggers.current) {
        if (trigger.contains(target)) return id;
      }
      return null;
    }

    function closeWhenFocusLeaves(event: FocusEvent) {
      const currentId = openIdRef.current;
      if (!currentId || !(event.target instanceof Node)) return;
      if (surfaces.current.get(currentId)?.contains(event.target)) return;

      // Treat the registered triggers as one coordinated control group. Focus
      // can move between them without unmounting the panel under the pointer;
      // focus that leaves the group still light-dismisses on the next frame.
      if (triggerIdFor(event.target)) return;

      // Give a click on another disclosure time to replace the open id before
      // removing the current panel. Keyboard focus-away still closes on the
      // next frame when no replacement disclosure was activated.
      if (focusCloseFrame !== null) {
        window.cancelAnimationFrame(focusCloseFrame);
      }
      const leavingId = currentId;
      focusCloseFrame = window.requestAnimationFrame(() => {
        focusCloseFrame = null;
        if (openIdRef.current !== leavingId) return;
        const activeElement = document.activeElement;
        if (
          activeElement instanceof Node
          && surfaces.current.get(leavingId)?.contains(activeElement)
        ) return;
        close(false);
      });
    }

    function closeWhenClickLeaves(event: MouseEvent) {
      const currentId = openIdRef.current;
      if (!currentId || !(event.target instanceof Node)) return;
      // Every registered trigger owns its click. Let that handler replace the
      // open id atomically instead of treating the trigger as an outside click.
      const clickedTriggerId = triggerIdFor(event.target);
      if (clickedTriggerId) return;
      if (surfaces.current.get(currentId)?.contains(event.target)) return;
      close(false);
    }

    function closeWithEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !openIdRef.current) return;
      event.preventDefault();
      close(true);
    }

    document.addEventListener("focusin", closeWhenFocusLeaves);
    // Close on the completed click rather than pointerdown. A pointerdown on
    // another row used to remove the open panel and shift the target before
    // its click could fire, so the first panel closed without opening the next.
    document.addEventListener("click", closeWhenClickLeaves);
    document.addEventListener("keydown", closeWithEscape);

    return () => {
      if (focusCloseFrame !== null) {
        window.cancelAnimationFrame(focusCloseFrame);
      }
      document.removeEventListener("focusin", closeWhenFocusLeaves);
      document.removeEventListener("click", closeWhenClickLeaves);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [close]);

  const value = useMemo<DisclosureContextValue>(
    () => ({
      close,
      isOpen: (id) => openId === id,
      openId,
      registerSurface,
      registerTrigger,
      toggle,
    }),
    [close, openId, registerSurface, registerTrigger, toggle],
  );

  return (
    <DisclosureContext.Provider value={value}>
      {children}
    </DisclosureContext.Provider>
  );
}

function useDisclosureContext() {
  const context = useContext(DisclosureContext);
  if (!context) {
    throw new Error(
      "RelationshipActionRail must be inside WantToKnowDisclosureProvider.",
    );
  }
  return context;
}

function PlanGlyph() {
  return (
    <svg aria-hidden="true" className={styles.glyph} viewBox="0 0 18 18">
      <path d="M3 4.25h12M3 9h12M3 13.75h12" />
      <path d="M6.5 2.75v3M12 7.5v3M8.5 12.25v3" />
    </svg>
  );
}

function MoreGlyph() {
  return (
    <svg aria-hidden="true" className={styles.glyph} viewBox="0 0 18 18">
      <circle cx="4" cy="9" r="1" />
      <circle cx="9" cy="9" r="1" />
      <circle cx="14" cy="9" r="1" />
    </svg>
  );
}

function RecordGlyph() {
  return (
    <svg aria-hidden="true" className={styles.recordGlyph} viewBox="0 0 18 18">
      <path d="M4 2.75h7.25L14 5.5v9.75H4z" />
      <path d="M11.25 2.75V5.5H14M6.75 9h4.5M6.75 12h3.25" />
    </svg>
  );
}

function AddGlyph() {
  return (
    <svg aria-hidden="true" className={styles.glyph} viewBox="0 0 18 18">
      <path d="M9 3.25v11.5M3.25 9h11.5" />
    </svg>
  );
}

function TuneGlyph() {
  return (
    <svg aria-hidden="true" className={styles.glyph} viewBox="0 0 18 18">
      <path d="M3 5h12M3 13h12M6.25 3v4M11.75 11v4" />
    </svg>
  );
}

function DisclosureButton({
  buttonRef,
  compact = false,
  controls,
  icon,
  label,
  open,
  onClick,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  compact?: boolean;
  controls: string;
  icon: ReactNode;
  label: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-controls={controls}
      aria-expanded={open}
      className={styles.disclosureButton}
      data-open={open ? "true" : "false"}
      onClick={onClick}
      ref={buttonRef}
      type="button"
    >
      {icon}
      <span className={compact ? styles.visuallyHidden : undefined}>{label}</span>
    </button>
  );
}

export function WorkspaceDisclosure({
  children,
  id,
  label,
  tone = "quiet",
}: {
  children: ReactNode;
  id: string;
  label: string;
  tone?: "accent" | "quiet";
}) {
  const reactId = useId().replaceAll(":", "");
  const disclosureId = `workspace:${id}`;
  const panelId = `workspace-panel-${reactId}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const { close, isOpen, registerSurface, registerTrigger, toggle } =
    useDisclosureContext();
  const open = isOpen(disclosureId);

  useEffect(() => {
    registerSurface(disclosureId, surface.current);
    registerTrigger(disclosureId, trigger.current);
    return () => {
      registerSurface(disclosureId, null);
      registerTrigger(disclosureId, null);
    };
  }, [disclosureId, registerSurface, registerTrigger]);

  return (
    <div className={styles.workspaceDisclosure} ref={surface}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className={tone === "accent" ? styles.accentButton : styles.disclosureButton}
        data-open={open ? "true" : "false"}
        onClick={() => toggle(disclosureId)}
        ref={trigger}
        type="button"
      >
        {tone === "accent" ? <AddGlyph /> : <TuneGlyph />}
        <span>{label}</span>
      </button>
      {open ? (
        <section
          aria-label={label}
          className={`${styles.panel} ${styles.workspacePanel}`}
          id={panelId}
          onSubmitCapture={() => close(false)}
        >
          <div aria-hidden="true" className={styles.registrationLine} />
          {children}
        </section>
      ) : null}
    </div>
  );
}

export function RelationshipActionRail({
  id,
  moreContent,
  personName,
  planContent,
  profileHref,
  profileLabel = "Open record",
  compact = false,
}: {
  compact?: boolean;
  id: string;
  moreContent?: ReactNode;
  personName: string;
  planContent?: ReactNode;
  profileHref?: string;
  profileLabel?: string;
}) {
  const reactId = useId().replaceAll(":", "");
  const planId = `${id}:plan`;
  const moreId = `${id}:more`;
  const planPanelId = `relationship-plan-${reactId}`;
  const morePanelId = `relationship-more-${reactId}`;
  const planTrigger = useRef<HTMLButtonElement>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const {
    close,
    isOpen,
    registerSurface,
    registerTrigger,
    toggle,
  } = useDisclosureContext();
  const planOpen = isOpen(planId);
  const moreOpen = isOpen(moreId);
  const openPanel: OpenPanel | null = planOpen ? "plan" : moreOpen ? "more" : null;

  useEffect(() => {
    registerSurface(planId, rail.current);
    registerSurface(moreId, rail.current);
    registerTrigger(planId, planTrigger.current);
    registerTrigger(moreId, moreTrigger.current);

    return () => {
      registerSurface(planId, null);
      registerSurface(moreId, null);
      registerTrigger(planId, null);
      registerTrigger(moreId, null);
    };
  }, [moreId, planId, registerSurface, registerTrigger]);

  return (
    <div className={styles.actionRail} ref={rail}>
      {profileHref ? (
        <Link
          aria-label={`${profileLabel} for ${personName}`}
          className={styles.recordLink}
          href={profileHref}
        >
          <RecordGlyph />
          <span>{profileLabel}</span>
        </Link>
      ) : null}
      {planContent ? (
        <DisclosureButton
          buttonRef={planTrigger}
          controls={planPanelId}
          icon={<PlanGlyph />}
          label="Plan"
          onClick={() => toggle(planId)}
          open={planOpen}
        />
      ) : null}
      {moreContent ? (
        <DisclosureButton
          buttonRef={moreTrigger}
          compact={compact}
          controls={morePanelId}
          icon={<MoreGlyph />}
          label="More"
          onClick={() => toggle(moreId)}
          open={moreOpen}
        />
      ) : null}

      {openPanel ? (
        <section
          aria-label={`${openPanel === "plan" ? "Relationship plan" : "More actions"} for ${personName}`}
          className={styles.panel}
          id={openPanel === "plan" ? planPanelId : morePanelId}
          onSubmitCapture={() => close(false)}
        >
          <div aria-hidden="true" className={styles.registrationLine} />
          {openPanel === "plan" ? planContent : moreContent}
        </section>
      ) : null}
    </div>
  );
}
