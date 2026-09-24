import {
  LayoutDashboard, FolderOpen, BookOpen, HardHat, CreditCard, Bell,
  Settings, FolderArchive, HelpCircle, ClipboardCheck, Users, Wallet,
  FileText, Mailbox, FilePen, Radio, Clapperboard, LifeBuoy, MessagesSquare,
  ListChecks, Camera, SearchCheck, ListTodo, UserRound, UserCog, Handshake,
  Inbox, MessageCircle, Mail, Phone, FileQuestion, BarChart3, Plug, ShieldCheck, ScrollText,
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
  /**
   * Heading printed above this item when it differs from the item before. Groups a
   * long nav by workflow without changing its shape — `pageTitleKey` and the mobile
   * tab bar read `to`/`labelKey` only and never see it.
   */
  section?: TKey;
}

/** Client app. The first five also become the mobile tab bar. */
// Order is Favour's, set 19 Aug 2026: the money and the people move up, reference
// material moves down. Roughly how often an owner mid-build needs each one.
export const CLIENT_NAV: NavItem[] = [
  { to: '/dashboard',     labelKey: 'nav.dashboard',                               icon: LayoutDashboard, exact: true },
  { to: '/projects',      labelKey: 'nav.myProjects', shortKey: 'nav.projects',    icon: FolderOpen },
  { to: '/payments',      labelKey: 'nav.payments',                                icon: CreditCard },
  { to: '/contractors',   labelKey: 'nav.contractors',                             icon: HardHat },
  { to: '/documents',     labelKey: 'nav.documents',                               icon: FolderArchive },
  { to: '/notifications', labelKey: 'nav.notifications',                           icon: Bell },
  { to: '/resources',     labelKey: 'nav.resources',                               icon: BookOpen },
  { to: '/profile',       labelKey: 'nav.settings',                                icon: Settings, exact: true },
  // Reachable from the sidebar at last — /help was a routed page with no way in.
  { to: '/help',          labelKey: 'nav.help',                                    icon: HelpCircle },
];

// The sidebar of docs/groundwork-admin/01-information-architecture.md §2 (labels amended
// 13 Sep 2026). Eight groups; the first five items feed the mobile tab bar. Items whose
// page is not built yet point at their own URL and render an honest empty state
// (routes/admin/placeholder.tsx) — never a dead link, never invented rows.
export const ADMIN_NAV: NavItem[] = [
  { to: '/admin',                    labelKey: 'nav.overview',           icon: LayoutDashboard, exact: true, section: 'nav.sectionOverview' },
  { to: '/admin/action-center',      labelKey: 'nav.actionCenter',       icon: ListChecks },

  { to: '/admin/projects',           labelKey: 'nav.projects',           icon: FolderOpen,     section: 'nav.sectionWork' },
  { to: '/admin/reviews',            labelKey: 'nav.reviewsApprovals',   icon: ClipboardCheck },
  { to: '/admin/budgets',            labelKey: 'nav.budgets',            icon: Wallet },
  { to: '/admin/site-updates',       labelKey: 'nav.siteUpdates',        icon: Camera },
  { to: '/admin/inspections',        labelKey: 'nav.inspections',        icon: SearchCheck },
  { to: '/admin/tasks',              labelKey: 'nav.tasks',              icon: ListTodo },

  { to: '/admin/clients',            labelKey: 'nav.clients',            icon: UserRound,      section: 'nav.sectionPeople' },
  { to: '/admin/contractors',        labelKey: 'nav.contractors',        icon: HardHat },
  { to: '/admin/verifiers',          labelKey: 'nav.verifiers',          icon: ShieldCheck },
  { to: '/admin/site-managers',      labelKey: 'nav.siteManagers',       icon: UserCog },
  { to: '/admin/users',              labelKey: 'nav.users',              icon: Users },
  { to: '/admin/agents',             labelKey: 'nav.agents',             icon: Handshake },

  { to: '/admin/inbox',              labelKey: 'nav.inbox',              icon: Inbox,          section: 'nav.sectionCommunication' },
  { to: '/admin/inbox?channel=whatsapp',           labelKey: 'nav.whatsapp',           icon: MessageCircle },
  { to: '/admin/notifications',      labelKey: 'nav.notifications',      icon: Bell },
  { to: '/admin/inbox?channel=jalla',            labelKey: 'nav.jallaMessages',      icon: MessagesSquare },
  { to: '/admin/inbox?channel=email',            labelKey: 'nav.email',              icon: Mail },
  { to: '/admin/inbox?channel=call',             labelKey: 'nav.calls',              icon: Phone },

  { to: '/admin/applications',       labelKey: 'nav.applications',       icon: FileText,       section: 'nav.sectionAcquisition' },
  { to: '/admin/drafts',             labelKey: 'nav.startedApplications', icon: FilePen },
  { to: '/admin/waitlist',           labelKey: 'nav.waitlist',           icon: Mailbox },
  { to: '/admin/inquiries',          labelKey: 'nav.quoteRequests',      icon: FileQuestion },
  { to: '/admin/crm',                labelKey: 'nav.crm',                icon: Radio },

  { to: '/admin/support',            labelKey: 'nav.support',            icon: LifeBuoy,       section: 'nav.sectionSupport' },

  { to: '/admin/analytics',          labelKey: 'nav.analytics',          icon: BarChart3,      section: 'nav.sectionAnalytics' },

  { to: '/admin/integrations',       labelKey: 'nav.integrations',       icon: Plug,           section: 'nav.sectionSystem' },
  { to: '/admin/requests',           labelKey: 'nav.automationRequests', icon: Clapperboard },
  { to: '/admin/team',               labelKey: 'nav.teamPermissions',    icon: ShieldCheck },
  { to: '/admin/audit-log',          labelKey: 'nav.auditLog',           icon: ScrollText },
  { to: '/admin/settings',           labelKey: 'nav.adminSettings',      icon: Settings },
];

/**
 * Admin destinations that have a sidebar entry but no page yet. `routes/admin/placeholder.tsx`
 * answers `/admin/:section` for exactly these and 404s for anything else; each renders an
 * honest empty state and, where the information already lives somewhere, a link to it.
 * TEMPORARY by design — an entry leaves this list the day its page ships.
 */
export const ADMIN_PLACEHOLDERS: Record<string, { labelKey: TKey; existingTo?: string; existingKey?: TKey }> = {
  'inspections':   { labelKey: 'nav.inspections' },
  'tasks':         { labelKey: 'nav.tasks' },
  'site-managers': { labelKey: 'nav.siteManagers' },
  'agents':        { labelKey: 'nav.agents' },
};

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
