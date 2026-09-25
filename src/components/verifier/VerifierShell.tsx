import type { ReactNode } from 'react';
import { LayoutDashboard, ClipboardList, CalendarDays, Files, History } from 'lucide-react';
import { PortalShell, type PortalLink } from '@/components/shell/PortalShell';

const links: PortalLink[] = [
  { to: '/verifiers', label: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/verifiers#assignments', label: 'verifier.dashboard.assignments', icon: ClipboardList },
  { to: '/verifiers#visits', label: 'verifier.dashboard.visits', icon: CalendarDays },
  { to: '/verifiers#review', label: 'verifier.dashboard.workspace', icon: Files },
  { to: '/verifiers#decisions', label: 'verifier.dashboard.recent', icon: History },
];

export function VerifierShell({ children, displayName, onLogout }: {
  children: ReactNode; displayName: string; onLogout: () => void;
}) {
  return <PortalShell home="/verifiers" links={links} displayName={displayName} onLogout={onLogout}
    roleKey="verifier.surface.title" searchKey="verifier.dashboard.search"
    scopeKey="verifier.dashboard.scope">{children}</PortalShell>;
}
