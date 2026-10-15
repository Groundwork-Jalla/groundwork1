import type { ReactNode } from 'react';
import { LayoutDashboard, FolderOpen, ClipboardList, Wallet, FileText, Upload, UserRound, Landmark, ShieldCheck } from 'lucide-react';
import { PortalShell, type PortalLink } from './PortalShell';

const links: PortalLink[] = [
  { to: '/work', label: 'contractor.nav.dashboard', icon: LayoutDashboard },
  { to: '/work/projects', label: 'contractor.nav.projects', icon: FolderOpen, matchPrefix: true },
  { to: '/work#action', label: 'contractor.needsAction.title', icon: ClipboardList },
  { to: '/work#evidence', label: 'contractorDashboard.evidence', icon: Upload },
  { to: '/work#documents', label: 'contractorProject.tabDocuments', icon: FileText },
  { to: '/work#payments', label: 'contractorProject.tabPayments', icon: Wallet },
  { to: '/work/payouts', label: 'contractorPayout.title', icon: Landmark },
  // Reachable after the dashboard banner has gone. §3.3 of the partner agreement puts
  // a standing duty on contractors to keep licensing and insurance current, so the
  // page they do that on cannot only exist while they are still unfinished.
  { to: '/work/onboarding', label: 'contractorOnboarding.navLabel', icon: ShieldCheck },
  { to: '/profile', label: 'nav.viewProfile', icon: UserRound },
];

export function WorkShell({ children, displayName, onLogout, navLocked }: {
  children: ReactNode; displayName: string; onLogout: () => void; navLocked?: boolean;
}) {
  return <PortalShell home="/work" links={links} displayName={displayName} onLogout={onLogout} navLocked={navLocked}
    roleKey="contractor.surface.title" searchKey="contractorDashboard.search"
    scopeKey="contractor.dashboard.subtitle" helpTo="/help">{children}</PortalShell>;
}
