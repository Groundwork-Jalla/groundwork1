import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Loader2, Users } from 'lucide-react';
import {
  getViewerInvitePreview, acceptProjectViewer, rememberShare,
  type ViewerInvitePreview,
} from '@/lib/supabase/project-viewers';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

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
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const t = useT();

  const [preview, setPreview] = useState<ViewerInvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    getViewerInvitePreview(token)
      .then(setPreview)
      .catch(() => setPreview(null))
      .finally(() => setLoading(false));
  }, [token]);

  // Park it before they leave to sign up, so /auth/callback can finish the job and they
  // never have to come back and press anything a second time.
  useEffect(() => { if (token) rememberShare(token); }, [token]);

  async function accept() {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      const projectId = await acceptProjectViewer(token);
      navigate(`/projects/${projectId}`, { replace: true });
    } catch {
      setError(t('share.errFailed'));
      setBusy(false);
    }
  }

  if (loading || authLoading) {
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
      <p className="mt-3 text-xs text-brand-mid-grey">{t('share.readOnly')}</p>

      {error && <p role="alert" className="mt-4 text-sm text-brand-near-black dark:text-white">{error}</p>}

      {session ? (
        <Button onClick={accept} disabled={busy} className="mt-6 w-full">
          {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {t('share.accept')}
        </Button>
      ) : (
        <div className="mt-6 space-y-3">
          {/* The token is already parked, so signing up finishes the job by itself. */}
          <Link to={`/auth/signup?email=`} className="block">
            <Button className="w-full">{t('share.createAccount')}</Button>
          </Link>
          <Link to="/auth/login" className="block text-center text-sm text-brand-mid-grey underline underline-offset-4">
            {t('share.haveAccount')}
          </Link>
        </div>
      )}
    </div>
  );
}
