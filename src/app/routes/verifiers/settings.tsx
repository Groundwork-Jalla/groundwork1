import { useEffect, useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase/client';
import { useT } from '@/lib/i18n';
import { PhoneField } from '@/components/ui/PhoneField';
import { errorMessage } from '@/lib/errors';

/**
 * A verifier's own profile.
 *
 * ── Why the surface needed one ──────────────────────────────────────────────────────
 * /verifiers deliberately withholds the operator's console, and that was read as
 * withholding everything: an engineer invited by email had no way to correct their own
 * name, and no way to add a phone number at all. The phone is not cosmetic here — it is
 * what WhatsApp delivery resolves against (126), so a verifier without one is simply
 * unreachable on the channel the rest of the project is using.
 *
 * ── Only what is theirs ─────────────────────────────────────────────────────────────
 * Name and phone. Not their role, not their assignments, not their disciplines — those
 * are an administrator's to set (086 `assign_verifier`), and a self-service control over
 * them would be the role granting itself work. Email is shown and not editable: it is the
 * identity the invite was honoured against.
 */
export default function VerifierSettings() {
  const t = useT();
  const { user } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone]       = useState('');
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let live = true;
    void supabase.from('profiles').select('full_name, phone').eq('id', user.id).maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        setFullName((data?.full_name as string | null) ?? '');
        setPhone((data?.phone as string | null) ?? '');
        setLoading(false);
      });
    return () => { live = false; };
  }, [user]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      const { error: err } = await supabase.from('profiles')
        .update({ full_name: fullName.trim(), phone: phone || null })
        .eq('id', user.id);
      if (err) throw err;
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, t('common.somethingWrong')));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p role="status" className="flex items-center gap-2 py-8 text-sm text-brand-mid-grey">
      <Loader2 className="size-4 animate-spin" />{t('common.loading')}
    </p>;
  }

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-brand-near-black dark:text-white">
          {t('nav.settings')}
        </h1>
        <p className="text-sm text-brand-mid-grey mt-0.5">{t('verifier.settings.sub')}</p>
      </div>

      <form onSubmit={save} className="space-y-4 rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] p-5">
        <div>
          <label htmlFor="v-name" className="block text-xs font-semibold text-brand-near-black dark:text-white mb-1.5">
            {t('verifier.settings.name')}
          </label>
          <input
            id="v-name" value={fullName} onChange={e => setFullName(e.target.value)}
            className="w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm dark:border-[#444] dark:bg-[#1e1e1e] dark:text-white"
          />
        </div>

        <div>
          <label htmlFor="v-phone" className="block text-xs font-semibold text-brand-near-black dark:text-white mb-1.5">
            {t('verifier.settings.phone')}
          </label>
          <PhoneField id="v-phone" value={phone} onChange={setPhone} />
          {/* Said plainly, because an empty field here is silently why their phone never
              rings — the fan-out records `no_phone` and moves on. */}
          <p className="text-[11px] text-brand-mid-grey mt-1.5">{t('verifier.settings.phoneHint')}</p>
        </div>

        <div>
          <span className="block text-xs font-semibold text-brand-near-black dark:text-white mb-1.5">
            {t('verifier.settings.email')}
          </span>
          <p className="text-sm text-brand-mid-grey">{user?.email}</p>
          <p className="text-[11px] text-brand-mid-grey mt-1">{t('verifier.settings.emailFixed')}</p>
        </div>

        {error && <p role="alert" className="text-xs text-state-alert">{error}</p>}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy}
            className="rounded-lg bg-brand-near-black px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-brand-near-black">
            {busy ? t('common.saving') : t('common.save')}
          </button>
          {saved && <span className="flex items-center gap-1 text-xs text-brand-mid-grey">
            <Check className="size-3.5" />{t('common.saved')}
          </span>}
        </div>
      </form>
    </div>
  );
}
