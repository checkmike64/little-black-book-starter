export type RehearsalStep = {
  phase: string;
  label: string;
  owner: "Operator" | "Supabase" | "Vercel" | "Claude" | "Client";
  detail: string;
  evidence: string;
};

export const rehearsalCommand =
  'pnpm rehearsal';

export const liveSmokeCommand =
  'pnpm smoke:live https://CLIENT_DOMAIN';

export const clientInstallRehearsal: RehearsalStep[] = [
  {
    phase: "Preflight",
    label: "Run local checks",
    owner: "Operator",
    detail:
      "Run the app build checks and the install rehearsal script before creating or touching a client project.",
    evidence: "`pnpm check` and `pnpm rehearsal` both pass.",
  },
  {
    phase: "Supabase",
    label: "Create isolated project",
    owner: "Supabase",
    detail:
      "Create one Supabase project per client and apply the reviewed migrations in order.",
    evidence: "Client project has its own URL, publishable key, and service-role key.",
  },
  {
    phase: "Supabase",
    label: "Bootstrap tenant membership",
    owner: "Operator",
    detail:
      "Create the executive owner user, tenant row, and tenant_members row before inviting or adding an optional operator.",
    evidence: "Owner and operator can sign in; owner sees only this tenant's data.",
  },
  {
    phase: "Supabase",
    label: "Verify RLS and Data API",
    owner: "Supabase",
    detail:
      "Confirm every public table has RLS enabled, authenticated grants are intentional, and anon cannot read private rows.",
    evidence: "Supabase advisors reviewed and signed-out table reads do not expose rows.",
  },
  {
    phase: "Vercel",
    label: "Set environment variables",
    owner: "Vercel",
    detail:
      "Set browser-safe Supabase values plus server-only service-role and Claude write secrets.",
    evidence: "/deployment shows no blocking environment warnings.",
  },
  {
    phase: "Vercel",
    label: "Confirm privacy posture",
    owner: "Operator",
    detail:
      "Check auth redirects, no-index headers, robots.txt, and protected previews before sharing URLs.",
    evidence:
      "`pnpm smoke:live https://CLIENT_DOMAIN` passes; signed-out private routes redirect to /login and responses include X-Robots-Tag.",
  },
  {
    phase: "Claude",
    label: "Install Claude instructions",
    owner: "Claude",
    detail:
      "Give the client Claude project only the app endpoints and Claude write token, never Supabase service-role credentials.",
    evidence: "Claude can claim/test a job and submit pending changes through the gateway.",
  },
  {
    phase: "Client",
    label: "Acceptance pass",
    owner: "Client",
    detail:
      "Validate real data in My Book, Ask, Engagement, Networking, Changes, and contact detail before production use.",
    evidence: "A low-risk pending change is approved and an audit/provenance trail exists.",
  },
];

export function rehearsalPhaseCounts() {
  const phases = new Set(clientInstallRehearsal.map((step) => step.phase));
  return {
    phases: phases.size,
    steps: clientInstallRehearsal.length,
  };
}
