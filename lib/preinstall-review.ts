import {
  contactDuplicateInputFromPayload,
  findExactIdentityDuplicate,
  type ContactDuplicateRecord,
} from "./contact-duplicate-detection.ts";
import { isNewPersonChangeType } from "./pending-change-types.ts";

export type PreinstallPendingChange = {
  id: string;
  change_type: string;
  summary: string;
  payload: Record<string, unknown>;
  source: string | null;
  created_at: string;
};

export type PreinstallEnrichmentJob = {
  id: string;
  status: string;
  attempts: number;
  run_after: string;
  payload: Record<string, unknown>;
};

export type ExactCandidateReview<T extends ContactDuplicateRecord> = {
  change: PreinstallPendingChange;
  contact: T;
  reason: "Exact name and email match";
};

export type IdentityCandidateReview = {
  change: PreinstallPendingChange;
  proposedName: string;
};

function proposedCandidateName(change: PreinstallPendingChange) {
  const input = contactDuplicateInputFromPayload(change.payload);
  return input.full_name?.trim() || "New person proposal";
}

function cleanSourceText(value: unknown) {
  return typeof value === "string" && value.trim().length >= 20;
}

export function hasEmbeddedEnrichmentSource(payload: Record<string, unknown>) {
  return [
    payload.source_material,
    payload.source_context,
    payload.evidence_excerpt,
    payload.transcript_excerpt,
    payload.owner_note,
  ].some(cleanSourceText);
}

export function buildPreinstallReview<T extends ContactDuplicateRecord>({
  changes,
  contacts,
  jobs,
  now = Date.now(),
}: {
  changes: PreinstallPendingChange[];
  contacts: T[];
  jobs: PreinstallEnrichmentJob[];
  now?: number;
}) {
  const exactCandidates: ExactCandidateReview<T>[] = [];
  const identityReview: IdentityCandidateReview[] = [];
  const operatorRepairs: PreinstallPendingChange[] = [];

  for (const change of changes) {
    if (isNewPersonChangeType(change.change_type)) {
      const exact = findExactIdentityDuplicate(
        contactDuplicateInputFromPayload(change.payload),
        contacts,
      );
      if (exact) {
        exactCandidates.push({
          change,
          contact: exact.contact,
          reason: exact.reason,
        });
      } else {
        identityReview.push({ change, proposedName: proposedCandidateName(change) });
      }
      continue;
    }

    if (change.change_type === "want_to_know_candidate") {
      identityReview.push({ change, proposedName: proposedCandidateName(change) });
      continue;
    }

    operatorRepairs.push(change);
  }

  const dueJobs = jobs
    .filter((job) => {
      const dueAt = Date.parse(job.run_after);
      return Number.isFinite(dueAt) && dueAt <= now;
    })
    .map((job) => ({
      ...job,
      sourceReady: hasEmbeddedEnrichmentSource(job.payload),
    }));

  return {
    exactCandidates,
    identityReview,
    operatorRepairs,
    dueJobs,
    sourceBlockedJobs: dueJobs.filter((job) => !job.sourceReady),
  };
}
