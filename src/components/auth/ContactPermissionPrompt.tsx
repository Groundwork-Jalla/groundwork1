import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';
import {
  askLaterThisSession, askedLaterThisSession, contactPermissionNext, contactPermissionOf,
  fetchContactPermission, setContactPermission,
} from '@/lib/auth/contact-permission';

// =========================================================
// The one-time question for accounts that were never asked.
//
// Mounted in the signed-in layouts, so it reaches existing users on their next sign-in
// whichever way they sign in: password, Google, a magic link or an invitation. A new
// account that answered on the signup form never sees it: that answer is copied across
// silently on first sign-in.
//
// Three ways out, and only two of them answer: yes, no, or "ask me later", which puts the
// question away until the next sign-in. Closing is never taken as a no.
// =========================================================

export function ContactPermissionPrompt() {
  const t = useT();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const fromSignup = contactPermissionOf(user?.user_metadata?.contact_permission);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const current = useRef<string | null>(null); current.current = userId;

  useEffect(() => {
    if (!userId) { setOpen(false); return; }
    let alive = true;
    void (async () => {
      const recorded = await fetchContactPermission(userId);
      if (!alive || recorded === undefined) return;
      const next = contactPermissionNext(recorded, fromSignup);
      if (next === 'record_signup') {
        // If this fails the signup answer is still in the metadata, and is tried again
        // next time. The person is never asked a question they already answered.
        await setContactPermission(fromSignup!, 'signup').catch(() => undefined);
        return;
      }
      if (alive && next === 'ask' && !askedLaterThisSession(userId)) setOpen(true);
    })();
    return () => { alive = false; };
  }, [userId, fromSignup]);

  if (!open || !userId) return null;

  async function answer(allowed: boolean) {
    if (busy || !userId) return;
    setBusy(true); setError(false);
    try {
      await setContactPermission(allowed, 'sign_in');
      if (current.current === userId) setOpen(false);
    } catch { if (current.current === userId) setError(true); }
    finally { if (current.current === userId) setBusy(false); }
  }
  function later() {
    if (busy || !userId) return;
    askLaterThisSession(userId); setOpen(false);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onKeyDown={event => { if (event.key === 'Escape') later(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="contact-permission-title" aria-describedby="contact-permission-body"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-[#1e1e1e]">
        <h2 id="contact-permission-title" className="text-lg font-bold text-brand-near-black">{t('auth.contactPermission.promptTitle')}</h2>
        <p id="contact-permission-body" className="mt-2 text-sm leading-relaxed text-brand-mid-grey">{t('auth.contactPermission.promptBody')}</p>
        <div className="mt-5 grid gap-2">
          <button type="button" autoFocus disabled={busy} onClick={() => void answer(true)}
            className="min-h-11 rounded-lg bg-brand-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-hover disabled:opacity-50">{t('auth.contactPermission.yes')}</button>
          <button type="button" disabled={busy} onClick={() => void answer(false)}
            className="min-h-11 rounded-lg border border-brand-border-grey px-4 py-2.5 text-sm font-semibold text-brand-near-black disabled:opacity-50">{t('auth.contactPermission.no')}</button>
          <button type="button" disabled={busy} onClick={later}
            className="min-h-11 px-4 py-2 text-sm text-brand-mid-grey underline underline-offset-4 disabled:opacity-50">{t('auth.contactPermission.later')}</button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-state-alert">{t('auth.contactPermission.failed')}</p>}
      </section>
    </div>
  );
}
