import type {
  ProductionCheckKey,
  ProductionCheckItem,
} from "./deployment-readiness.ts";
import type { ProductionCheckRecord } from "./production-check-evidence.ts";

export type PreinstallEvidenceLane = "technical" | "client";
export type PreinstallEvidenceStatus =
  | "confirmed"
  | "evidence_needed"
  | "not_confirmed";

export type PreinstallEvidencePlanItem = ProductionCheckItem & {
  lane: PreinstallEvidenceLane;
  status: PreinstallEvidenceStatus;
  statusLabel: string;
  evidenceNeeded: string;
  href: string;
  actionLabel: string;
};

const evidenceInstructions: Record<
  ProductionCheckKey,
  {
    lane: PreinstallEvidenceLane;
    evidenceNeeded: string;
    href: string;
    actionLabel: string;
  }
> = {
  supabase_project_isolated: {
    lane: "technical",
    evidenceNeeded:
      "A restricted receipt naming the isolated project, tenant, Auth scope, and review date.",
    href: "/deployment",
    actionLabel: "Review environment",
  },
  rls_data_api_reviewed: {
    lane: "technical",
    evidenceNeeded:
      "A current RLS, Data API grant, signed-out access, and security-advisor review receipt.",
    href: "/deployment",
    actionLabel: "Review security",
  },
  preview_protection_enabled: {
    lane: "technical",
    evidenceNeeded:
      "A dated request or deployment receipt showing that the preview requires authorized access.",
    href: "/deployment",
    actionLabel: "Review preview",
  },
  claude_token_scoped: {
    lane: "technical",
    evidenceNeeded:
      "A scope exercise showing separate read, job, and write credentials with no Supabase admin key.",
    href: "/claude-setup",
    actionLabel: "Review Claude setup",
  },
  auth_email_template_ready: {
    lane: "technical",
    evidenceNeeded:
      "A current delivery and fallback-code sign-in exercise receipt for the production Auth setup.",
    href: "/deployment",
    actionLabel: "Review Auth",
  },
  commercial_agreement_signed: {
    lane: "client",
    evidenceNeeded:
      "The signed agreement reference and exact version or effective date in the restricted client packet.",
    href: "/deployment",
    actionLabel: "Record agreement evidence",
  },
  billing_owner_and_collection_ready: {
    lane: "client",
    evidenceNeeded:
      "The private-invoice authorization, billing owner, backup contact, and collection process reference.",
    href: "/deployment",
    actionLabel: "Record billing evidence",
  },
  support_contact_and_process_ready: {
    lane: "client",
    evidenceNeeded:
      "The approved support procedure, triage owner, escalation path, and exercise receipt reference.",
    href: "/support",
    actionLabel: "Review support",
  },
  backup_and_restore_proven: {
    lane: "client",
    evidenceNeeded:
      "A provider backup reference plus a current isolated-restore receipt covering database, Auth, Storage, Vault, and runtime controls.",
    href: "/export",
    actionLabel: "Prepare restore evidence",
  },
  retention_and_offboarding_ready: {
    lane: "client",
    evidenceNeeded:
      "The approved retention matrix and offboarding plan reference for this exact install.",
    href: "/export",
    actionLabel: "Prepare offboarding evidence",
  },
  owner_acceptance_recorded: {
    lane: "client",
    evidenceNeeded:
      "A signed-in owner review and acceptance receipt tied to the production release.",
    href: "/launch/preview",
    actionLabel: "Open owner preview",
  },
};

function itemStatus(record: ProductionCheckRecord | undefined) {
  if (record?.confirmed === true && record.evidence_ref) {
    return {
      status: "confirmed" as const,
      statusLabel: "Confirmed",
    };
  }

  if (record?.confirmed === true) {
    return {
      status: "evidence_needed" as const,
      statusLabel: "Evidence ID needed",
    };
  }

  return {
    status: "not_confirmed" as const,
    statusLabel: "Not confirmed",
  };
}

export function buildPreinstallEvidencePlan({
  checks,
  records,
}: {
  checks: ProductionCheckItem[];
  records: Record<string, ProductionCheckRecord>;
}) {
  const items = checks.map((check) => ({
    ...check,
    ...evidenceInstructions[check.key],
    ...itemStatus(records[check.key]),
  })) satisfies PreinstallEvidencePlanItem[];

  const technical = items.filter((item) => item.lane === "technical");
  const client = items.filter((item) => item.lane === "client");
  const confirmed = items.filter((item) => item.status === "confirmed").length;
  const evidenceNeeded = items.filter(
    (item) => item.status === "evidence_needed",
  ).length;
  const next =
    technical.find((item) => item.status !== "confirmed") ??
    client.find((item) => item.status !== "confirmed") ??
    null;

  return {
    items,
    technical,
    client,
    confirmed,
    total: items.length,
    evidenceNeeded,
    next,
    ready: confirmed === items.length,
  };
}
