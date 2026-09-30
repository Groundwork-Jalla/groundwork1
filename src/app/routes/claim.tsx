import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Loader2, BadgeCheck } from 'lucide-react';
import {
  getClaimPreview, claimContractorAccount, rememberClaim, type ClaimPreview,
} from '@/lib/supabase/contractor-claim';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/lib/i18n';
import { errorMessage } from '@/lib/errors';

// =========================================================
// /claim/:token — the approved applicant becomes a contractor account.
//
// Approval used to send people to /auth/signup, which made an ordinary account with no
// contractor standing: the directory listing existed, the person existed, and nothing
// joined them. This is the join (100).
//
// Someone arriving here has no account yet, so the page has to be able to say whose
// invitation it is BEFORE sign-in — `contractor_claim_preview` is granted to anon for
// exactly that. A page that cannot name you reads as a phishing link.
// =========================================================

export default function ClaimContractorAccount() {
  const { token }  = useParams<{ token: string }>();
  const { session, loading: authLoading } = useAuth();
  const navigate   = useNavigate();
  const t          = useT();

  const [preview, setPreview] = useState<ClaimPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [busy,    setBusy]    = useState(false);

  useEffect(() => {
    if (!token) { setInvalid(true); setLoading(false); return; }
    getClaimPreview(token)
      .then(p => { if (!p) setInvalid(true); else setPreview(p); })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [token]);

  // Park the token before they leave to sign up; `callback.tsx` finishes the claim, so
  // the applicant never has to come back and press anything a second time.
  useEffect(() => { if (token) rememberClaim(token); }, [token]);

  async function claimNow() {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      await claimContractorAccount(token);
      navigate('/work', { replace: true });
    } catch (err) {
      setError(errorMessage(err, t('claim.failed')));
    } finally {
      setBusy(false);
    }
  }

  if (loading || authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand-mid-grey" aria-hidden />
      </div>
    );
  }

  if (invalid || !preview) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">{t('claim.invalidTitle')}</h1>
        <p className="mt-2 text-sm text-brand-mid-grey">{t('claim.invalidBody')}</p>
      </div>
    );
  }

  if (preview.claimed) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">{t('claim.alreadyTitle')}</h1>
        <p className="mt-2 text-sm text-brand-mid-grey">{t('claim.alreadyBody')}</p>
        <Link to="/auth/login" className="mt-5 inline-block text-sm font-semibold underline underline-offset-2">
          {t('claim.signIn')}
        </Link>
      </div>
    );
  }

  const signupUrl = `/auth/signup?email=${encodeURIComponent(preview.email)}`;
  const loginUrl  = '/auth/login';

  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <span className="inline-flex items-center gap-2 rounded-full border border-brand-border-grey px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey dark:border-[#2c2c2c]">
        <BadgeCheck className="size-3.5" aria-hidden />{t('claim.eyebrow')}
      </span>
      <h1 className="mt-4 text-2xl font-bold text-brand-near-black dark:text-white">
        {t('claim.title', { name: preview.fullName.split(' ')[0] || preview.fullName })}
      </h1>
      <p className="mt-2 text-sm text-brand-mid-grey">{t('claim.body')}</p>
      <p className="mt-3 rounded-lg bg-brand-off-white px-3 py-2 text-sm text-brand-near-black dark:bg-[#1e1e1e] dark:text-white">
        {preview.businessName || preview.fullName} · {preview.email}
      </p>

      {session ? (
        <>
          <button
            type="button" onClick={claimNow} disabled={busy}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-near-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-brand-near-black"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('claim.cta')}
          </button>
          {error && <p role="alert" className="mt-3 text-sm text-state-alert">{error}</p>}
        </>
      ) : (
        <div className="mt-6 space-y-2">
          <Link
            to={signupUrl}
            className="flex w-full items-center justify-center rounded-lg bg-brand-near-black px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-brand-near-black"
          >
            {t('claim.createAccount')}
          </Link>
          <Link
            to={loginUrl}
            className="flex w-full items-center justify-center rounded-lg border border-brand-border-grey px-4 py-2.5 text-sm font-semibold text-brand-near-black dark:border-[#2c2c2c] dark:text-white"
          >
            {t('claim.haveAccount')}
          </Link>
        </div>
      )}
    </div>
  );
}
