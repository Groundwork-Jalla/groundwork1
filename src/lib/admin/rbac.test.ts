import { describe, expect, it } from 'vitest';
import { ADMIN_NAV } from '@/components/shell/nav-config';
import { canAccessAdminPath, filterAdminNavForRoles, parseStaffRoles, primaryStaffRole } from './rbac';
import { categorizeAuditAction } from '@/lib/supabase/activity';

describe('Wave 3 Staff RBAC (admin / ops / finance / growth)', () => {
  it('parses staff roles cleanly and keeps admin as primary superuser', () => {
    expect(parseStaffRoles('contractor, ops', false)).toEqual(['ops']);
    expect(parseStaffRoles('finance, growth', false)).toEqual(['finance', 'growth']);
    expect(parseStaffRoles('ops', true)).toEqual(['admin', 'ops']);
    expect(primaryStaffRole(['admin', 'ops'])).toBe('admin');
    expect(primaryStaffRole(['finance', 'growth'])).toBe('finance');
    expect(primaryStaffRole([])).toBeNull();
  });

  it('scopes admin routes and sidebar items accurately per role', () => {
    // Super admin sees everything
    expect(filterAdminNavForRoles(ADMIN_NAV, ['admin'])).toHaveLength(ADMIN_NAV.length);

    // OPS sees Work, People, Communication (including Live Chat), Support — not Finance or System settings
    const opsNav = filterAdminNavForRoles(ADMIN_NAV, ['ops']).map(i => i.to);
    expect(opsNav).toContain('/admin/projects');
    expect(opsNav).toContain('/admin/inbox?channel=live_chat');
    expect(opsNav).toContain('/admin/support');
    expect(opsNav).not.toContain('/admin/finance');
    expect(opsNav).not.toContain('/admin/team');

    // FINANCE sees Finance, Budgets, Projects, Audit Log — not Support or Acquisition
    const finNav = filterAdminNavForRoles(ADMIN_NAV, ['finance']).map(i => i.to);
    expect(finNav).toContain('/admin/finance');
    expect(finNav).toContain('/admin/finance/disbursements');
    expect(finNav).toContain('/admin/budgets');
    expect(finNav).toContain('/admin/audit-log');
    expect(finNav).not.toContain('/admin/support');
    expect(finNav).not.toContain('/admin/applications');

    // GROWTH sees Acquisition, Analytics, People, Communication — not Finance or System
    const growthNav = filterAdminNavForRoles(ADMIN_NAV, ['growth']).map(i => i.to);
    expect(growthNav).toContain('/admin/applications');
    expect(growthNav).toContain('/admin/analytics');
    expect(growthNav).toContain('/admin/inbox?channel=live_chat');
    expect(growthNav).not.toContain('/admin/finance');
    expect(canAccessAdminPath('/admin/settings', ['growth'])).toBe(false);
    expect(canAccessAdminPath('/admin/settings', ['admin'])).toBe(true);
  });

  it('categorizes unified audit log events cleanly', () => {
    expect(categorizeAuditAction('project_deleted', 'admin_deleted_projects')).toBe('deletion');
    expect(categorizeAuditAction('new_device', 'security_notify_log')).toBe('security');
    expect(categorizeAuditAction('payout_reference_attached', 'project_audit_log')).toBe('finance');
    expect(categorizeAuditAction('staff_role_granted', 'project_audit_log')).toBe('security');
    expect(categorizeAuditAction('stage_approved', 'project_audit_log')).toBe('project');
  });
});
