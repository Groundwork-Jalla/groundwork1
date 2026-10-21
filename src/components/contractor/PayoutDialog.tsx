import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PhoneField } from '@/components/ui/PhoneField';
import { addPayoutDestination } from '@/lib/supabase/payout-destinations';
import { banksFor, PAYOUT_COUNTRY_CODES } from '@/lib/payments/banks';
import type { PayoutMethod } from '@/lib/payments/payout-destination';
import { DEFAULT_COUNTRY_CODE } from '@/lib/countries';
import { DIAL_COUNTRIES, isE164 } from '@/lib/phone';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/lib/i18n';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

// =========================================================
// Payment details, collected without leaving the onboarding form.
//
// This step used to be a link to /work/payouts. That walked somebody out of a form they
// had not finished and dropped them inside the dashboard, which reads as "you are done"
// when they are not — and most people did not come back to finish.
//
// So the same details are taken here, in place. It calls the SAME `add_payout_destination`
// RPC as the payouts page, so there is one way a destination is created and no second
// opinion about what a valid one looks like. The payouts page remains the place to
// manage them afterwards; this is only the first one.
// =========================================================

export function PayoutDialog({ onSaved, onClose }: {
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const { user } = useAuth();
  const [method, setMethod] = useState<PayoutMethod>('mobile_money');
  const [mobileNo, setMobileNo] = useState('');
  const [bankKey, setBankKey] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Only corridors we can actually pay into. Today that is Cameroon alone; the list is
  // derived from the bank table so opening a corridor is one edit there.
  const payoutCountries = DIAL_COUNTRIES.filter(c => PAYOUT_COUNTRY_CODES.includes(c.code));
  const [country, setCountry] = useState(
    () => (PAYOUT_COUNTRY_CODES.includes(DEFAULT_COUNTRY_CODE)
      ? DEFAULT_COUNTRY_CODE
      : (PAYOUT_COUNTRY_CODES[0] ?? DEFAULT_COUNTRY_CODE)));
  const banks = banksFor(country);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, busy]);

  /** The same rules the payouts page applies, so a destination cannot differ by origin. */
  function validate(): string | null {
    if (method === 'mobile_money') {
      if (!mobileNo.trim()) return t('contractorPayout.needMobile');
      if (!isE164(mobileNo)) return t('contractorPayout.badMobile');
    } else {
      if (!bankKey) return t('contractorPayout.needBank');
      if (!accountNumber.trim()) return t('contractorPayout.needAccount');
    }
    if (!accountName.trim()) return t('contractorPayout.needName');
    return null;
  }

  async function submit() {
    if (!user?.id) { setProblem(t('contractorOnboarding.err.not_signed_in')); return; }
    // PhoneField already emits E.164 for the country they chose; 099's CHECK refuses
    // anything else outright, so it is verified rather than re-derived here.
    const bad = validate();
    if (bad) { setProblem(bad); return; }

    setBusy(true); setProblem(null);
    try {
      await addPayoutDestination({
        ownerId: user.id, countryCode: country, method,
        mobileNo,
        bankKey, accountNumber: accountNumber.trim(), accountName: accountName.trim(),
        // The first destination is the default: there is nothing to choose between.
        makeDefault: true,
      });
      await onSaved();
    } catch (err) {
      setProblem(errorMessage(err, t('contractorPayout.failed')));
    } finally { setBusy(false); }
  }

  const field = 'mt-1 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-base sm:text-sm text-brand-near-black dark:border-[#444] dark:bg-[#141414] dark:text-white';
  const label = 'text-xs font-semibold text-brand-near-black dark:text-white';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      role="dialog" aria-modal="true" aria-label={t('contractorPayout.addTitle')}
    >
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white dark:bg-[#1e1e1e] sm:rounded-2xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-brand-border-grey px-5 py-4 dark:border-[#2c2c2c]">
          <div>
            <h2 className="text-base font-bold text-brand-near-black dark:text-white">{t('contractorPayout.addTitle')}</h2>
            <p className="mt-0.5 text-xs text-brand-mid-grey">{t('contractorOnboarding.payoutDialogBody')}</p>
          </div>
          <button
            type="button" onClick={onClose} disabled={busy}
            aria-label={t('contractorOnboarding.readerClose')}
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-brand-mid-grey hover:bg-brand-off-white disabled:opacity-40 dark:hover:bg-[#2c2c2c]"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <form
          onSubmit={e => { e.preventDefault(); void submit(); }}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5"
        >
          {/* The corridor. Hidden while there is only one — a select with a single
              option is noise — but it is what drives the bank list, the phone's dialling
              code AND the destination's stored country_code, so all three stay in step
              the day a second corridor opens. Without it, PhoneField would own the
              country privately and the bank list would silently disagree with it. */}
          {payoutCountries.length > 1 && (
            <label className="block">
              <span className={label}>{t('contractorPayout.country')}</span>
              <select
                value={country}
                onChange={e => { setCountry(e.target.value); setBankKey(''); setProblem(null); }}
                className={field}
              >
                {payoutCountries.map(c => (
                  <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                ))}
              </select>
            </label>
          )}

          <fieldset>
            <legend className={label}>{t('contractorPayout.method')}</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['mobile_money', 'bank'] as const).map(m => (
                <button
                  key={m} type="button" onClick={() => { setMethod(m); setProblem(null); }}
                  className={cn(
                    'rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                    method === m
                      ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                      : 'border-brand-border-grey text-brand-near-black dark:border-[#444] dark:text-white',
                  )}
                >
                  {t(m === 'bank' ? 'contractorPayout.bank' : 'contractorPayout.mobileMoney')}
                </button>
              ))}
            </div>
          </fieldset>

          {method === 'mobile_money' ? (
            <div>
              <span className={label}>{t('contractorPayout.mobileNo')}</span>
              {/* Narrowed to payout corridors, unlike an emergency contact: this number
                  has to be on a network the provider can actually reach. The choice
                  also becomes the destination's country_code. */}
              <PhoneField
                key={country}
                className="mt-1"
                value={mobileNo}
                onChange={setMobileNo}
                countries={payoutCountries}
                defaultCountry={country}
              />
            </div>
          ) : (
            <>
              <label className="block">
                <span className={label}>{t('contractorPayout.bankLabel')}</span>
                <select value={bankKey} onChange={e => setBankKey(e.target.value)} className={field}>
                  <option value="">—</option>
                  {banks.map(b => <option key={b.slug} value={b.slug}>{b.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={label}>{t('contractorPayout.accountNumber')}</span>
                <input
                  type="text" inputMode="numeric" value={accountNumber}
                  onChange={e => setAccountNumber(e.target.value)} className={field}
                />
              </label>
            </>
          )}

          <label className="block">
            <span className={label}>{t('contractorPayout.accountName')}</span>
            <input
              type="text" value={accountName} onChange={e => setAccountName(e.target.value)}
              className={field}
            />
          </label>

          {problem && <p role="alert" className="text-xs text-state-alert">{problem}</p>}

          <Button type="submit" disabled={busy} className="w-full">
            {busy
              ? <><Loader2 className="mr-1.5 size-3.5 animate-spin" />{t('contractorOnboarding.saving')}</>
              : t('contractorOnboarding.savePayout')}
          </Button>
        </form>
      </div>
    </div>
  );
}
