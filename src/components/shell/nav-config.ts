import {
  LayoutDashboard, FolderOpen, BookOpen, HardHat, CreditCard, Bell,
  Settings, FolderArchive, HelpCircle, ClipboardCheck, Users, Wallet,
} from 'lucide-react';
import type { TKey } from '@/lib/i18n';

// =========================================================
// The navigation each shell renders.
//
// Kept as data, apart from the components, for two reasons: the sidebar, the
// mobile drawer and the mobile tab bar must never disagree about what exists,
// and the admin shell must be describable in the same shape as the client one
// so both can share a single implementation.
//
// `labelKey` is a TKey rather than a string — that is what stops a nav item
// shipping untranslated, since `fr.ts` is typed Mirror<EnDict> and tsc fails on
// a key that only exists in one language.
// =========================================================

export interface NavItem {
  to: string;
  labelKey: TKey;
  /** Shorter label for the mobile tab bar, where width is ~64px. */
  shortKey?: TKey;
  icon: typeof LayoutDashboard;
  /** Match this path exactly rather than by prefix. */
  exact?: boolean;
}

/** Client app. The first five also become the mobile tab bar. */
export const CLIENT_NAV: NavItem[] = [
  { to: '/dashboard',     labelKey: 'nav.dashboard',                               icon: LayoutDashboard, exact: true },
  { to: '/projects',      labelKey: 'nav.myProjects', shortKey: 'nav.projects',    icon: FolderOpen },
  { to: '/documents',     labelKey: 'nav.documents',                               icon: FolderArchive },
  { to: '/resources',     labelKey: 'nav.resources',                               icon: BookOpen },
  { to: '/contractors',   labelKey: 'nav.contractors',                             icon: HardHat },
  { to: '/payments',      labelKey: 'nav.payments',                                icon: CreditCard },
  { to: '/notifications', labelKey: 'nav.notifications',                           icon: Bell },
  { to: '/profile',       labelKey: 'nav.settings',                                icon: Settings, exact: true },
  // Reachable from the sidebar at last — /help was a routed page with no way in.
  { to: '/help',          labelKey: 'nav.help',                                    icon: HelpCircle },
];

export const ADMIN_NAV: NavItem[] = [
  { to: '/admin',             labelKey: 'nav.overview',    icon: LayoutDashboard, exact: true },
  { to: '/admin/reviews',     labelKey: 'nav.reviews',     icon: ClipboardCheck },
  { to: '/admin/budgets',     labelKey: 'nav.budgets',     icon: Wallet },
  { to: '/admin/projects',    labelKey: 'nav.projects',    icon: FolderOpen },
  { to: '/admin/users',       labelKey: 'nav.users',       icon: Users },
  { to: '/admin/contractors', labelKey: 'nav.contractors', icon: HardHat },
];

/**
 * Title shown in the top bar. Longest match wins, so `/projects/:id` resolves to
 * "My Projects" rather than falling through to the brand name.
 */
export function pageTitleKey(pathname: string, nav: NavItem[]): TKey {
  const match = [...nav]
    .sort((a, b) => b.to.length - a.to.length)
    .find(item => (item.exact ? pathname === item.to : pathname.startsWith(item.to)));

  if (match) return match.labelKey;
  if (pathname.startsWith('/upgrade')) return 'nav.upgradePlan';
  return 'nav.groundwork';
}
