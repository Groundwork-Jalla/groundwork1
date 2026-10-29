import type { ReactNode } from 'react';
import { LayoutDashboard, FolderOpen, Handshake, UserRound, Landmark, ShieldCheck } from 'lucide-react';
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
  { to: '/work/payouts', label: 'contractorPayout.title', icon: Landmark },
  // Reachable after the dashboard banner has gone. §3.3 of the partner agreement puts
  // a standing duty on contractors to keep licensing and insurance current, so the
  // page they do that on cannot only exist while they are still unfinished.
  { to: '/work/onboarding', label: 'contractorOnboarding.navLabel', icon: ShieldCheck },
  // Reachable at any time, not only right after onboarding: a contractor without a
  // diaspora project today may well have one next month, and the funnel should still
  // be open to them then.
  { to: '/work/partner', label: 'partner.navLabel', icon: Handshake },
  { to: '/profile', label: 'nav.viewProfile', icon: UserRound },
];

export function WorkShell({ children, displayName, onLogout, navLocked, topBarActions }: {
  children: ReactNode; displayName: string; onLogout: () => void; navLocked?: boolean;
  topBarActions?: ReactNode;
}) {
  return <PortalShell home="/work" links={links} displayName={displayName} onLogout={onLogout} navLocked={navLocked} topBarActions={topBarActions}
    roleKey="contractor.surface.title" searchKey="contractorDashboard.search"
    scopeKey="contractor.dashboard.subtitle" helpTo="/help">{children}</PortalShell>;
}
