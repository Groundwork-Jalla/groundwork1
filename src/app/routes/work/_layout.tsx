import { useT } from '@/lib/i18n';
import { fetchProjectTeamAccess } from '@/lib/supabase/project-team';
import { AppShell } from '@/components/shell/AppShell';
import { CLIENT_NAV, ADMIN_NAV } from '@/components/shell/nav-config';
import { VerifierShell } from '@/components/verifier/VerifierShell';
import { useEffect, useState } from 'react';
import { RoleTour } from '@/components/tour/RoleTour';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { WorkShell } from '@/components/shell/WorkShell';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { fetchOnboardingStatus, onboardingAvailable } from '@/lib/supabase/contractor-onboarding';

// =========================================================
// /work — the contractor's execution surface.
//
// The current contractor account role opens this dashboard. Accepted assignments
// also retain their specific project work view after an account role change.
// Project, evidence and payment access stays controlled by database membership;
// a global account role alone grants no project access.
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

/**
 * null = still looking, or the feature is not on this database.
 *
 * Two separate holds, and they are not the same thing:
 *   · `signed`   — the agreement. Nothing under /work opens until it is signed.
 *   · `decided`  — the client question at the end of the form. Once the form is
 *                  complete they must answer it before going anywhere, so the nav is
 *                  rendered inert and every other path returns them to it.
 */
/**
 * `complete` is the whole of onboarding, not just the signature.
 *
 * The sidebar is visible and inert until every step is done. A half-onboarded
 * contractor can see what they are working towards and has exactly one way forward,
 * which is the screen they are already on.
 *
 * Every failure path below sets all three true. A read that times out must not lock
 * somebody out of a live project — being wrong in that direction costs a client their
 * site updates, and being wrong in the other costs nothing but an extra visit.
 */
type Gate = { signed: boolean; decided: boolean; complete: boolean } | null;

export default function WorkLayout() {
  const t = useT();
  const { session, loading, isContractor, rolesChecked, user, signOut, accountRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [gate, setGate] = useState<Gate>(null);

  const projectId = /^\/work\/projects\/([^/]+)/.exec(location.pathname)?.[1];
  const scope = `${user?.id ?? ''}:${projectId ?? ''}`;
  const [projectAccess, setProjectAccess] = useState<{ scope: string; allowed: boolean | null; error?: boolean } | null>(null);
  const [accessAttempt, setAccessAttempt] = useState(0);
  useEffect(() => {
    if (!projectId || !user?.id || isContractor || !rolesChecked) return;
    let live = true;
    void fetchProjectTeamAccess(projectId).then(access => {
      if (live) setProjectAccess({ scope, allowed: access.assignedContractor });
    }).catch(() => { if (live) setProjectAccess({ scope, allowed: null, error: true }); });
    return () => { live = false; };
  }, [scope, projectId, user?.id, isContractor, rolesChecked, accessAttempt]);
  const currentProjectAccess = projectAccess?.scope === scope ? projectAccess : null;
  const allowed = isContractor || currentProjectAccess?.allowed === true;
  const resolved = rolesChecked && (isContractor || !projectId || (currentProjectAccess !== null && currentProjectAccess.allowed !== null));
  const onOnboarding = location.pathname.startsWith('/work/onboarding');

  useEffect(() => {
    if (loading) return;
    if (!session) {
      navigate(`/auth/login?redirect=${encodeURIComponent(location.pathname + location.search + (location.hash ?? ''))}`, { replace: true });
      return;
    }
    if (resolved && !allowed) navigate('/dashboard', { replace: true });
  }, [loading, session, resolved, allowed, navigate, location.pathname, location.search, location.hash]);

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
    if (!isContractor) { setGate({ signed: true, decided: true, complete: true }); return; }
    (async () => {
      try {
        if (!(await onboardingAvailable())) {
          if (alive) setGate({ signed: true, decided: true, complete: true });
          return;
        }
        const st = await fetchOnboardingStatus();
        if (alive) {
          setGate({
            signed: st.steps.agreements,
            // Only a FINISHED form owes an answer. Somebody midway through has not
            // reached the question yet, and holding them against it would be a gate
            // on a screen they have never seen.
            decided: !st.complete || st.clientIntent !== null,
            complete: st.complete,
          });
        }
      } catch {
        if (alive) setGate({ signed: true, decided: true, complete: true });
      }
    })();
    return () => { alive = false; };
  }, [loading, session, resolved, allowed, onOnboarding, isContractor]);

  // Unsigned, unfinished, or finished-but-undecided: either way the only place to be is
  // the form. The redirect matters as much as the inert sidebar — without it the lock is
  // decoration that a typed URL walks straight past.
  const through = (g: NonNullable<Gate>) => g.signed && g.decided && g.complete;

  useEffect(() => {
    if (!gate || onOnboarding) return;
    if (through(gate)) return;
    const destination = `${location.pathname}${location.search}`;
    navigate(`/work/onboarding?redirect=${encodeURIComponent(destination)}`, { replace: true });
  }, [gate, onOnboarding, navigate, location.pathname, location.search]);

  // Hold the spinner until the gate has answered, so an unsigned contractor never sees
  // a flash of the dashboard before being moved on.
  const waiting = loading || !session || !resolved || !allowed
    || (!gate && !onOnboarding)
    || (gate !== null && !through(gate) && !onOnboarding);

  if (currentProjectAccess?.error && !isContractor && rolesChecked) return <div className="flex min-h-screen flex-col items-center justify-center gap-4">
    <p role="alert" className="text-sm text-brand-mid-grey">{t('teamAccess.loadFailed')}</p>
    <button type="button" onClick={() => setAccessAttempt(value => value + 1)} className="rounded-xl border px-4 py-2 text-sm">{t('common.retry')}</button>
  </div>;

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
  // An account role change does not remove accepted project responsibilities.
  // Keep that project's work view inside the user's current account navigation.
  if (!isContractor) {
    const logout = () => { void signOut().then(() => navigate('/', { replace: true })); };
    const content = <Outlet />;
    if (accountRole === 'verifier') return <VerifierShell displayName={displayName} onLogout={logout}>{content}</VerifierShell>;
    return <AppShell nav={accountRole === 'admin' ? ADMIN_NAV : CLIENT_NAV} displayName={displayName} onLogout={logout}
      topBarActions={<NotificationBell userId={user?.id ?? ''} />}>{content}</AppShell>;
  }
  return (
    <WorkShell
      displayName={displayName}
      // Visible and inert until onboarding is finished — and on the client question at
      // the end of it, where the two buttons on that screen are the only live things.
      navLocked={gate !== null && !(gate.decided && gate.complete)}
      // A contractor had no bell at all: a message notification was written and had
      // nowhere to appear. Suppressed while the client question is unanswered, since
      // nothing on that screen is meant to be clickable but its two buttons.
      topBarActions={gate?.decided === false ? undefined
        : <NotificationBell userId={user?.id ?? ''} />}
      onLogout={() => { void signOut().then(() => navigate('/', { replace: true })); }}
    >
      <Outlet />
      {/* Not while onboarding is unfinished: that screen deliberately leaves only its
          own two buttons live, and an arrow pointing at a locked sidebar would be the
          product contradicting itself. */}
      {!(gate !== null && !(gate.decided && gate.complete)) && <RoleTour />}
    </WorkShell>
  );
}
