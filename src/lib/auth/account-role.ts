export const ACCOUNT_ROLE_CHANGED = 'groundwork:account-role-changed';
export const ACCOUNT_ROLES = ['client', 'contractor', 'verifier', 'admin'] as const;
export type AccountRole = typeof ACCOUNT_ROLES[number];
export function isAccountRole(value: unknown): value is AccountRole {
  return typeof value === 'string' && ACCOUNT_ROLES.some(role => role === value);
}
export function accountRoleOf(roles: string): AccountRole {
  const held = roles.split(',').map(role => role.trim());
  return held.includes('admin') ? 'admin' : held.includes('verifier') ? 'verifier' : held.includes('contractor') ? 'contractor' : 'client';
}
export function dashboardForRole(role: AccountRole): string {
  return role === 'admin' ? '/admin' : role === 'verifier' ? '/verifiers' : role === 'contractor' ? '/work' : '/dashboard';
}
export function roleAssignmentMatches(roles: string, role: AccountRole): boolean {
  const held = roles.split(',').map(value => value.trim()).filter(Boolean);
  return held.length === 1 && held[0] === (role === 'client' ? 'homeowner' : role);
}
