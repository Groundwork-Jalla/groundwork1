import { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router';
import { AppShell } from '@/components/shell/AppShell';
import { ADMIN_NAV } from '@/components/shell/nav-config';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/lib/i18n';

/**
 * Admin area. Renders the same AppShell as the client app, so it inherits the
 * mobile drawer, tab bar, top bar and theme toggle it never had — and its nav
 * labels are translated now that they come from the dictionary.
 */
export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, session, loading, isAdmin, adminChecked, signOut } = useAuth();
  const t = useT();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      // Staff entrance, not the client login — then back to the admin page they
      // were reaching for. /admin/login sits outside this layout on purpose.
      navigate(`/admin/login?redirect=${encodeURIComponent(location.pathname)}`, { replace: true });
      return;
    }
    if (adminChecked && !isAdmin) navigate('/dashboard', { replace: true });
  }, [loading, session, isAdmin, adminChecked, navigate, location.pathname]);

  if (loading || !session || !adminChecked || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-border-grey border-t-brand-near-black" />
      </div>
    );
  }

  const displayName = user?.user_metadata?.full_name
    ?? user?.email?.split('@')[0]
    ?? 'Admin';

  async function handleLogout() {
    await signOut();
    navigate('/', { replace: true });
  }

  return (
    <AppShell
      nav={ADMIN_NAV}
      displayName={displayName}
      badge={t('nav.admin')}
      onLogout={handleLogout}
    >
      <Outlet />
    </AppShell>
  );
}
