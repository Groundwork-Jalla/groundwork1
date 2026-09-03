import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, ShieldCheck } from 'lucide-react';
import { verifyCode, verifiedFactorId } from '@/lib/auth/mfa';
import { supabase } from '@/lib/supabase/client';
import { errorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

// =========================================================
// The second factor, at sign-in. Shared by /auth/login and /auth/callback.
//
// Both paths need it and for the same reason: a session exists but has not cleared its
// factor, so it is at aal1 and must not be routed into the app. Password sign-in reaches
// this directly; Google sign-in reaches it through the callback, and leaving that one out
// would have made "sign in with Google" a way past 2FA entirely.
//
// CANCELLING SIGNS OUT, and that is the whole point. Backing out of this screen leaves a
// real aal1 session in the browser — refresh token and all — so simply hiding the form
// would leave someone holding half a session they did not finish authenticating. There is
// no state here worth preserving, so the honest exit is to drop it.
// =========================================================

export function MfaChallenge({
  onVerified, onCancel,
}: {
  onVerified: () => void;
  /** Called after the half-session has been discarded. */
  onCancel?: () => void;
}) {
  const t = useT();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code,  setCode]  = useState('');
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    verifiedFactorId().then(id => { if (alive) setFactorId(id); });
    return () => { alive = false; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true); setError(null);
    try {
      await verifyCode(factorId, code);
      onVerified();
    } catch (err) {
      setError(errorMessage(err, t('auth.mfa.badCode')));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    // Drop the aal1 session rather than leaving it in the browser unfinished.
    try { await supabase.auth.signOut(); } catch { /* leaving anyway */ }
    onCancel?.();
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-light-grey">
        <ShieldCheck className="size-5 text-brand-near-black" />
      </div>
      <h1 className="text-center font-sans text-2xl font-bold text-brand-near-black">
        {t('auth.mfa.title')}
      </h1>
      <p className="mt-2 text-center text-sm text-brand-mid-grey">{t('auth.mfa.subtitle')}</p>

      <form onSubmit={handleSubmit} className="mt-8">
        <label htmlFor="mfa-login-code" className="sr-only">{t('auth.mfa.codeLabel')}</label>
        <input
          id="mfa-login-code"
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          autoFocus
          aria-describedby={error ? 'mfa-login-error' : undefined}
          className="w-full rounded-xl border border-brand-border-grey px-4 py-3 text-center font-mono text-lg tracking-[0.4em] text-brand-near-black outline-none focus:border-brand-near-black"
        />

        {error && (
          <p id="mfa-login-error" role="alert" className="mt-3 rounded-md bg-brand-light-grey px-3 py-2 text-sm text-brand-near-black">
            {error}
          </p>
        )}

        <Button type="submit" disabled={busy || code.length !== 6 || !factorId} className="mt-4 w-full">
          {busy ? <Loader2 className="size-4 animate-spin" /> : t('auth.mfa.submit')}
        </Button>
      </form>

      <p className="mt-6 text-center text-xs leading-relaxed text-brand-mid-grey">
        {t('auth.mfa.lostDevice')}
      </p>

      <p className="mt-4 text-center">
        <button
          type="button" onClick={handleCancel}
          className="text-sm text-brand-mid-grey underline underline-offset-4 hover:text-brand-near-black"
        >
          {t('auth.mfa.cancel')}
        </button>
      </p>
    </motion.div>
  );
}
