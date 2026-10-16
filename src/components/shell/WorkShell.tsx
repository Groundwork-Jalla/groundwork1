import type { ReactNode } from 'react';
import { LayoutDashboard, FolderOpen, ClipboardList, UserRound, Landmark, ShieldCheck } from 'lucide-react';
import { PortalShell, type PortalLink } from './PortalShell';

const links: PortalLink[] = [
  { to: '/work', label: 'contractor.nav.dashboard', icon: LayoutDashboard },
  { to: '/work/projects', label: 'contractor.nav.projects', icon: FolderOpen, matchPrefix: true },
  { to: '/work#action', label: 'contractor.needsAction.title', icon: ClipboardList },
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
