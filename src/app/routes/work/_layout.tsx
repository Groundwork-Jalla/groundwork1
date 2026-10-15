import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { WorkShell } from '@/components/shell/WorkShell';
import { fetchOnboardingStatus, onboardingAvailable } from '@/lib/supabase/contractor-onboarding';

// =========================================================
// /work — the contractor's execution surface.
//
// A contractor role or an accepted assignment opens this dashboard. New signups see
// an empty workspace until assigned. Project, evidence and payment access stays
// controlled by the existing database policies; a role alone grants no project access.
//
// ── Signing up ends in the agreement, not on the dashboard ───────────────────────────
// Whoever comes through /contractor-signup is sent here by the callback. Until the
// partner agreement is signed, everything under /work redirects to /work/onboarding, so
// the agreement is what somebody meets on the way in rather than a banner they can
// ignore. §3.2 is the warrant: Jalla may withhold activation until the required forms
// are complete.
//
// Doing it in the layout rather than at each landing site means signup, a later
// sign-in, and a typed URL all behave the same — there is one gate, not five.
//
// ── It gates on the AGREEMENT, not on the whole sequence ─────────────────────────────
// Deliberate. Somebody who has not signed has no business on the platform at all. But a
// contractor already on a site, who has signed and simply has not got round to their
// third emergency contact, must still be able to post evidence for somebody's build —
// locking them out would punish the client. The remaining steps are chased by the
// dashboard banner instead.
// =========================================================

/** null = still looking, or the feature is not on this database. */
type Gate = { signed: boolean } | null;

export default function WorkLayout() {
  const { session, loading, isContractor, rolesChecked, user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [gate, setGate] = useState<Gate>(null);

  const allowed = isContractor;
  const resolved = rolesChecked;
  const onOnboarding = location.pathname.startsWith('/work/onboarding');

  useEffect(() => {
    if (loading) return;
    if (!session) {
      navigate(`/auth/login?redirect=${encodeURIComponent(location.pathname)}`, { replace: true });
      return;
    }
    if (resolved && !allowed) navigate('/dashboard', { replace: true });
  }, [loading, session, resolved, allowed, navigate, location.pathname]);

  // Has the agreement been signed? Asked once the role is settled, and never allowed to
  // fail closed: a read that errors, or a database without 116, leaves the surface open.
  // Locking a working contractor out because a request timed out would be worse than
  // letting an unsigned one through.
  //
  // `onOnboarding` is in the dependency list on purpose. Without it the answer is
  // fetched once and never again — so a contractor who signed the agreement, finished
  // the form and pressed "Go to my work" would be judged against the stale `false` and
  // bounced straight back into the form, forever. Re-asking as they leave the page is
  // what closes that loop, and clearing the answer first means the stale one is never
  // the basis of a redirect while the new one is in flight.
  useEffect(() => {
    if (loading || !session || !resolved || !allowed) return;
    let alive = true;
    setGate(null);
    (async () => {
      try {
        if (!(await onboardingAvailable())) { if (alive) setGate({ signed: true }); return; }
        const st = await fetchOnboardingStatus();
        if (alive) setGate({ signed: st.steps.agreements });
      } catch {
        if (alive) setGate({ signed: true });
      }
    })();
    return () => { alive = false; };
  }, [loading, session, resolved, allowed, onOnboarding]);

  useEffect(() => {
    if (!gate || gate.signed || onOnboarding) return;
    navigate('/work/onboarding', { replace: true });
  }, [gate, onOnboarding, navigate]);

  // Hold the spinner until the gate has answered, so an unsigned contractor never sees
  // a flash of the dashboard before being moved on.
  const waiting = loading || !session || !resolved || !allowed
    || (!gate && !onOnboarding)
    || (gate !== null && !gate.signed && !onOnboarding);

  if (waiting) {
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
