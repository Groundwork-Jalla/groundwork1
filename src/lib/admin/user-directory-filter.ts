import type { AdminUser } from '@/lib/supabase/admin-users';

export type ProjectFilter = 'all' | 'no_projects' | 'has_projects';
export type RoleFilter = 'all' | 'client' | 'contractor' | 'admin';
export type JoinedFilter = 'all' | 'older_than_7d' | 'last_7d';

export interface UserDirectoryFilter {
  query: string;
  projectFilter: ProjectFilter;
  roleFilter: RoleFilter;
  joinedFilter?: JoinedFilter;
  nowMs?: number;
}

export interface UserProjectSummary {
  total: number;
  withProjects: number;
  withoutProjects: number;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function roleList(roles: string): string[] {
  return roles
    .split(',')
    .map(r => r.trim().toLowerCase())
    .filter(Boolean);
}

export function matchesRoleFilter(user: Pick<AdminUser, 'roles'>, roleFilter: RoleFilter): boolean {
  if (roleFilter === 'all') return true;
  const list = roleList(user.roles);
  if (roleFilter === 'admin') return list.includes('admin');
  if (roleFilter === 'contractor') return list.includes('contractor');
  // Plain Homeowner / client accounts hold no contractor or admin role (migration 032).
  return !list.includes('contractor') && !list.includes('admin');
}

export function matchesProjectFilter(
  user: Pick<AdminUser, 'projectCount'>,
  projectFilter: ProjectFilter,
): boolean {
  if (projectFilter === 'no_projects') return user.projectCount === 0;
  if (projectFilter === 'has_projects') return user.projectCount > 0;
  return true;
}

export function isJoinedWithinDays(createdAt: string, days = 7, nowMs = Date.now()): boolean {
  const ts = Date.parse(createdAt);
  if (!Number.isFinite(ts)) return false;
  return nowMs - ts < days * 24 * 60 * 60 * 1000;
}

export function matchesJoinedFilter(
  user: Pick<AdminUser, 'createdAt'>,
  joinedFilter: JoinedFilter = 'all',
  nowMs = Date.now(),
): boolean {
  if (joinedFilter === 'all') return true;
  const ts = Date.parse(user.createdAt);
  if (!Number.isFinite(ts)) return joinedFilter === 'older_than_7d';
  const recent = nowMs - ts < SEVEN_DAYS_MS;
  return joinedFilter === 'last_7d' ? recent : !recent;
}

export function filterAdminUsers<T extends Pick<AdminUser, 'email' | 'fullName' | 'roles' | 'country' | 'projectCount'> & Partial<Pick<AdminUser, 'createdAt'>>>(
  users: readonly T[],
  filter: UserDirectoryFilter,
): T[] {
  const q = filter.query.trim().toLowerCase();
  const joinedFilter = filter.joinedFilter ?? 'all';
  const nowMs = filter.nowMs ?? Date.now();
  return users.filter(u => {
    if (!matchesProjectFilter(u, filter.projectFilter)) return false;
    if (!matchesRoleFilter(u, filter.roleFilter)) return false;
    if (joinedFilter !== 'all' && !matchesJoinedFilter({ createdAt: u.createdAt ?? '' }, joinedFilter, nowMs)) {
      return false;
    }
    if (!q) return true;
    return (
      u.email.toLowerCase().includes(q)
      || u.fullName.toLowerCase().includes(q)
      || u.roles.toLowerCase().includes(q)
      || u.country.toLowerCase().includes(q)
    );
  });
}

export function summarizeUserProjects(
  users: readonly Pick<AdminUser, 'projectCount'>[],
): UserProjectSummary {
  let withProjects = 0;
  let withoutProjects = 0;
  for (const u of users) {
    if (u.projectCount > 0) withProjects++;
    else withoutProjects++;
  }
  return {
    total: users.length,
    withProjects,
    withoutProjects,
  };
}
