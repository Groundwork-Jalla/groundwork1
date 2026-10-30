import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useLanguage, useT, type TKey } from '@/lib/i18n';
import { supabase } from '@/lib/supabase/client';
import { updateProfile } from '@/lib/supabase/profile';
import { fetchAssignedProjects } from '@/lib/supabase/contractor-work';
import { fetchOnboardingStatus, onboardingAvailable } from '@/lib/supabase/contractor-onboarding';
import {
  NOTIFY_KEYS, readPreferences, savePreferences,
  type CurrencyFirst, type NotifyKey, type NotifyPrefs,
} from '@/lib/supabase/contractor-preferences';
import { myApplicationState, myApplicationDetail, type ApplicationState } from '@/lib/supabase/partner-application';
import { fetchMyDevices, type UserDevice } from '@/lib/supabase/user-devices';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

// =========================================================
// The contractor's profile.
//
// Built to the approved screen (30 Oct 2026) and living at /work/profile rather than
// the shared /profile, which renders inside the CLIENT shell — a contractor who
// opened it was dropped into somebody else's sidebar. Favour: no button on this
// surface may send them to another dashboard.
//
// Everything here is read from the account. Nothing is illustrative: a field the
// account does not carry is shown empty, not filled in with a plausible example.
// =========================================================

