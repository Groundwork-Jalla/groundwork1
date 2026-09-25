import type { ReactNode } from 'react';
import { LayoutDashboard, FolderOpen, ClipboardList, Wallet, FileText, Upload, UserRound } from 'lucide-react';
import { PortalShell, type PortalLink } from './PortalShell';

const links: PortalLink[] = [
  { to: '/work', label: 'contractor.nav.dashboard', icon: LayoutDashboard },
  { to: '/work/projects', label: 'contractor.nav.projects', icon: FolderOpen, matchPrefix: true },
  { to: '/work#action', label: 'contractor.needsAction.title', icon: ClipboardList },
  { to: '/work#evidence', label: 'contractorDashboard.evidence', icon: Upload },
  { to: '/work#documents', label: 'contractorProject.tabDocuments', icon: FileText },
  { to: '/work#payments', label: 'contractorProject.tabPayments', icon: Wallet },
  { to: '/profile', label: 'nav.viewProfile', icon: UserRound },
];

export function WorkShell({ children, displayName, onLogout }: {
  children: ReactNode; displayName: string; onLogout: () => void;
}) {
  return <PortalShell home="/work" links={links} displayName={displayName} onLogout={onLogout}
    roleKey="contractor.surface.title" searchKey="contractorDashboard.search"
    scopeKey="contractor.dashboard.subtitle" helpTo="/help">{children}</PortalShell>;
}
