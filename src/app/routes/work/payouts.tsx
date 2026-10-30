import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, Plus, ShieldCheck, Clock, Ban, Star } from 'lucide-react';
import { fetchAssignedProjects, fetchMyPayments,
         type AssignedProject, type ContractorPayment } from '@/lib/supabase/contractor-work';
import { moneyPair } from '@/lib/budget/money-pair';
import { useProjectMoney } from '@/lib/budget/use-project-money';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
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
  /** What has actually been released, and what the live contracts still carry. Read
      separately: a failure in either must not cost the page its payment details. */
  const [payments, setPayments] = useState<{ rows: ContractorPayment[]; available: boolean } | null>(null);
  const [projects, setProjects] = useState<AssignedProject[] | null>(null);

  async function reload() {
    try { setRows(await fetchMyPayoutDestinations()); }
    catch (err) { setRows([]); setError(errorMessage(err, t('contractor.loadFailed'))); }
  }

  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    let alive = true;
    void fetchMyPayments()
      .then(p => { if (alive) setPayments(p); })
      .catch(() => { if (alive) setPayments({ rows: [], available: false }); });
    void fetchAssignedProjects()
      .then(p => { if (alive) setProjects(p); })
      .catch(() => { if (alive) setProjects([]); });
    return () => { alive = false; };
  }, []);

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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">
            {t('contractorPayout.navLabel')}
          </h1>
          <p className="mt-1 text-sm text-brand-mid-grey">{t('contractorPayout.subtitle')}</p>
        </div>
        <button type="button" onClick={() => setAdding(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-near-black px-3.5 py-2 text-sm font-semibold text-white dark:bg-white dark:text-brand-near-black">
          <Plus className="size-4" aria-hidden />{t('contractorPayout.addTitle')}
        </button>
      </header>

      <PayoutFigures payments={payments} projects={projects} />

      {error && (
        <p role="alert" className="rounded-xl border border-state-alert/30 bg-brand-off-white px-4 py-3 text-sm dark:bg-[#1e1e1e]">
          {error}
        </p>
      )}

      <div className="-mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold tracking-tight text-brand-near-black dark:text-white">
          {t('contractorPayout.whereYouGetPaid')}
        </h2>
        <p className="text-xs text-brand-mid-grey">{t('contractorPayout.usedEverywhere')}</p>
      </div>

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

      <div className="grid items-start gap-5 lg:grid-cols-[3fr_2fr]">
        <PaymentsReceived payments={payments} projects={projects} />

        <div className="flex flex-col gap-4">
          {/* "Why we ask for this" moved to the onboarding payout step (30 Oct 2026).
              It answers a question somebody has while they are being asked for an
              account number, not months later on a page they opened to check what
              they were paid. */}
          <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
              {t('contractorPayout.releasedWhen')}
            </h2>
            <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-brand-border-grey py-2.5 dark:border-[#2c2c2c]">
              <span className="text-[13px] font-semibold text-brand-near-black dark:text-white">
                {t('contractorPayout.stepApproved')}
              </span>
              {/* "By an independent verifier" removed 30 Oct 2026 — Favour pointed at
                  it as "the number 2 field". It goes with the rest of verification
                  being hidden. The row still states WHAT happens; it no longer
                  names who, because naming the wrong actor would be worse than
                  naming none. */}
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-brand-border-grey py-2.5 dark:border-[#2c2c2c]">
              <span className="text-[13px] font-semibold text-brand-near-black dark:text-white">
                {t('contractorPayout.stepChecked')}
              </span>
              <span className="shrink-0 text-right text-[11px] text-brand-mid-grey">
                {t('contractorPayout.stepCheckedWhen')}
              </span>
            </div>
            {/* Groundwork records and governs the schedule. A licensed provider holds
                and moves the money, and nothing on this page may imply otherwise. */}
            <p className="mt-2 text-xs text-brand-mid-grey">{t('contractorPayout.notCustodian')}</p>
          </section>

          <TodaysRate projects={projects} />
        </div>
      </div>
    </div>
  );
}

/**
 * Three figures, all from rows this contractor can actually read.
 *
 * "Received" is the ledger. "Due on the next approval" and "still to come" are the
 * stage schedule across their live builds. Mixed currencies are never summed — the
 * card says how many payments instead of inventing a total that means nothing.
 */
function PayoutFigures({ payments, projects }: {
  payments: { rows: ContractorPayment[]; available: boolean } | null;
  projects: AssignedProject[] | null;
}) {
  const t = useT();
  // The schedule is stored in USD; show it in the currency of the builds themselves
  // when they agree on one, which for a Cameroon-first contractor they will.
  const countries = new Set((projects ?? []).map(a => a.project.country).filter(Boolean));
  const money = useProjectMoney(countries.size === 1 ? [...countries][0] : null);

  const openStages = (projects ?? []).flatMap(a => a.activeStage ? [a.activeStage] : []);
  const dueNext = openStages.reduce((sum, s) => sum + (s.payment_milestone_usd ?? 0), 0);
  const toCome = (projects ?? []).reduce((sum, a) => sum + a.stages
    .filter(s => s.status !== 'complete')
    .reduce((n, s) => n + (s.payment_milestone_usd ?? 0), 0), 0);

  const received = (() => {
    if (payments === null) return { value: null as string | null, hint: t('common.loading') };
    if (!payments.available) return { value: null, hint: t('contractor.kpi.unavailable') };
    if (payments.rows.length === 0) return { value: null, hint: t('contractorDashboard.noReleases') };
    const codes = new Set(payments.rows.map(r => r.currency.toUpperCase()));
    if (codes.size > 1) {
      return { value: String(payments.rows.length),
               hint: t('contractorDashboard.tileReleasedMixed', { n: String(payments.rows.length) }) };
    }
    const total = payments.rows.reduce((sum, r) => sum + r.amount, 0);
    const code = [...codes][0];
    const pair = moneyPair(total, code, code === 'USD' ? null : money.rate);
    return { value: pair.local,
             hint: pair.usd ? `${code} · ≈ ${pair.usd}`
                            : t('contractorDashboard.tileReleasedCount', { n: String(payments.rows.length) }) };
  })();

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Figure label={t('contractorPayout.receivedThisYear')} value={received.value}
              hint={received.hint} tone="complete" />
      <Figure label={t('contractorPayout.dueNext')}
              value={projects === null ? null : money.pair(dueNext)?.local ?? null}
              sub={projects === null ? undefined : money.pair(dueNext)?.usd ?? undefined}
              hint={t('contractorPayout.dueNextHint', { n: openStages.length })} />
      <Figure label={t('contractorPayout.acrossContracts')}
              value={projects === null ? null : money.pair(toCome)?.local ?? null}
              sub={projects === null ? undefined : money.pair(toCome)?.usd ?? undefined}
              hint={t('contractorPayout.acrossContractsHint', { n: (projects ?? []).length })} />
    </div>
  );
}

function Figure({ label, value, sub, hint, tone }: {
  label: string; value: string | null; sub?: string; hint?: string; tone?: 'complete';
}) {
  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white px-4 py-3.5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-brand-mid-grey">{label}</p>
      <p className={cn('mt-1.5 font-mono text-xl font-semibold tabular-nums tracking-tight',
        tone === 'complete' && value ? 'text-state-complete' : 'text-brand-near-black dark:text-white')}>
        {/* A dash, not a zero: "could not read" and "none" are different facts. */}
        {value ?? '—'}
      </p>
      {sub && <p className="mt-0.5 font-mono text-[11px] text-brand-mid-grey">≈ {sub}</p>}
      {hint && <p className="mt-1 text-xs text-brand-mid-grey">{hint}</p>}
    </div>
  );
}

