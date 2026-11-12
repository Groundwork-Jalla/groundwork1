import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Loader2, Users } from 'lucide-react';
import {
  getViewerInvitePreview, rememberShare,
  type ViewerInvitePreview,
} from '@/lib/supabase/project-viewers';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { completeProjectInvitation } from '@/lib/auth/complete-project-invitation';
import { forgetProjectInvitation, projectInvitationError, withProjectInvitation } from '@/lib/auth/project-invitation';

// =========================================================
// /share/:token — somebody was invited to watch a build (112)
//
// The family side of a project. They may have no Groundwork account at all, which is why
// the preview is readable before sign-in: a page that cannot say whose house it is reads
// as a phishing link, and this is often the first time they have heard of Groundwork.
//
// What they get is READ access to that one project. Nothing on this page implies more,
// because the database would refuse more.
// =========================================================

export default function ShareInvite() {
  const { token } = useParams<{ token: string }>();
  const { session, signOut, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const t = useT();

  const scope = `${token ?? ''}:${session?.user.id ?? ''}`;
  const current = useRef(scope); current.current = scope;
  const accepting = useRef<string | null>(null);
  const [resolvedToken, setResolvedToken] = useState<string | undefined>();
  const [preview, setPreview] = useState<ViewerInvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    let live = true;
    setLoading(true); setPreview(null); setError(null);
    getViewerInvitePreview(token)
      .then(value => { if (live) setPreview(value); })
      .catch(() => { if (live) setPreview(null); })
      .finally(() => { if (live) { setResolvedToken(token); setLoading(false); } });
    return () => { live = false; };
  }, [token, session?.user.id]);
  useEffect(() => { setBusy(false); setError(null); }, [scope]);

  // Park it before they leave to sign up, so /auth/callback can finish the job and they
  // never have to come back and press anything a second time.
  useEffect(() => {
    if (!token || resolvedToken !== token) return;
    if (preview) rememberShare(token);
    else forgetProjectInvitation({ kind: 'viewer', token });
  }, [token, resolvedToken, preview]);

  async function accept() {
    if (!token || accepting.current === scope) return;
    accepting.current = scope;
    setBusy(true); setError(null);
    try {
      const path = await completeProjectInvitation({ kind: 'viewer', token });
      if (current.current === scope) window.location.href = path;
    } catch (err) {
      if (current.current === scope) { setError(t(projectInvitationError(err))); setBusy(false); }
    } finally { if (accepting.current === scope) accepting.current = null; }
  }

  async function changeAccount() {
    current.current = 'switching-account';
    await signOut();
    navigate(withProjectInvitation('/auth/login', token ? { kind: 'viewer', token } : null));
  }

  if (loading || authLoading || resolvedToken !== token) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="size-5 animate-spin text-brand-mid-grey" /></div>;
  }

  // Unknown, withdrawn or malformed — all the same screen, so this cannot be used to test
  // whether a token is real.
  if (!preview) {
    return (
      <div className="mx-auto max-w-md px-4 py-14 text-center">
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">{t('share.goneTitle')}</h1>
        <p className="mt-3 text-sm text-brand-mid-grey">{t('share.goneBody')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <div className="mb-4 inline-flex size-10 items-center justify-center rounded-full bg-brand-off-white dark:bg-[#1e1e1e]">
        <Users className="size-5 text-brand-near-black dark:text-white" aria-hidden />
      </div>
      <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">
        {t('share.title', { name: preview.invitedByName })}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-brand-mid-grey">
        {t('share.body', { project: preview.projectName })}
      </p>
      <p className="mt-3 text-xs text-brand-mid-grey">{t(preview.isClient ? 'share.clientAccess' : 'projectLinks.observerAccess')}</p>

      {preview.isShareLink && <p className="mt-3 text-xs text-brand-mid-grey">{t('projectLinks.firstClaim')}</p>}

      {error && <p role="alert" className="mt-4 text-sm text-brand-near-black dark:text-white">{error}</p>}

      {session ? (
        <div className="mt-6 space-y-3">
          <p className="text-xs text-brand-mid-grey">{t('invite.loggedInAs', { email: session.user.email ?? '' })}</p>
          <Button onClick={accept} disabled={busy} className="w-full">
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {t('share.accept')}
          </Button>
          <button type="button" onClick={changeAccount} className="text-sm underline underline-offset-4">
            {t('common.switchAccount')}
          </button>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {/* The token is already parked, so signing up finishes the job by itself. */}
          <Link to={withProjectInvitation('/auth/signup', token ? { kind: 'viewer', token } : null)} className="block">
            <Button className="w-full">{t('share.createAccount')}</Button>
          </Link>
          <Link to={withProjectInvitation('/auth/login', token ? { kind: 'viewer', token } : null)} className="block text-center text-sm text-brand-mid-grey underline underline-offset-4">
            {t('share.haveAccount')}
          </Link>
        </div>
      )}
    </div>
  );
}
