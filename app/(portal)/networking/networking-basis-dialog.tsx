"use client";

import { Info, X } from "lucide-react";
import { useRef } from "react";

export function NetworkingBasisDialog({
  personA,
  personB,
  fit,
  personABasis,
  personBBasis,
  sharedGroups,
}: {
  personA: string;
  personB: string;
  fit: string;
  personABasis: string;
  personBBasis: string;
  sharedGroups: string[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        aria-label={`Why ${personA} and ${personB} may be a useful introduction`}
        className="basis-info-button"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        <Info aria-hidden="true" size={16} />
      </button>
      <dialog className="basis-dialog" ref={dialogRef}>
        <div className="basis-dialog-head">
          <h2>Introduction basis</h2>
          <button
            aria-label="Close introduction basis"
            className="basis-dialog-close"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <dl className="basis-dialog-facts">
          <div><dt>Match</dt><dd>{fit}</dd></div>
          <div><dt>{personA}</dt><dd>{personABasis}</dd></div>
          <div><dt>{personB}</dt><dd>{personBBasis}</dd></div>
          {sharedGroups.length > 0 ? (
            <div><dt>Shared groups</dt><dd>{sharedGroups.join(" · ")}</dd></div>
          ) : null}
        </dl>
      </dialog>
    </>
  );
}
