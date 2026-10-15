import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { AppShell } from '@/components/shell/AppShell';
import { CLIENT_NAV } from '@/components/shell/nav-config';
import { useAuth } from '@/contexts/AuthContext';
import { mustChangePassword, FORCED_PASSWORD_PATH } from '@/lib/auth/provisioned';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

/**
 * Signed-in client area. The chrome lives in AppShell, which the admin area
 * renders too — see components/shell/ for why they are no longer separate.
 */
export default function ProtectedLayout() {
  const navigate = useNavigate();
  const t = useT();
  const { user, session, loading, signOut } = useAuth();
  const [passwordCheck, setPasswordCheck] = useState<{ userId: string; cleared: boolean } | null>(null);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const userId = session?.user.id;

  useEffect(() => {
    if (!loading && !session) navigate('/auth/login', { replace: true });
  }, [loading, session, navigate]);

  // The sign-in pages send a provisioned account to the password form; this is what
  // stops it walking around them by typing /dashboard. Checked once per shell mount —
  // the flag only ever moves from true to false, and only when the password changes.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    setPasswordCheck(null);
    mustChangePassword(userId).then(forced => {
      if (!alive) return;
      if (forced) navigate(FORCED_PASSWORD_PATH, { replace: true });
      else setPasswordCheck({ userId, cleared: true });
    }).catch(() => {
      if (alive) setPasswordCheck({ userId, cleared: false });
    });
    return () => { alive = false; };
  }, [userId, navigate, checkAttempt]);

  const checkedCurrentUser = passwordCheck?.userId === userId;
  if (!loading && session && checkedCurrentUser && passwordCheck?.cleared === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p role="alert" className="text-sm text-brand-mid-grey">{t('errors.generic')}</p>
        <Button onClick={() => { setPasswordCheck(null); setCheckAttempt(attempt => attempt + 1); }}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  // Do not mount the dashboard (or run any child effects) while the required password
  // setup is unresolved. A redirect alone would still expose the project for a moment.
  if (loading || !session || !checkedCurrentUser || !passwordCheck?.cleared) {
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
