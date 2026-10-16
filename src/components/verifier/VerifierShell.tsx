import type { ReactNode } from 'react';
import { LayoutDashboard, ClipboardList, CalendarDays, Files, History, Layers, Settings } from 'lucide-react';
import { PortalShell, type PortalLink } from '@/components/shell/PortalShell';

const links: PortalLink[] = [
  { to: '/verifiers', label: 'nav.dashboard', icon: LayoutDashboard },
  // The builds they are on. First, because it is the thing that exists before any
  // stage has been submitted — and for a newly assigned verifier it is the only
  // thing there is.
  { to: '/verifiers#projects', label: 'verifier.dashboard.myProjects', icon: Layers },
  { to: '/verifiers#assignments', label: 'verifier.dashboard.assignments', icon: ClipboardList },
  { to: '/verifiers#visits', label: 'verifier.dashboard.visits', icon: CalendarDays },
  { to: '/verifiers#review', label: 'verifier.dashboard.workspace', icon: Files },
  { to: '/verifiers#decisions', label: 'verifier.dashboard.recent', icon: History },
  // Their own profile. A verifier had no way to change their name or phone —
  // and the phone is what WhatsApp delivery depends on.
  { to: '/verifiers/settings', label: 'nav.settings', icon: Settings },
];

export function VerifierShell({ children, displayName, onLogout, topBarActions }: {
  children: ReactNode; displayName: string; onLogout: () => void;
  /** The notification bell. 123 writes rows for a verifier like anybody else;
   *  without this they were written and had nowhere to appear. */
  topBarActions?: ReactNode;
}) {
  return <PortalShell home="/verifiers" links={links} displayName={displayName} onLogout={onLogout}
    topBarActions={topBarActions}
    roleKey="verifier.surface.title" searchKey="verifier.dashboard.search"
    scopeKey="verifier.dashboard.scope">{children}</PortalShell>;
}
