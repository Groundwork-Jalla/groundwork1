import type { ReactNode } from 'react';
import { LayoutDashboard, FolderOpen, Handshake, UserRound, Landmark } from 'lucide-react';
import { PortalShell, type PortalLink } from './PortalShell';

const links: PortalLink[] = [
  { to: '/work', label: 'contractor.nav.dashboard', icon: LayoutDashboard },
  { to: '/work/projects', label: 'contractor.nav.projects', icon: FolderOpen, matchPrefix: true },
  // "Needs action" is gone (29 Oct 2026, approved with the redesign). The lit dot on a
  // build's stage pipeline IS the work: a separate task list is a second copy of the
  // same truth, and a second copy is free to disagree with the first. Everything that
  // list pointed at — rework, an unfinished stage — is on the build it belongs to.
  // `#evidence`, `#documents` and `#payments` used to sit here, pointing at anchors on
  // the dashboard that do not exist: the browser found nothing to scroll to and left you
  // on a page that was not what you clicked — reported as "it takes me to an empty page".
  //
  // They are gone rather than repointed. All three are PER PROJECT and are tabs on a
  // project, so three sidebar entries leading to the same project list would be the same
  // confusion with a different shape. Projects, above, is the way in.
  { to: '/work/payouts', label: 'contractorPayout.navLabel', icon: Landmark },
  // Verification is HIDDEN, 30 Oct 2026 — Favour: "hide verification for now". The
  // route stays: /work/onboarding is still where an unfinished contractor is sent by
  // the dashboard banner, and §3.3 of the partner agreement puts a standing duty on
  // keeping licensing current. Only the sidebar entry goes, so restoring it is this
  // one line rather than a rebuild.
  //
  // Reachable at any time, not only right after onboarding: a contractor without a
  // diaspora project today may well have one next month, and the funnel should still
  // be open to them then.
  { to: '/work/partner', label: 'partner.navLabel', icon: Handshake },
  // /work/profile, NOT /profile. The shared profile page renders inside the CLIENT
  // shell, so a contractor who opened it was dropped into a sidebar of somebody
  // else's app — Favour, 30 Oct: no button here may send them to another dashboard.
  { to: '/work/profile', label: 'contractor.nav.profile', icon: UserRound },
];

/** The four that become the phone tab bar, in the order the designs show them. */
const TABS = ['/work', '/work/projects', '/work/payouts', '/work/profile'];

export function WorkShell({ children, displayName, onLogout, navLocked, topBarActions }: {
  children: ReactNode; displayName: string; onLogout: () => void; navLocked?: boolean;
  topBarActions?: ReactNode;
}) {
  return <PortalShell home="/work" links={links} tabs={TABS} displayName={displayName} onLogout={onLogout} navLocked={navLocked} topBarActions={topBarActions}
    roleKey="contractor.surface.title" searchKey="contractorDashboard.search"
    scopeKey="contractor.dashboard.subtitle" helpTo="/work/help">{children}</PortalShell>;
}
