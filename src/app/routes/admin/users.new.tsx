import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Check, Copy, FolderPlus, KeyRound, Loader2, ShieldCheck, UserPlus } from 'lucide-react';
import { provisionClientAccount, ProvisionFailed, type ProvisionedAccount } from '@/lib/supabase/admin-provision';
import { COUNTRIES, DEFAULT_COUNTRY_CODE } from '@/lib/countries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n';
import type { Lang } from '@/lib/i18n/types';

// =========================================================
// /admin/users/new — create a Jalla Management client's account
//
// The upstream half of /admin/projects/new. A managed client's details are collected in
// person; an admin enters them here, the server creates the account with a temporary
// password, and the admin hands the client two things: their username (the email) and
// that password. On first sign-in the client is asked for a code sent to the email and
// then made to choose a password of their own — so the one the admin knows stops
// working the moment the client has used it.
//
// The password is shown on this screen exactly once. It is not kept in state beyond
// this page, not written to storage, not put in the URL. Leave the page and it is gone;
// the recovery path for a lost one is the ordinary "Forgot password?" flow, which works
// because the address is confirmed.
// =========================================================

type FieldError = 'email' | 'name' | null;

export default function AdminNewUser() {
  const t = useT();
  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');
  const [phone, setPhone]       = useState('');
  const [country, setCountry]   = useState(DEFAULT_COUNTRY_CODE);
  const [lang, setLang]         = useState<Lang>('en');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<FieldError>(null);
  const [created, setCreated]   = useState<ProvisionedAccount | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setFieldError(null);

    if (fullName.trim().length < 2) { setFieldError('name'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setFieldError('email'); return; }

    setSubmitting(true);
    try {
      const account = await provisionClientAccount({
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        country,
        lang,
      });
      setCreated(account);
    } catch (err) {
      const code = err instanceof ProvisionFailed ? err.code : 'create_failed';
      if (code === 'email_taken')        { setFieldError('email'); setError(t('admin.provision.errTaken')); }
      else if (code === 'invalid_email') { setFieldError('email'); setError(t('admin.provision.errEmail')); }
      else if (code === 'name_required') { setFieldError('name');  setError(t('admin.provision.errName')); }
      else                               { setError(t('admin.provision.errFailed')); }
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setCreated(null);
    setFullName(''); setEmail(''); setPhone('');
    setCountry(DEFAULT_COUNTRY_CODE); setLang('en');
  }

  return (
    <div className="p-6 sm:p-8">
      <Link to="/admin/users" className="inline-flex items-center gap-1 text-sm text-brand-mid-grey hover:text-brand-near-black">
        <ArrowLeft className="size-3.5" /> {t('admin.provision.back')}
      </Link>

      {created ? (
        <Handover account={created} fullName={fullName} onAnother={reset} />
      ) : (
        <>
          <header className="mt-4 mb-6">
            <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.provision.title')}</h1>
            <p className="mt-1 max-w-2xl text-sm text-brand-mid-grey">{t('admin.provision.subtitle')}</p>
          </header>

          <form onSubmit={handleSubmit} noValidate className="max-w-xl space-y-5 rounded-2xl border border-brand-border-grey bg-white p-6">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">{t('admin.provision.fullName')}</Label>
              <Input
                id="fullName" autoComplete="off" value={fullName}
                onChange={e => setFullName(e.target.value)}
                aria-invalid={fieldError === 'name' || undefined}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">{t('admin.provision.email')}</Label>
              <Input
                id="email" type="email" autoComplete="off" value={email}
                onChange={e => setEmail(e.target.value)}
                aria-invalid={fieldError === 'email' || undefined}
              />
              <p className="text-xs text-brand-mid-grey">{t('admin.provision.emailHint')}</p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="phone">{t('admin.provision.phone')}</Label>
                <Input id="phone" type="tel" autoComplete="off" value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="country">{t('admin.provision.country')}</Label>
                <select
                  id="country" value={country} onChange={e => setCountry(e.target.value)}
                  className="h-9 w-full rounded-md border border-brand-border-grey bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-brand-near-black/20"
                >
                  {COUNTRIES.map(c => (
                    <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-brand-near-black">{t('admin.provision.lang')}</legend>
              <div className="flex gap-2">
                {(['en', 'fr'] as const).map(l => (
                  <label
                    key={l}
                    className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${lang === l ? 'border-brand-near-black bg-brand-near-black text-white' : 'border-brand-border-grey text-brand-near-black'}`}
                  >
                    <input type="radio" name="lang" value={l} checked={lang === l} onChange={() => setLang(l)} className="sr-only" />
                    {l === 'en' ? 'English' : 'Français'}
                  </label>
                ))}
              </div>
              <p className="text-xs text-brand-mid-grey">{t('admin.provision.langHint')}</p>
            </fieldset>

            {error && (
              <p role="alert" className="rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 text-sm text-brand-near-black">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={submitting} className="inline-flex items-center gap-2">
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                {submitting ? t('admin.provision.creating') : t('admin.provision.submit')}
              </Button>
              <span className="text-xs text-brand-mid-grey">{t('admin.provision.submitHint')}</span>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

/**
 * The one screen that shows the password. Everything the admin needs to hand over and
 * nothing that would survive leaving the page.
 */
function Handover({ account, fullName, onAnother }: { account: ProvisionedAccount; fullName: string; onAnother: () => void }) {
  const t = useT();
  return (
    <div className="mt-4 max-w-xl">
      <header className="mb-6">
        <div className="mb-3 inline-flex size-10 items-center justify-center rounded-full bg-brand-off-white">
          <ShieldCheck className="size-5 text-brand-near-black" />
        </div>
        <h1 className="text-2xl font-bold text-brand-near-black">{t('admin.provision.doneTitle', { name: fullName })}</h1>
        <p className="mt-1 text-sm text-brand-mid-grey">{t('admin.provision.doneSubtitle')}</p>
      </header>

      <div className="rounded-2xl border border-brand-border-grey bg-white p-6">
        <Credential label={t('admin.provision.username')} value={account.email} />
        <Credential label={t('admin.provision.tempPassword')} value={account.password} mono />

        <p className="mt-4 flex items-start gap-2 rounded-xl bg-brand-off-white px-3 py-2.5 text-xs leading-relaxed text-brand-near-black">
          <KeyRound className="mt-0.5 size-3.5 shrink-0" />
          <span>{t('admin.provision.onceWarning')}</span>
        </p>
      </div>

      <section className="mt-6 rounded-2xl border border-brand-border-grey bg-white p-6">
        <h2 className="text-sm font-semibold text-brand-near-black">{t('admin.provision.nextTitle')}</h2>
        <ol className="mt-3 space-y-2 text-sm text-brand-mid-grey">
          <li className="flex gap-2"><span className="font-semibold text-brand-near-black">1.</span> {t('admin.provision.next1')}</li>
          <li className="flex gap-2"><span className="font-semibold text-brand-near-black">2.</span> {t('admin.provision.next2')}</li>
          <li className="flex gap-2"><span className="font-semibold text-brand-near-black">3.</span> {t('admin.provision.next3')}</li>
        </ol>
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          to={`/admin/projects/new?for=${account.userId}`}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-near-black/90"
        >
          <FolderPlus className="size-4" /> {t('admin.provision.createProject')}
        </Link>
        <button type="button" onClick={onAnother} className="text-sm text-brand-mid-grey underline underline-offset-4 hover:text-brand-near-black">
          {t('admin.provision.another')}
        </button>
      </div>
    </div>
  );
}

function Credential({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Clipboard refused (insecure context, permissions). The value is on screen. */
    }
  }

  return (
    <div className="border-b border-brand-border-grey py-3 first:pt-0 last:border-b-0 last:pb-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <code className={`select-all break-all text-brand-near-black ${mono ? 'font-mono text-lg tracking-wide' : 'font-sans text-sm'}`}>
          {value}
        </code>
        <button
          type="button" onClick={copy}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-brand-border-grey px-2 py-1 text-xs text-brand-mid-grey hover:text-brand-near-black"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? t('admin.provision.copied') : t('admin.provision.copy')}
        </button>
      </div>
    </div>
  );
}
