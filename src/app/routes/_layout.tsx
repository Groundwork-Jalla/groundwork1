import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { AppShell } from '@/components/shell/AppShell';
import { CLIENT_NAV } from '@/components/shell/nav-config';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Signed-in client area. The chrome lives in AppShell, which the admin area
 * renders too — see components/shell/ for why they are no longer separate.
 */
export default function ProtectedLayout() {
  const navigate = useNavigate();
  const { user, session, loading, signOut } = useAuth();

  useEffect(() => {
    if (!loading && !session) navigate('/auth/login', { replace: true });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-border-grey border-t-brand-near-black" />
      </div>
    );
  }

  const displayName = user?.user_metadata?.full_name
    ?? user?.email?.split('@')[0]
    ?? 'You';

  async function handleLogout() {
    await signOut();
    navigate('/', { replace: true });
  }

  return (
    <AppShell
      nav={CLIENT_NAV}
      displayName={displayName}
      profileTo="/profile"
      userCaptionKey="nav.viewProfile"
      onLogout={handleLogout}
      topBarActions={<NotificationBell userId={user?.id ?? ''} />}
    >
      <Outlet />
    </AppShell>
  );
}
