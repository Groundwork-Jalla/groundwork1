import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { AppShell } from '@/components/shell/AppShell';
import { CLIENT_NAV } from '@/components/shell/nav-config';
import { useAuth } from '@/contexts/AuthContext';
import { mustChangePassword, FORCED_PASSWORD_PATH } from '@/lib/auth/provisioned';

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

  // The sign-in pages send a provisioned account to the password form; this is what
  // stops it walking around them by typing /dashboard. Checked once per shell mount —
  // the flag only ever moves from true to false, and only when the password changes.
  useEffect(() => {
    if (!session) return;
    let alive = true;
    mustChangePassword(session.user.id).then(forced => {
      if (alive && forced) navigate(FORCED_PASSWORD_PATH, { replace: true });
    });
    return () => { alive = false; };
  }, [session, navigate]);

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