export default function ContractorProfile() {
  const t = useT();
  const { user, signOut } = useAuth();
  const { lang, setLang } = useLanguage();
  const { preference, setTheme } = useTheme();

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof meta[key] === 'string' ? meta[key] as string : '');

  const [fullName, setFullName] = useState(() => str('full_name'));
  const [phone, setPhone] = useState(() => str('phone'));
  const [business, setBusiness] = useState(() => str('business_name'));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [prefs, setPrefs] = useState(() => readPreferences(meta));
  const [verified, setVerified] = useState<boolean | null>(null);
  const [trade, setTrade] = useState<string | null>(null);
  const [builds, setBuilds] = useState<number | null>(null);
  const [resetSent, setResetSent] = useState(false);
  /** The screen reads as a record; "Edit profile" turns the rows into fields. */
  const [editing, setEditing] = useState(false);
  const [partner, setPartner] = useState<ApplicationState | null>(null);
  const [regions, setRegions] = useState<string | null>(null);
  const [devices, setDevices] = useState<UserDevice[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (!(await onboardingAvailable())) return;
        const status = await fetchOnboardingStatus();
        if (!alive) return;
        setVerified(status.complete);
        setTrade(status.specialty === 'other'
          ? status.specialtyOther
          : status.specialty);
      } catch { /* not a contractor, or the read was refused — say nothing */ }
    })();
    void fetchAssignedProjects()
      .then(rows => { if (alive) setBuilds(rows.length); })
      .catch(() => {});
    void fetchMyDevices().then(d => { if (alive) setDevices(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // The partner badge and the regions row, both from their own records.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    void myApplicationState(user.id).then(x => { if (alive) setPartner(x); }).catch(() => {});
    void myApplicationDetail(user.id)
      .then(d => { if (alive) setRegions(d?.regions ?? null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [user]);

  async function saveDetails() {
    setSaving(true); setError(null); setSaved(false);
    try {
      await updateProfile({ full_name: fullName.trim(), phone: phone.trim() });
      // `business_name` is not one of updateProfile's three fields, so it goes in the
      // same metadata write rather than a second round trip.
      const { error: err } = await supabase.auth.updateUser({
        data: { business_name: business.trim() },
      });
      if (err) throw new Error(err.message);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e, t('profile.saveFailed')));
    } finally { setSaving(false); }
  }

  const setNotify = useCallback(async (key: NotifyKey, on: boolean) => {
    const notify: NotifyPrefs = { ...prefs.notify, [key]: on };
    setPrefs(p => ({ ...p, notify }));           // optimistic: a switch must feel instant
    try { await savePreferences({ notify }); }
    catch { setPrefs(p => ({ ...p, notify: prefs.notify })); }   // put it back
  }, [prefs.notify]);

  const setCurrency = useCallback(async (currencyFirst: CurrencyFirst) => {
    setPrefs(p => ({ ...p, currencyFirst }));
    try { await savePreferences({ currencyFirst }); }
    catch { setPrefs(p => ({ ...p, currencyFirst: prefs.currencyFirst })); }
  }, [prefs.currencyFirst]);

  async function sendReset() {
    if (!user?.email) return;
    await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/auth/reset`,
    });
    setResetSent(true);
  }

  const initials = fullName.trim()
    ? fullName.trim().split(' ').slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
    : '—';

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">
        {t('nav.viewProfile')}
      </h1>

      <div className="grid items-start gap-5 xl:grid-cols-[3fr_2fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-near-black text-lg font-bold text-white dark:bg-white dark:text-brand-near-black">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold tracking-tight text-brand-near-black dark:text-white">
                {fullName || t('profile.yourFullName')}
              </p>
              <p className="mt-0.5 text-xs text-brand-mid-grey">
                {[trade, str('city'), str('country')].filter(Boolean).join(' · ')}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {verified === true && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-state-complete/35 px-2.5 py-0.5 text-[11px] font-semibold text-state-complete">
                    <ShieldCheck className="size-3" aria-hidden />{t('profile.verifiedContractor')}
                  </span>
                )}
                {partner !== null && partner !== 'none' && (
                  <span className="inline-flex items-center rounded-full border border-brand-border-grey px-2.5 py-0.5 text-[11px] font-medium text-brand-mid-grey dark:border-[#2c2c2c]">
                    {t(partner === 'accepted'
                      ? 'contractorProfile.badgePartner' : 'contractorProfile.badgeApplied')}
                  </span>
                )}
                {builds !== null && builds > 0 && (
                  <span className="inline-flex items-center rounded-full border border-brand-border-grey px-2.5 py-0.5 text-[11px] font-medium text-brand-mid-grey dark:border-[#2c2c2c]">
                    {t('profile.liveBuilds', { n: builds })}
                  </span>
                )}
              </div>
            </div>
            <button type="button" onClick={() => setEditing(e => !e)}
              className="shrink-0 rounded-lg border border-brand-border-grey px-3.5 py-2 text-sm font-semibold text-brand-near-black dark:border-[#2c2c2c] dark:text-white">
              {t(editing ? 'common.cancel' : 'contractorProfile.editProfile')}
            </button>
          </section>

          <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <h2 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
              {t('contractorProfile.yourDetails')}
            </h2>
            {editing
              ? <Field label={t('profile.fullName')} value={fullName} onChange={setFullName} />
              : <Readonly label={t('profile.fullName')} value={fullName || '—'} />}
            {/* Email is how they sign in, so it is not editable from here. */}
            <Readonly label={t('profile.emailAddress')} value={user?.email ?? '—'}
                      hint={t('profile.emailCurrent')} />
            {editing
              ? <Field label={t('profile.phoneNumber')} value={phone} onChange={setPhone}
                       hint={t('contractorProfile.phoneHint')} />
              : <Readonly label={t('profile.phoneNumber')} value={phone || '—'}
                          hint={t('contractorProfile.phoneHint')} />}
            {editing
              ? <Field label={t('contractorProfile.businessName')} value={business} onChange={setBusiness} />
              : <Readonly label={t('contractorProfile.businessName')} value={business || '—'} />}
            <Readonly label={t('contractorProfile.trade')} value={trade ? tradeLabel(t, trade) : '—'} />
            <Readonly label={t('contractorProfile.regionsYouWorkIn')} value={regions || '—'} />

            {editing && <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void saveDetails()} disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-near-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-brand-near-black">
                {saving && <Loader2 className="size-4 animate-spin" />}{t('profile.saveChanges')}
              </button>
              {saved && <span role="status" className="text-xs text-state-complete">{t('common.saved')}</span>}
              {error && <span role="alert" className="text-xs text-state-alert">{error}</span>}
            </div>}
          </section>

          <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <h2 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
              {t('contractorProfile.howTheAppBehaves')}
            </h2>
            <Line label={t('profile.language')}>
              <Segmented options={[['en', 'English'], ['fr', 'Français']]}
                         value={lang} onPick={v => setLang(v as 'en' | 'fr')} />
            </Line>
            <Line label={t('contractorProfile.darkMode')}>
              <Toggle on={preference === 'dark'}
                      onChange={on => setTheme(on ? 'dark' : 'light')}
                      label={t('contractorProfile.darkMode')} />
            </Line>
            <Line label={t('contractorProfile.currencyFirst')}
                  hint={t('contractorProfile.currencyFirstHint')}>
              <Segmented options={[['local', t('contractorProfile.localCurrency')], ['usd', 'USD']]}
                         value={prefs.currencyFirst} onPick={v => void setCurrency(v as CurrencyFirst)} />
            </Line>
          </section>

          <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <h2 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
              {t('contractorProfile.tellMeWhen')}
            </h2>
            {NOTIFY_KEYS.map(key => (
              <Line key={key} label={t(`contractorProfile.notify.${key}` as TKey)}>
                <Toggle on={prefs.notify[key]} onChange={on => void setNotify(key, on)}
                        label={t(`contractorProfile.notify.${key}` as TKey)} />
              </Line>
            ))}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <h2 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
              {t('contractorProfile.signingIn')}
            </h2>
            <Line label={t('profile.password')}>
              {resetSent
                ? <span className="text-xs text-state-complete">{t('profile.resetSent')}</span>
                : <button type="button" onClick={() => void sendReset()}
                    className="text-xs font-semibold underline underline-offset-2">
                    {t('profile.change')}
                  </button>}
            </Line>
            {/* Real devices now (migration 168): the browser records its own on
                sign-in, so this is a count with something behind it. Null means we
                could not read the table — the row then says nothing rather than
                claiming zero. Forgetting a device is not signing it out, and the
                two actions are kept apart so neither can be mistaken for the other. */}
            <Line label={t('contractorProfile.signedInOn')}
                  hint={devices?.map(d => d.isThisOne
                    ? t('contractorProfile.thisDevice', { label: d.label })
                    : d.label).join(' · ')}>
              <span className="text-sm font-semibold text-brand-near-black dark:text-white">
                {devices === null ? '—' : t('contractorProfile.deviceCount', { n: devices.length })}
              </span>
            </Line>
            <Line label={t('contractorProfile.signOutEverywhere')}
                  hint={t('contractorProfile.signedInElsewhereHint')}>
              <button type="button" onClick={() => void supabase.auth.signOut({ scope: 'global' })}
                className="text-xs font-semibold underline underline-offset-2">
                {t('profile.signOut')}
              </button>
            </Line>
          </section>

          <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <h2 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
              {t('contractorProfile.whatClientsSee')}
            </h2>
            <p className="text-xs text-brand-mid-grey">{t('contractorProfile.whatClientsSeeBody')}</p>
            <button type="button"
              className="mt-3 w-full rounded-lg border border-brand-border-grey px-4 py-2.5 text-sm font-semibold text-brand-near-black dark:border-[#2c2c2c] dark:text-white">
              {t('contractorProfile.seeMyPublicProfile')}
            </button>
          </section>

          <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <h2 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
              {t('contractorProfile.leaving')}
            </h2>
            <Line label={t('profile.signOut')}>
              <button type="button" onClick={() => void signOut()}
                className="text-xs font-semibold text-state-alert underline underline-offset-2">
                {t('profile.signOut')}
              </button>
            </Line>
            {/* On a phone the tab bar carries Dashboard/Projects/Payouts/Profile, so
                Partner programme is reached from here — as the mobile design shows. */}
            <Line label={t('partner.navLabel')}>
              <Link to="/work/partner" className="text-xs font-semibold underline underline-offset-2">
                {t('contractorProfile.open')}
              </Link>
            </Line>
            <Line label={t('contractorProfile.closeAccount')}
                  hint={t('contractorProfile.closeAccountHint')}>
              <span className="text-xs text-brand-mid-grey">{t('contractorProfile.closeAccountHow')}</span>
            </Line>
          </section>
        </div>
      </div>
    </div>
  );
}

/** A trade stored as a role key reads through the dictionary; anything else is theirs. */
function tradeLabel(t: (k: TKey) => string, trade: string): string {
  const key = `contractorApply.form.role.${trade}` as TKey;
  const translated = t(key);
  return translated === key ? trade : translated;
}

// ── Pieces ─────────────────────────────────────────────────────────────────────────

function Field({ label, value, onChange, hint }: {
  label: string; value: string; onChange: (v: string) => void; hint?: string;
}) {
  return (
    <label className="block border-t border-brand-border-grey py-3 dark:border-[#2c2c2c]">
      <span className="mb-1.5 block text-xs font-semibold text-brand-near-black dark:text-white">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-brand-border-grey bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20 dark:border-[#2c2c2c] dark:bg-[#141414] dark:text-white" />
      {hint && <span className="mt-1 block text-[11px] text-brand-mid-grey">{hint}</span>}
    </label>
  );
}

function Readonly({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-t border-brand-border-grey py-3 dark:border-[#2c2c2c]">
      <p className="text-xs font-semibold text-brand-near-black dark:text-white">{label}</p>
      <p className="mt-1 text-sm text-brand-mid-grey">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-brand-mid-grey">{hint}</p>}
    </div>
  );
}

function Line({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-brand-border-grey py-3 dark:border-[#2c2c2c]">
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-brand-near-black dark:text-white">{label}</span>
        {hint && <span className="block text-[11px] text-brand-mid-grey">{hint}</span>}
      </span>
      <span className="shrink-0">{children}</span>
    </div>
  );
}

function Segmented({ options, value, onPick }: {
  options: [string, string][]; value: string; onPick: (v: string) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-brand-border-grey dark:border-[#2c2c2c]">
      {options.map(([id, label]) => (
        <button key={id} type="button" onClick={() => onPick(id)} aria-pressed={value === id}
          className={cn('px-3 py-1.5 text-xs font-semibold transition-colors',
            value === id
              ? 'bg-brand-near-black text-white dark:bg-white dark:text-brand-near-black'
              : 'text-brand-mid-grey')}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label }: {
  on: boolean; onChange: (on: boolean) => void; label: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label}
      onClick={() => onChange(!on)}
      className={cn('relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors',
        on ? 'bg-brand-near-black dark:bg-white' : 'bg-brand-border-grey dark:bg-[#2c2c2c]')}>
      <span className={cn(
        'absolute top-[3px] size-4 rounded-full bg-white shadow transition-all dark:bg-[#1e1e1e]',
        on ? 'left-[19px]' : 'left-[3px]')} />
    </button>
  );
}
