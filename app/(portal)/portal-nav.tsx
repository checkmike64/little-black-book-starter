"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  featureModules,
  ownerNavigationModuleKeys,
  type ModuleKey,
} from "@/lib/modules";
import {
  shouldShowOperatorTools,
  type PortalRole,
} from "@/lib/portal-nav-visibility";

type LedgerNavItem = {
  href: string;
  label: string;
  count?: number;
  module?: ModuleKey | null;
};

const coreNav: LedgerNavItem[] = [
  { href: "/dashboard", label: "Today" },
  { href: "/contacts", label: "My Book" },
];

const clientUtilityNav: LedgerNavItem[] = [
  { href: "/promises", label: "Promises", module: "networking" },
  { href: "/changes", label: "Changes", module: null },
];

const operatorNav: LedgerNavItem[] = [
  { href: "/intake", label: "Client Intake" },
  { href: "/admin", label: "Client Admin" },
  { href: "/recordings", label: "Recordings" },
  { href: "/claude-setup", label: "Claude Setup" },
  { href: "/ops", label: "Ops" },
  { href: "/quality", label: "Quality" },
  { href: "/launch", label: "Launch" },
  { href: "/deployment", label: "Deployment" },
  { href: "/export", label: "Export" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function LedgerLinkState({ count }: { count: number }) {
  const { pending } = useLinkStatus();

  return (
    <span
      className={`nav-link-state${pending ? " is-pending" : ""}`}
      data-pending={pending ? "true" : undefined}
    >
      {count > 0 ? (
        <span className="nav-count" aria-label={`${count} pending`}>
          {count}
        </span>
      ) : null}
      <span className="nav-pending-rule" aria-hidden="true" />
      <span className="visually-hidden" aria-live="polite">
        {pending ? "Opening page" : ""}
      </span>
    </span>
  );
}

export function PortalNav({
  adminMode,
  enabledModules,
  role,
  setupMode,
  networkingCount,
  engagementCount,
  promisesCount,
  changesCount,
}: {
  adminMode: boolean;
  enabledModules: ModuleKey[];
  role: PortalRole;
  setupMode: boolean;
  networkingCount: number;
  engagementCount: number;
  promisesCount: number;
  changesCount: number;
}) {
  const pathname = usePathname() ?? "";
  const enabled = new Set(enabledModules);
  const showOperatorTools = shouldShowOperatorTools({
    adminMode,
    role,
    setupMode,
  });
  const featureNav: LedgerNavItem[] = featureModules
    .filter(
      (module) =>
        enabled.has(module.key) && ownerNavigationModuleKeys.includes(module.key),
    )
    .map((module) => ({
      href: module.href,
      label: module.label,
      count:
        module.key === "networking"
          ? networkingCount
          : module.key === "engagement"
            ? engagementCount
            : 0,
    }));
  const visibleClientUtilityNav = clientUtilityNav.filter(
    (item) => item.module === null || enabled.has(item.module as ModuleKey),
  ).map((item) => ({
    ...item,
    count:
      item.href === "/promises"
        ? promisesCount
        : item.href === "/changes"
          ? changesCount
          : 0,
  }));
  const ownerNav = [...coreNav, ...featureNav, ...visibleClientUtilityNav];
  const operatorActive = operatorNav.some((item) => isActive(pathname, item.href));

  function navLink(item: LedgerNavItem) {
    const active = isActive(pathname, item.href);

    return (
      <Link
        aria-current={active ? "page" : undefined}
        className={active ? "active" : undefined}
        href={item.href}
        key={item.href}
      >
        <span className="nav-label">{item.label}</span>
        <LedgerLinkState count={item.count ?? 0} />
      </Link>
    );
  }

  return (
    <nav className="nav" aria-label="Primary navigation">
      {ownerNav.map(navLink)}
      {showOperatorTools ? (
        <details
          className="nav-management"
          {...(operatorActive ? { open: true } : {})}
        >
          <summary className={operatorActive ? "active" : undefined}>
            <span className="nav-label">Management</span>
          </summary>
          <div className="nav-management-links">
            {operatorNav.map(navLink)}
          </div>
        </details>
      ) : null}
    </nav>
  );
}
