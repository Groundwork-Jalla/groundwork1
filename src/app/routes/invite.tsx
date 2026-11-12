import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Loader2, Building2, UserPlus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getInviteByToken } from '@/lib/supabase/invites';
import type { InviteDetails } from '@/lib/supabase/invites';
import { useT } from '@/lib/i18n';
import { completeProjectInvitation } from '@/lib/auth/complete-project-invitation';
import { projectInvitationError, rememberProjectInvitation, withProjectInvitation } from '@/lib/auth/project-invitation';

export default function InvitePage() {
  const { token }    = useParams<{ token: string }>();
  const navigate     = useNavigate();
  const { user, signOut, loading: authLoading } = useAuth();
  const t            = useT();
  const scope = `${token ?? ''}:${user?.id ?? ''}`;
  const current = useRef(scope); current.current = scope;
  const inFlight = useRef<string | null>(null);
  const [resolvedToken, setResolvedToken] = useState<string | undefined>();

  const [invite,    setInvite]    = useState<InviteDetails | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [invalid,   setInvalid]   = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptErr, setAcceptErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setInvalid(true); setLoading(false); return; }
    let live = true;
    setLoading(true); setInvalid(false); setInvite(null); setAcceptErr(null);
    getInviteByToken(token)
      .then((data) => {
        if (!live) return;
        if (!data) { setInvalid(true); return; }
        setInvite(data);
      })
      .catch(() => { if (live) setInvalid(true); })
      .finally(() => { if (live) { setResolvedToken(token); setLoading(false); } });
    return () => { live = false; };
  }, [token, user?.id]);
  useEffect(() => { setAccepting(false); setAcceptErr(null); }, [scope]);

  async function handleAcceptNow() {
    if (!token || inFlight.current === scope) return;
    inFlight.current = scope;
    setAccepting(true);
    setAcceptErr(null);
    try {
      const path = await completeProjectInvitation({ kind: 'contractor', token });
      if (current.current === scope) window.location.href = path;
    } catch (err) {
      if (current.current === scope) { setAcceptErr(t(projectInvitationError(err))); setAccepting(false); }
    } finally { if (inFlight.current === scope) inFlight.current = null; }
  }

  // Store token in localStorage so callback.tsx can process it
  // even if the user opens the confirmation email in a different tab.
  function storeToken() {
    if (token) rememberProjectInvitation({ kind: 'contractor', token });
  }

  async function changeAccount() {
    current.current = 'switching-account';
    storeToken();
    await signOut();
    navigate(withProjectInvitation('/auth/login', token ? { kind: 'contractor', token } : null));
  }

  if (loading || authLoading || resolvedToken !== token) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-brand-mid-grey" />
      </div>
    );
  }

  if (invalid || !invite) {
    return (
      <div className="w-full text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-brand-light-grey">
          <UserPlus className="size-5 text-brand-mid-grey" />
        </div>
        <h1 className="font-sans text-2xl font-bold text-brand-near-black mb-2">
          {t('invite.notFoundTitle')}
        </h1>
        <p className="text-sm text-brand-mid-grey mb-6 leading-relaxed">
          {t('invite.notFoundBody')}
        </p>
        <Link
          to="/"
          className="text-sm font-medium text-brand-near-black underline underline-offset-4"
        >
          {t('invite.goToGroundwork')}
        </Link>
      </div>
    );
  }

  if (invite.status === 'accepted') {
    return (
      <div className="w-full text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-brand-off-white">
          <UserPlus className="size-5 text-state-complete" />
        </div>
        <h1 className="font-sans text-2xl font-bold text-brand-near-black mb-2">
          {t('invite.acceptedTitle')}
        </h1>
        <p className="text-sm text-brand-mid-grey mb-6 leading-relaxed">
          {t('invite.acceptedBody')}
        </p>
        {user ? (
          <button type="button" onClick={handleAcceptNow} disabled={accepting}
            className="rounded-xl bg-brand-near-black px-6 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {t('invite.accept')}
          </button>
        ) : (
          <Link to={withProjectInvitation('/auth/login', token ? { kind: 'contractor', token } : null)}
            className="inline-flex items-center justify-center rounded-xl bg-brand-near-black text-white text-sm font-semibold px-6 py-3 hover:bg-black transition-colors">
            {t('common.logIn')}
          </Link>
        )}
        {acceptErr && <p role="alert" className="mt-3 text-sm text-state-alert">{acceptErr}</p>}
        {user && <button type="button" onClick={changeAccount} className="mt-3 block text-sm underline underline-offset-4">
          {t('common.switchAccount')}
        </button>}
      </div>
    );
  }

  const signupUrl = `/auth/signup?invite=${encodeURIComponent(token ?? '')}&email=${encodeURIComponent(invite.invite_email ?? '')}`;
  const loginUrl  = `/auth/login?invite=${encodeURIComponent(token ?? '')}`;

  return (
    <div className="w-full">
      {/* Project badge */}
      <div className="inline-flex items-center gap-2 rounded-full border border-brand-border-grey bg-brand-off-white px-3 py-1.5 mb-6">
        <Building2 className="size-3.5 text-brand-mid-grey shrink-0" />
        <span className="text-xs font-medium text-brand-near-black truncate max-w-50">
          {invite.project_name}
        </span>
      </div>

      <h1 className="font-sans text-3xl font-bold text-brand-near-black leading-tight mb-2">
        {t('invite.title')}
      </h1>
      <p className="text-sm text-brand-mid-grey mb-1">
        {t('invite.invitedBy', {
          inviter: invite.inviter_name,
          project: invite.project_name,
        })}
      </p>
      <p className="text-xs text-brand-mid-grey mb-6">
        {invite.is_share_link ? t('projectLinks.firstClaim') : t('invite.sentTo', { email: invite.invite_email ?? '' })}
      </p>

      <p className="text-xs text-brand-mid-grey mb-6 leading-relaxed">
        {t('invite.explainer')}
      </p>

      {/* CTA — branch on auth state */}
      {user ? (
        <>
          <p className="text-xs text-brand-mid-grey text-center mb-3">
            {t('invite.loggedInAs', { email: user.email ?? '' })}
          </p>
          <button
            type="button"
            onClick={handleAcceptNow}
            disabled={accepting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-near-black text-white text-sm font-semibold py-3.5 hover:bg-black transition-colors disabled:opacity-60"
          >
            {accepting && <Loader2 className="size-4 animate-spin" />}
            {accepting ? t('invite.accepting') : t('invite.accept')}
          </button>
          {acceptErr && (
            <p className="mt-3 text-xs text-center text-state-alert">{acceptErr}</p>
          )}
          <button type="button" onClick={changeAccount} className="mt-3 w-full text-sm underline underline-offset-4">
            {t('common.switchAccount')}
          </button>
        </>
      ) : (
        <>
          <Link
            to={signupUrl}
            onClick={storeToken}
            className="block w-full text-center rounded-xl bg-brand-near-black text-white text-sm font-semibold py-3.5 hover:bg-black transition-colors mb-3"
          >
            {t('invite.createAccount')}
          </Link>
          <Link
            to={loginUrl}
            onClick={storeToken}
            className="block w-full text-center rounded-xl border border-brand-border-grey text-sm font-medium text-brand-near-black py-3.5 hover:bg-brand-off-white transition-colors"
          >
            {t('invite.haveAccount')}
          </Link>
        </>
      )}
    </div>
  );
}
