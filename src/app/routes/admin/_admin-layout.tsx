import { useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { ADMIN_NAV } from '@/components/shell/nav-config';
import { AdminTopBarActions } from '@/components/admin/AdminTopBarActions';
import { AdminSearch } from '@/components/admin/AdminSearch';
import { canAccessAdminPath, filterAdminNavForRoles, primaryStaffRole } from '@/lib/admin/rbac';
import { useAuth } from '@/contexts/AuthContext';
import { useT, type TKey } from '@/lib/i18n';

/**
 * Admin area. Renders the same AppShell as the client app, with Wave 3 Staff RBAC
 * role-scoped navigation (`admin`, `ops`, `finance`, `growth`).
 */
export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, session, loading, isAdmin, isStaff, staffRoles, adminChecked, signOut } = useAuth();
  const t = useT();

  const hasStaffAccess = isAdmin || isStaff;
  const scopedNav = useMemo(
    () => filterAdminNavForRoles(ADMIN_NAV, staffRoles.length > 0 ? staffRoles : (isAdmin ? ['admin'] : [])),
    [staffRoles, isAdmin],
  );
  const allowed = canAccessAdminPath(location.pathname, staffRoles.length > 0 ? staffRoles : (isAdmin ? ['admin'] : []));
  const roleBadgeKey = primaryStaffRole(staffRoles.length > 0 ? staffRoles : (isAdmin ? ['admin'] : []));

  useEffect(() => {
    if (loading) return;
    if (!session) {
      // Staff entrance, not the client login — then back to the admin page they
      // were reaching for. /admin/login sits outside this layout on purpose.
      navigate(`/admin/login?redirect=${encodeURIComponent(location.pathname)}`, { replace: true });
      return;
    }
    if (adminChecked && !hasStaffAccess) navigate('/dashboard', { replace: true });
  }, [loading, session, hasStaffAccess, adminChecked, navigate, location.pathname]);

  if (loading || !session || !adminChecked || !hasStaffAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-border-grey border-t-brand-near-black" />
      </div>
    );
  }

  // The account's real name, then the address it signs in with, then the role. NEVER the
  // local part of the address: capitalising it produced "Phavorfavor", which is nobody.
  const displayName = user?.user_metadata?.full_name?.trim()
    || user?.email
    || 'Admin';

  async function handleLogout() {
    await signOut();
    navigate('/', { replace: true });
  }

  return (
    <AppShell
      nav={scopedNav}
      displayName={displayName}
      badge={roleBadgeKey ? t(`admin.team.roles.${roleBadgeKey}` as TKey) : t('nav.admin')}
      // The admin sidebar in the new theme (18 Nov): green highlight, dropdown groups.
      sidebarStyle="calm"
      onLogout={handleLogout}
      topBarActions={<AdminTopBarActions userId={user?.id ?? ''} />}
      topBarSearch={<AdminSearch />}
    >
      {allowed ? (
        <Outlet />
      ) : (
        <div className="mx-auto max-w-lg px-6 py-16 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-state-held/15 text-state-held">
            <ShieldAlert className="size-5" aria-hidden />
          </div>
          <h1 className="mt-4 text-lg font-bold text-brand-near-black dark:text-white">{t('admin.team.restrictedTitle')}</h1>
          <p className="mt-1.5 text-sm text-brand-mid-grey">{t('admin.team.restrictedBody')}</p>
        </div>
      )}
    </AppShell>
  );
}
