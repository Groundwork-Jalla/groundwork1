import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { WorkShell } from '@/components/shell/WorkShell';

// =========================================================
// /work — the contractor's execution surface.
//
// A contractor role or an accepted assignment opens this dashboard. New signups see
// an empty workspace until assigned. Project, evidence and payment access stays
// controlled by the existing database policies; a role alone grants no project access.

export default function WorkLayout() {
  const { session, loading, isContractor, rolesChecked, user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const allowed = isContractor;
  const resolved = rolesChecked;

  useEffect(() => {
    if (loading) return;
    if (!session) {
      navigate(`/auth/login?redirect=${encodeURIComponent(location.pathname)}`, { replace: true });
      return;
    }
    if (resolved && !allowed) navigate('/dashboard', { replace: true });
  }, [loading, session, resolved, allowed, navigate, location.pathname]);

  if (loading || !session || !resolved || !allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-off-white dark:bg-[#141414]">
        <Loader2 className="size-5 animate-spin text-brand-mid-grey" />
      </div>
    );
  }

  const displayName = (user?.user_metadata?.full_name as string | undefined)
    ?? user?.email?.split('@')[0]
    ?? '';
  return (
    <WorkShell displayName={displayName} onLogout={() => { void signOut().then(() => navigate('/', { replace: true })); }}>
      <Outlet />
    </WorkShell>
  );
}
