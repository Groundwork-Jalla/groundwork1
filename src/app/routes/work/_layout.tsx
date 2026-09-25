import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { WorkShell } from '@/components/shell/WorkShell';

// =========================================================
// /work — the contractor's execution surface.
//
// ── The door is the ASSIGNMENT, not a privilege ──────────────────────────────────────
// A contractor is someone holding at least one accepted `contractor_invites` row. That is
// exactly what `is_contractor_on()` checks inside every RLS policy behind this surface
// (086), so the gate asks the same question the rooms do — a door opening onto reads that
// then refuse would be worse than no door.
//
// An admin is NOT admitted for being an admin. /admin oversees, /work executes; an
// operator with no site work here has nothing to do and is sent back. Someone who is both
// an operator and a real contractor is admitted, because they hold the assignment.
//
// Nothing below queries every project and narrows it in the browser: RLS returns only the
// contractor's projects, so a mistake here is an inconvenience, not a disclosure.
// =========================================================

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