/** Every release recorded against this contractor, newest first. */
function PaymentsReceived({ payments, projects }: {
  payments: { rows: ContractorPayment[]; available: boolean } | null;
  projects: AssignedProject[] | null;
}) {
  const t = useT();
  const names = useMemo(
    () => new Map((projects ?? []).map(a => [a.project.id, a.project.name])),
    [projects],
  );

  return (
    <section>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">
          {t('contractorPayout.paymentsReceived')}
        </h2>
        {/* A real statement, built from the rows already on screen — a link that
            downloads nothing is worse than no link. */}
        <button type="button" disabled={!payments?.available || payments.rows.length === 0}
          onClick={() => downloadStatement(payments?.rows ?? [], names)}
          className="text-xs text-brand-mid-grey underline underline-offset-2 disabled:opacity-40">
          {t('contractorPayout.downloadStatement')}
        </button>
      </div>

      <div className="rounded-2xl border border-brand-border-grey bg-white px-4 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
        {payments === null ? (
          <p className="py-6 text-sm text-brand-mid-grey">{t('common.loading')}</p>
        ) : !payments.available ? (
          <p className="py-6 text-sm text-brand-mid-grey">{t('contractorPayments.unavailable')}</p>
        ) : payments.rows.length === 0 ? (
          <p className="py-6 text-sm text-brand-mid-grey">{t('contractorPayments.none')}</p>
        ) : (
          <ul>
            {payments.rows.map(p => (
              <li key={p.id}
                  className="flex items-center justify-between gap-3 border-b border-brand-border-grey py-3 last:border-b-0 dark:border-[#2c2c2c]">
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-brand-near-black dark:text-white">
                    {p.note ?? names.get(p.projectId) ?? t('contractorPayments.milestone')}
                  </span>
                  {/* The project name is the heading when the row has no note of its
                      own, so repeating it underneath would print it twice. */}
                  <span className="block text-[11px] text-brand-mid-grey">
                    {[p.note ? names.get(p.projectId) : null, formatDate(p.createdAt)]
                      .filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-brand-near-black dark:text-white">
                  {moneyPair(p.amount, p.currency, null).local}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
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

/**
 * What a dollar buys today, in the currency this contractor actually works in.
 *
 * The rate is fetched once per session and shared with every other figure on the
 * surface (use-project-money.ts), so the number quoted here is the number the stage
 * amounts were converted at — not a second opinion. The currency follows their
 * builds; if they run projects in more than one country there is no single answer,
 * so the card says nothing rather than picking one.
 */
function TodaysRate({ projects }: { projects: AssignedProject[] | null }) {
  const t = useT();
  const countries = new Set((projects ?? []).map(a => a.project.country).filter(Boolean));
  const only = countries.size === 1 ? [...countries][0] : null;
  const money = useProjectMoney(only);

  if (projects === null || only === null || money.code === 'USD') return null;

  return (
    <section className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-brand-mid-grey">
        {t('contractorPayout.todaysRate')}
      </h2>
      <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-brand-near-black dark:text-white">
        {money.rate.toLocaleString('en-US', { maximumFractionDigits: 2 })}
      </p>
      <p className="mt-0.5 font-mono text-[11px] text-brand-mid-grey">
        {t('contractorPayout.rateLine', { code: money.code })}
      </p>
      <p className="mt-2.5 text-xs text-brand-mid-grey">
        {t('contractorPayout.paidInLocal', { code: money.code })}
      </p>
    </section>
  );
}

/**
 * The payments received, as a CSV the contractor can keep or send on.
 *
 * Built in the browser from rows already loaded: no endpoint, nothing re-fetched,
 * and nothing leaves Groundwork that was not already on the screen.
 */
function downloadStatement(rows: ContractorPayment[], names: Map<string, string>) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = [
    ['Date', 'Project', 'Note', 'Amount', 'Currency'].join(','),
    ...rows.map(r => [
      esc(r.createdAt.slice(0, 10)),
      esc(names.get(r.projectId) ?? ''),
      esc(r.note ?? ''),
      String(r.amount),
      esc(r.currency),
    ].join(',')),
  ].join('\n');

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `groundwork-payments-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
