import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { dashboardForRole, type AccountRole } from '@/lib/auth/account-role';

/** Preserve initial deep links; an actual role change takes the user to their new dashboard. */
export function AccountRoleSync() {
  const { user, accountRole, loading, rolesChecked } = useAuth();
  const location = useLocation(); const navigate = useNavigate();
  const previous = useRef<{ userId: string; role: AccountRole } | null>(null);
  useEffect(() => {
    if (!user) { previous.current = null; return; }
    if (loading || !rolesChecked || !accountRole) return;
    const changed = previous.current?.userId === user.id && previous.current.role !== accountRole;
    previous.current = { userId: user.id, role: accountRole };
    const home = dashboardForRole(accountRole);
    const dashboard = ['/dashboard', '/work', '/admin', '/verifiers'].includes(location.pathname.replace(/\/$/, ''));
    if (changed || (dashboard && location.pathname.replace(/\/$/, '') !== home)) navigate(home, { replace: true });
  }, [user?.id, accountRole, loading, rolesChecked, location.pathname, navigate]);
  return null;
}
