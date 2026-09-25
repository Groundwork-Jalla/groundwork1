import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { VerifierShell } from '@/components/verifier/VerifierShell';

// =========================================================
// /verifiers — the independent verifier's surface (06 §22).
//
// ── A different product from /admin ──────────────────────────────────────────────────
// Groundwork has three surfaces over one core model: /admin operates, /contractors
// deliver, /verifiers verify. This one exists so an assigned verifier can do their job
// without being handed the operator's console: no portfolio, no client list, no
// financials, no assignment controls, no approvals. What they can do — record the
// finding on a verification assigned to them — is what the database already allows them
// to do (087 `record_verification`), and nothing more.
//
// ── The gate is a courtesy, not the protection ───────────────────────────────────────
// This layout redirects someone without the role, but the isolation that matters is in
// the database: a verifier is a `project_member` only of projects they are actively
// assigned to (086), so every read below is already bounded by RLS. A bug here would be
// an inconvenience, not a disclosure.
// =========================================================

export default function VerifiersLayout() {
  const { session, loading, isVerifier, rolesChecked, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // ── The door is the ROLE, not the privilege ────────────────────────────────────────
  // An admin can read every verification row in the database, and that is not the same
  // thing as belonging on the verifier's surface. /admin oversees, /verifiers verifies;
  // an operator who is not also an appointed verifier has no work here and is sent back.
  // Someone who holds both roles is let in — because they hold the role, not because
  // they are an admin — while post-auth still prefers /admin for them.
  const allowed = isVerifier;
  const resolved = rolesChecked;

  useEffect(() => {
    if (loading) return;
    if (!session) { navigate(`/auth/login?redirect=${encodeURIComponent(location.pathname)}`, { replace: true }); return; }
    if (resolved && !allowed) navigate('/dashboard', { replace: true });
  }, [loading, session, resolved, allowed, navigate, location.pathname]);

  if (loading || !session || !resolved || !allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-off-white dark:bg-[#141414]">
        <Loader2 className="size-5 animate-spin text-brand-mid-grey" />
      </div>
    );
  }

  const displayName = (session.user.user_metadata?.full_name as string | undefined)
    ?? session.user.email?.split('@')[0] ?? '';
  return (
    <VerifierShell displayName={displayName} onLogout={() => { void signOut().then(() => navigate('/auth/login', { replace: true })); }}>
      <Outlet />
    </VerifierShell>
  );
}
