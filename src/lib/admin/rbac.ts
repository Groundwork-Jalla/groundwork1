import type { NavItem } from '@/components/shell/nav-config';

// =========================================================
// Staff Role-Based Access Control (Wave 3 — 20 Nov 2026).
//
// Four staff roles:
//   - admin   : full platform control (deletions, RBAC, finance overrides, settings)
//   - ops     : projects, reviews, site updates, inbox, live chat, whatsapp, support
//   - finance : inflows, disbursements, budgets, audit log, read-only project overview
//   - growth  : acquisition, applications, waitlist, sequences, inquiries, CRM, analytics
//
// `admin` is always a superset of every domain. Pure helpers live here so sidebar
// filtering, route gating, and role badges stay 100% consistent and unit-testable.
// =========================================================

export type StaffRole = 'admin' | 'ops' | 'finance' | 'growth';

export const STAFF_ROLES: StaffRole[] = ['admin', 'ops', 'finance', 'growth'];

export function parseStaffRoles(rolesCsv: string | null | undefined, isAdminFlag = false): StaffRole[] {
  const tokens = (rolesCsv ?? '')
    .split(',')
    .map(r => r.trim().toLowerCase())
    .filter(Boolean);
  const found = new Set<StaffRole>();
  if (isAdminFlag) found.add('admin');
  for (const token of tokens) {
    if ((STAFF_ROLES as string[]).includes(token)) {
      found.add(token as StaffRole);
    }
  }
  return STAFF_ROLES.filter(r => found.has(r));
}

export function primaryStaffRole(roles: StaffRole[]): StaffRole | null {
  if (roles.includes('admin')) return 'admin';
  return roles[0] ?? null;
}

/** Which staff roles may access a given admin route path (excluding superuser `admin`, who accesses all). */
export function allowedRolesForAdminPath(to: string): StaffRole[] {
  const path = to.split('?')[0];
  if (path === '/admin' || path === '/admin/action-center') {
    return ['admin', 'ops', 'finance', 'growth'];
  }
  if (path.startsWith('/admin/finance') || path === '/admin/budgets') {
    return ['admin', 'finance'];
  }
  if (path === '/admin/projects' || path.startsWith('/admin/projects/')) {
    return ['admin', 'ops', 'finance'];
  }
  if (
    path === '/admin/reviews'
    || path === '/admin/site-updates'
    || path === '/admin/support'
    || path === '/admin/verifiers'
  ) {
    return ['admin', 'ops'];
  }
  if (
    path === '/admin/clients'
    || path.startsWith('/admin/contractors')
    || path === '/admin/partners'
    || path === '/admin/users'
    || path.startsWith('/admin/users/')
  ) {
    return ['admin', 'ops', 'growth'];
  }
  if (path === '/admin/inbox' || path === '/admin/notifications') {
    return ['admin', 'ops', 'growth'];
  }
  if (
    path.startsWith('/admin/applications')
    || path === '/admin/drafts'
    || path === '/admin/waitlist'
    || path === '/admin/sequences'
    || path === '/admin/inquiries'
    || path === '/admin/crm'
    || path === '/admin/analytics'
  ) {
    return ['admin', 'growth'];
  }
  if (path === '/admin/audit-log') {
    return ['admin', 'ops', 'finance'];
  }
  // /admin/team, /admin/settings, /admin/integrations, /admin/requests -> super admin only
  return ['admin'];
}

export function canAccessAdminPath(pathname: string, roles: StaffRole[]): boolean {
  if (roles.includes('admin')) return true;
  if (roles.length === 0) return false;
  const allowed = allowedRolesForAdminPath(pathname);
  return roles.some(r => allowed.includes(r));
}

/**
 * Filter ADMIN_NAV to items permitted for `roles`, preserving section headings cleanly
 * even when the original first item of a section was filtered out.
 */
export function filterAdminNavForRoles(nav: NavItem[], roles: StaffRole[]): NavItem[] {
  if (roles.includes('admin')) return nav;
  if (roles.length === 0) return [];

  let currentSection: NavItem['section'];
  let emittedSection: NavItem['section'];
  const out: NavItem[] = [];

  for (const item of nav) {
    if (item.section) currentSection = item.section;
    if (!canAccessAdminPath(item.to, roles)) continue;
    const needsSection = currentSection && currentSection !== emittedSection;
    out.push(needsSection ? { ...item, section: currentSection } : { ...item, section: undefined });
    emittedSection = currentSection;
  }
  return out;
}
