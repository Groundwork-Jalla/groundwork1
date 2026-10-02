import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, ShieldCheck, Clock, Ban, Star } from 'lucide-react';
import {
  fetchMyPayoutDestinations, addPayoutDestination,
  setDefaultPayoutDestination, retirePayoutDestination,
} from '@/lib/supabase/payout-destinations';
import { maskDestination, type PayoutDestination, type PayoutMethod } from '@/lib/payments/payout-destination';
import { banksFor } from '@/lib/payments/banks';
import { DEFAULT_COUNTRY_CODE } from '@/lib/countries';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/lib/i18n';
import { errorMessage } from '@/lib/errors';

// =========================================================
// /work/payouts — where this contractor is paid.
//
// Given once, used on every project they are assigned to: a destination belongs to the
// ACCOUNT, not to an assignment (099's reasoning — putting it on the invite would copy a
// bank account per project and let the copies disagree).
//
// The page never claims a saved destination is usable. `status` starts `unverified` and only
// a staff act moves it, so what a contractor sees here is "on file, awaiting a check" — the
// truthful state, and the one that explains why a payment has not moved yet.
// =========================================================

export default function ContractorPayouts() {
  const t = useT();
  const { user } = useAuth();
  const [rows, setRows] = useState<PayoutDestination[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    try { setRows(await fetchMyPayoutDestinations()); }
    catch (err) { setRows([]); setError(errorMessage(err, t('contractor.loadFailed'))); }
  }

  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const live = useMemo(() => (rows ?? []).filter(r => r.status !== 'retired'), [rows]);
  const retired = useMemo(() => (rows ?? []).filter(r => r.status === 'retired'), [rows]);

  async function act(id: string, fn: (id: string) => Promise<void>) {
    setBusyId(id); setError(null);
    try { await fn(id); await reload(); }
    catch (err) { setError(errorMessage(err, t('contractorPayout.failed'))); }
    finally { setBusyId(null); }
  }

  if (rows === null) {
    return (
      <p className="flex items-center gap-2 py-16 text-sm text-brand-mid-grey">
        <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">
          {t('contractorPayout.title')}
        </h1>
        <p className="mt-1 text-sm text-brand-mid-grey">{t('contractorPayout.subtitle')}</p>
      </header>

      <p className="rounded-xl bg-brand-off-white px-4 py-3 text-sm text-brand-mid-grey dark:bg-[#1e1e1e]">
        {t('contractorPayout.why')}
      </p>

      {error && (
        <p role="alert" className="rounded-xl border border-state-alert/30 bg-brand-off-white px-4 py-3 text-sm dark:bg-[#1e1e1e]">
          {error}
        </p>
      )}

      {live.length === 0 && !adding ? (
        <div className="rounded-2xl border border-dashed border-brand-border-grey px-4 py-12 text-center dark:border-[#2c2c2c]">
          <p className="text-sm font-medium text-brand-near-black dark:text-white">{t('contractorPayout.empty')}</p>
          <button
            type="button" onClick={() => setAdding(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-near-black px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-brand-near-black"
          >
            <Plus className="size-4" aria-hidden />{t('contractorPayout.emptyCta')}
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {live.map(d => (
            <DestinationRow
              key={d.id} d={d} busy={busyId === d.id}
              onDefault={() => act(d.id, setDefaultPayoutDestination)}
              onRetire={() => { if (confirm(t('contractorPayout.retireConfirm'))) void act(d.id, retirePayoutDestination); }}
            />
          ))}
        </ul>
      )}

      {live.length > 0 && !adding && (
        <div>
          <button
            type="button" onClick={() => setAdding(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-brand-border-grey px-4 py-2 text-sm font-semibold text-brand-near-black dark:border-[#2c2c2c] dark:text-white"
          >
            <Plus className="size-4" aria-hidden />{t('contractorPayout.addTitle')}
          </button>
          <p className="mt-2 text-xs text-brand-mid-grey">{t('contractorPayout.editHint')}</p>
        </div>
      )}

      {adding && user?.id && (
        <AddDestination
          ownerId={user.id}
          firstOne={live.length === 0}
          onDone={() => { setAdding(false); void reload(); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {retired.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-brand-mid-grey">
            {t('contractorPayout.statusRetired')}
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {retired.map(d => <DestinationRow key={d.id} d={d} busy={false} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

function DestinationRow({ d, busy, onDefault, onRetire }: {
  d: PayoutDestination; busy: boolean;
  onDefault?: () => void; onRetire?: () => void;
}) {
  const t = useT();
  const Icon = d.status === 'verified' ? ShieldCheck : d.status === 'retired' ? Ban : Clock;
  const statusKey = d.status === 'verified' ? 'statusVerified' : d.status === 'retired' ? 'statusRetired' : 'statusUnverified';

  return (
    <li className="rounded-xl border border-brand-border-grey px-4 py-3 dark:border-[#2c2c2c]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-brand-near-black dark:text-white">
            {t(d.method === 'mobile_money' ? 'contractorPayout.mobileMoney' : 'contractorPayout.bank')}
            {d.isDefault && d.status !== 'retired' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-off-white px-2 py-0.5 text-[11px] font-semibold text-brand-mid-grey dark:bg-[#252525]">
                <Star className="size-3" aria-hidden />{t('contractorPayout.isDefault')}
              </span>
            )}
          </p>
          {/* Masked, always. The full number is never rendered back to the screen. */}
          <p className="mt-0.5 truncate font-mono text-sm text-brand-mid-grey">{maskDestination(d)}</p>
          {d.accountName && <p className="truncate text-xs text-brand-mid-grey">{d.accountName}</p>}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-brand-mid-grey">
          <Icon className="size-3.5" aria-hidden />{t(`contractorPayout.${statusKey}`)}
        </span>
      </div>

      {d.status === 'unverified' && (
        <p className="mt-2 text-xs text-brand-mid-grey">{t('contractorPayout.unverifiedNote')}</p>
      )}

      {(onDefault || onRetire) && d.status !== 'retired' && (
        <div className="mt-3 flex items-center gap-3">
          {onDefault && !d.isDefault && (
            <button type="button" onClick={onDefault} disabled={busy}
              className="text-xs font-semibold underline underline-offset-2 disabled:opacity-40">
              {busy ? t('contractorPayout.retiring') : t('contractorPayout.setDefault')}
            </button>
          )}
          {onRetire && (
            <button type="button" onClick={onRetire} disabled={busy}
              className="text-xs font-semibold text-state-alert underline underline-offset-2 disabled:opacity-40">
              {t('contractorPayout.retire')}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The form. Validation here mirrors 099's constraints rather than inventing its own: E.164
 * for a phone, one method's fields only. The database is still the authority — this exists
 * so the common mistake is caught before a round trip, not so the check can be skipped.
 */
function AddDestination({ ownerId, firstOne, onDone, onCancel }: {
  ownerId: string; firstOne: boolean; onDone: () => void; onCancel: () => void;
}) {
  const t = useT();
  const [method, setMethod] = useState<PayoutMethod>('mobile_money');
  const [country] = useState(DEFAULT_COUNTRY_CODE);
  const [mobileNo, setMobileNo] = useState('');
  const [bankKey, setBankKey] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  // The first one is the default, and there is nothing to choose between.
  const [makeDefault, setMakeDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const banks = banksFor(country);

  function validate(): string | null {
    if (method === 'mobile_money') {
      const n = mobileNo.replace(/\s/g, '');
      if (!n) return t('contractorPayout.needMobile');
      if (!/^\+[0-9]{7,15}$/.test(n)) return t('contractorPayout.badMobile');
    } else {
      if (!bankKey) return t('contractorPayout.needBank');
      if (!accountNumber.trim()) return t('contractorPayout.needAccount');
    }
    if (!accountName.trim()) return t('contractorPayout.needName');
    return null;
  }

  async function submit() {
    const bad = validate();
    if (bad) { setProblem(bad); return; }
    setBusy(true); setProblem(null);
    try {
      await addPayoutDestination({
        ownerId, countryCode: country, method,
        mobileNo: mobileNo.replace(/\s/g, ''),
        bankKey, accountNumber: accountNumber.trim(), accountName: accountName.trim(),
        makeDefault: firstOne || makeDefault,
      });
      onDone();
    } catch (err) {
      setProblem(errorMessage(err, t('contractorPayout.failed')));
    } finally { setBusy(false); }
  }

  const field = 'mt-1 w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e] dark:text-white';
  const label = 'text-xs font-semibold text-brand-near-black dark:text-white';

  return (
    <section className="rounded-2xl border border-brand-border-grey p-4 dark:border-[#2c2c2c]">
      <h2 className="text-sm font-bold text-brand-near-black dark:text-white">{t('contractorPayout.addTitle')}</h2>

      <fieldset className="mt-4">
        <legend className={label}>{t('contractorPayout.method')}</legend>
        <div className="mt-2 flex gap-2">
          {(['mobile_money', 'bank'] as PayoutMethod[]).map(m => (
            <button
              key={m} type="button" onClick={() => { setMethod(m); setProblem(null); }}
              aria-pressed={method === m}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                method === m
                  ? 'border-brand-near-black bg-brand-near-black text-white dark:border-white dark:bg-white dark:text-brand-near-black'
                  : 'border-brand-border-grey text-brand-near-black dark:border-[#2c2c2c] dark:text-white'}`}
            >
              {t(m === 'mobile_money' ? 'contractorPayout.mobileMoney' : 'contractorPayout.bank')}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {method === 'mobile_money' ? (
          <label className="sm:col-span-2">
            <span className={label}>{t('contractorPayout.mobileNo')}</span>
            <input
              type="tel" inputMode="tel" value={mobileNo} autoComplete="tel"
              onChange={e => setMobileNo(e.target.value)}
              placeholder="+237 6 70 00 00 00" className={field}
            />
            <span className="mt-1 block text-xs text-brand-mid-grey">{t('contractorPayout.mobileHint')}</span>
          </label>
        ) : (
          <>
            <label>
              <span className={label}>{t('contractorPayout.bankLabel')}</span>
              <select value={bankKey} onChange={e => setBankKey(e.target.value)} className={field}>
                <option value="">—</option>
                {banks.map(b => <option key={b.slug} value={b.slug}>{b.name}</option>)}
              </select>
            </label>
            <label>
              <span className={label}>{t('contractorPayout.accountNumber')}</span>
              <input
                type="text" inputMode="numeric" value={accountNumber}
                onChange={e => setAccountNumber(e.target.value)} className={field}
              />
            </label>
          </>
        )}

        <label className="sm:col-span-2">
          <span className={label}>{t('contractorPayout.accountName')}</span>
          <input type="text" value={accountName} onChange={e => setAccountName(e.target.value)} className={field} />
          <span className="mt-1 block text-xs text-brand-mid-grey">{t('contractorPayout.accountNameHint')}</span>
        </label>
      </div>

      {!firstOne && (
        <label className="mt-4 flex items-center gap-2 text-sm text-brand-near-black dark:text-white">
          <input type="checkbox" checked={makeDefault} onChange={e => setMakeDefault(e.target.checked)} />
          {t('contractorPayout.makeDefault')}
        </label>
      )}

      {problem && <p role="alert" className="mt-3 text-sm text-state-alert">{problem}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button" onClick={submit} disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-near-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-brand-near-black"
        >
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {busy ? t('contractorPayout.adding') : t('contractorPayout.add')}
        </button>
        <button type="button" onClick={onCancel} className="text-sm font-semibold text-brand-mid-grey">
          {t('common.cancel')}
        </button>
      </div>
    </section>
  );
}
