import { useEffect, useState } from 'react';
import { ShieldCheck, Loader2, Copy, Check } from 'lucide-react';
import {
  getMfaStatus, enrollTotp, verifyCode, disableTotp,
  type MfaStatus, type TotpEnrolment,
} from '@/lib/auth/mfa';
import { errorMessage } from '@/lib/errors';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useT } from '@/lib/i18n';

// =========================================================
// Two-factor authentication, on the profile's Security tab.
//
// Replaces a "Coming soon" badge that had been there since the tab was built.
//
// THE SECRET IS SHOWN ONCE. Supabase returns it from enroll() and never again, so the
// panel offers it as copyable text beside the QR — a phone camera cannot always reach a
// laptop screen, and a desktop authenticator has no camera at all. Once verified it is
// gone for good, which is why the copy button exists at the only moment it can.
//
// DISABLING IS GATED BY THE FACTOR ITSELF. Supabase refuses unenroll() unless the session
// has already cleared its second factor, so a stolen aal1 session cannot switch 2FA off.
// The refusal is surfaced rather than hidden — a disable button that silently does
// nothing is worse than one that explains itself.
// =========================================================

type Panel = 'idle' | 'enrolling';

export function TwoFactorSection() {
  const t = useT();

  const [status,  setStatus]  = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [panel,   setPanel]   = useState<Panel>('idle');
  const [enrol,   setEnrol]   = useState<TotpEnrolment | null>(null);
  const [code,    setCode]    = useState('');
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [copied,  setCopied]  = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  async function refresh() {
    try {
      setStatus(await getMfaStatus());
      setError(null);
    } catch (err) {
      // A project with MFA switched off in the Supabase dashboard answers with an error
      // here. Saying so beats an empty panel that looks like a bug in this page.
      setError(errorMessage(err, t('profile.mfa.loadFailed')));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleEnable() {
    setBusy(true); setError(null);
    try {
      setEnrol(await enrollTotp());
      setPanel('enrolling');
      setCode('');
    } catch (err) {
      setError(errorMessage(err, t('profile.mfa.enrollFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!enrol) return;
    setBusy(true); setError(null);
    try {
      await verifyCode(enrol.factorId, code);
      setPanel('idle'); setEnrol(null); setCode('');
      await refresh();
    } catch (err) {
      // Supabase's own message distinguishes a wrong code from an expired one — both
      // are things the person can act on, so pass them through.
      setError(errorMessage(err, t('profile.mfa.badCode')));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    if (!status?.factor) return;
    setBusy(true); setError(null);
    try {
      await disableTotp(status.factor.id);
      setConfirmOff(false);
      await refresh();
    } catch (err) {
      setConfirmOff(false);
      setError(errorMessage(err, t('profile.mfa.disableFailed')));
    } finally {
      setBusy(false);
    }
  }

  function cancelEnrol() {
    // The unverified factor stays behind on the server; enrollTotp() sweeps it next time.
    setPanel('idle'); setEnrol(null); setCode(''); setError(null);
  }

  async function copySecret() {
    if (!enrol) return;
    try {
      await navigator.clipboard.writeText(enrol.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* no clipboard permission — the text is selectable anyway */ }
  }

  return (
    <section>
      <div className="flex items-center gap-3 mb-1">
        <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">
          {t('profile.twoFactor')}
        </h2>
        {status?.enabled && (
          <span className="inline-flex items-center gap-1 rounded-full border border-state-complete/30 bg-brand-off-white px-2.5 py-0.5 text-[11px] font-medium text-state-complete dark:bg-[#1c1c1c]">
            <ShieldCheck className="size-3" />
            {t('profile.mfa.on')}
          </span>
        )}
      </div>
      <p className="text-xs text-brand-mid-grey mb-4">{t('profile.mfa.body')}</p>

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-brand-mid-grey">
          <Loader2 className="size-3.5 animate-spin" /> {t('common.loading')}
        </p>
      ) : panel === 'enrolling' && enrol ? (
        <form onSubmit={handleVerify} className="rounded-xl border border-brand-border-grey p-4 dark:border-[#2c2c2c]">
          <p className="text-xs text-brand-near-black dark:text-white">{t('profile.mfa.step1')}</p>

          <div className="mt-3 flex flex-wrap items-start gap-4">
            {/* Already an SVG data URI from Supabase — no QR library involved. */}
            <img
              src={enrol.qrCode}
              alt={t('profile.mfa.qrAlt')}
              className="size-40 shrink-0 rounded-lg bg-white p-2"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-brand-mid-grey">{t('profile.mfa.manualEntry')}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-brand-off-white px-2.5 py-2 font-mono text-[11px] text-brand-near-black dark:bg-[#1c1c1c] dark:text-white">
                  {enrol.secret}
                </code>
                <button
                  type="button" onClick={copySecret}
                  aria-label={t('profile.mfa.copySecret')}
                  className="shrink-0 rounded-lg border border-brand-border-grey p-2 text-brand-mid-grey transition-colors hover:text-brand-near-black dark:border-[#2c2c2c] dark:hover:text-white"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-brand-mid-grey">
                {t('profile.mfa.secretOnce')}
              </p>
            </div>
          </div>

          <label htmlFor="mfa-code" className="mt-4 block text-xs text-brand-near-black dark:text-white">
            {t('profile.mfa.step2')}
          </label>
          <input
            id="mfa-code"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            autoFocus
            className="mt-1.5 w-32 rounded-lg border border-brand-border-grey px-3 py-2 font-mono text-sm tracking-[0.3em] text-brand-near-black outline-none focus:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1c1c1c] dark:text-white"
          />

          {error && <p role="alert" className="mt-3 text-xs text-state-alert">{error}</p>}

          <div className="mt-4 flex gap-2">
            <button
              type="button" onClick={cancelEnrol} disabled={busy}
              className="rounded-xl border border-brand-border-grey px-4 py-2 text-xs font-medium text-brand-near-black hover:bg-brand-off-white disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white dark:hover:bg-[#252525]"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit" disabled={busy || code.length !== 6}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {t('profile.mfa.verify')}
            </button>
          </div>
        </form>
      ) : status?.enabled ? (
        <div className="flex flex-col gap-2">
          <button
            type="button" onClick={() => setConfirmOff(true)} disabled={busy}
            className="self-start rounded-xl border border-brand-border-grey px-4 py-2 text-sm font-medium text-brand-near-black hover:bg-brand-light-grey disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white dark:hover:bg-[#2c2c2c]"
          >
            {t('profile.mfa.disable')}
          </button>
          {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <button
            type="button" onClick={handleEnable} disabled={busy}
            className="inline-flex items-center gap-2 self-start rounded-xl border border-brand-border-grey px-4 py-2 text-sm font-medium text-brand-near-black hover:bg-brand-light-grey disabled:opacity-40 dark:border-[#2c2c2c] dark:text-white dark:hover:bg-[#2c2c2c]"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {t('profile.mfa.enable')}
          </button>
          {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}
        </div>
      )}

      <ConfirmModal
        open={confirmOff}
        title={t('profile.mfa.disableTitle')}
        description={t('profile.mfa.disableBody')}
        confirmLabel={t('profile.mfa.disable')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={busy}
        onConfirm={handleDisable}
        onCancel={() => setConfirmOff(false)}
      />
    </section>
  );
}
