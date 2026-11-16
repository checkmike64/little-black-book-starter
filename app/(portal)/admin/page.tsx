import Link from "next/link";
import { requireOperatorAccess } from "@/lib/operator-access";

const controlCenterLinks = [
  {
    href: "/admin/preinstall",
    label: "Pre-install review",
    detail:
      "Separate exact identity matches from decisions that still need owner judgment or source material.",
  },
  {
    href: "/recordings",
    label: "Recording administration",
    detail:
      "Review meeting-source connections, import status, delivery health, and operator setup.",
  },
  {
    href: "/support",
    label: "Support",
    detail:
      "Verify the owner-safe support contact and request guidance rendered by this install.",
  },
  {
    href: "/deployment",
    label: "Production signoff",
    detail:
      "Review technical readiness and attach external evidence IDs to every operator-held launch check.",
  },
  {
    href: "/export",
    label: "Export and offboarding preflight",
    detail:
      "Inspect the portable export scope, exclusions, caps, and failures before preparing offboarding evidence.",
  },
  {
    href: "/ops",
    label: "Operations",
    detail:
      "Review automation health, processing queues, and work that needs operator attention.",
  },
  {
    href: "/quality",
    label: "Data quality",
    detail:
      "Review cleanup work and relationship-data integrity before handoff or export.",
  },
] as const;

export default async function AdminPage() {
  await requireOperatorAccess();

  return (
    <>
      <div className="topbar">
        <div>
          <div className="crumb">Client Admin</div>
          <h1 className="portal-title">Control Center</h1>
          <p className="lede">
            Operator-only shortcuts for support, launch evidence, operations,
            quality, and offboarding preparation. This page does not change
            client data or complete a production signoff.
          </p>
        </div>
      </div>

      <section className="grid two" aria-label="Operator controls">
        {controlCenterLinks.map((item) => (
          <article className="card" key={item.href}>
            <h2>{item.label}</h2>
            <p>{item.detail}</p>
            <div className="actions">
              <Link className="button ghost" href={item.href}>
                Open {item.label}
              </Link>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
