import type { AdminUser } from '@/lib/supabase/admin-users';

export type ProjectFilter = 'all' | 'no_projects' | 'has_projects';
export type RoleFilter = 'all' | 'client' | 'contractor' | 'admin';

export interface UserDirectoryFilter {
  query: string;
  projectFilter: ProjectFilter;
  roleFilter: RoleFilter;
}

export interface UserProjectSummary {
  total: number;
  withProjects: number;
  withoutProjects: number;
}

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

export function filterAdminUsers<T extends Pick<AdminUser, 'email' | 'fullName' | 'roles' | 'country' | 'projectCount'>>(
  users: readonly T[],
  filter: UserDirectoryFilter,
): T[] {
  const q = filter.query.trim().toLowerCase();
  return users.filter(u => {
    if (!matchesProjectFilter(u, filter.projectFilter)) return false;
    if (!matchesRoleFilter(u, filter.roleFilter)) return false;
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
