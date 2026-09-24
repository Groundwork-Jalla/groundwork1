import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { listAllPayments } from '@/lib/supabase/payments';
import { ownerLookup } from '@/lib/supabase/admin-users';
import { financialRows, financialTotals, type ProjectFinancialRow } from '@/lib/admin/financial-operations';
import { formatUSDFull } from '@/lib/budget';
import { errorMessage } from '@/lib/errors';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// Financial operations, across every project (01 §3, "Payments & Budgets").
//
// Groundwork's own business state — funded, authorised, in transit, disbursed, failed —
// summed per project from the 090 ledger, with the projects that need a person first.
// Every row opens that project's Financials tab, where the acts live; nothing is
// authorised, released or reconciled from here.
//
// No provider appears: not a reference, not a status, not a settlement time. How money
// moves is the provider's business and is never the system of record for a build's
// finances. The language stays neutral — funding, release, in transit — because what the
// arrangement is called legally is not settled.
// =========================================================

export function FinancialOperations() {
  const t = useT();
  const [rows, setRows] = useState<ProjectFinancialRow[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [ledger, projectsRes, owners] = await Promise.all([
        listAllPayments(),
        supabase.from('projects').select('id, name, user_id, status, tier, budget_usd').neq('status', 'archived'),
        ownerLookup(),
      ]);
      if (projectsRes.error) throw projectsRes.error;
      setAvailable(ledger.available);
      const projects = ((projectsRes.data ?? []) as unknown as Record<string, unknown>[]).map(p => ({
        id: String(p.id), name: String(p.name ?? ''),
        ownerName: owners.get(String(p.user_id))?.name || owners.get(String(p.user_id))?.email || '',
        status: typeof p.status === 'string' ? p.status : null,
        tier: typeof p.tier === 'string' ? p.tier : null,
        budgetUsd: p.budget_usd == null ? null : Number(p.budget_usd),
      }));
      setRows(financialRows(projects, ledger.rows));
      setError(null);
    } catch (err) {
      setRows([]); setError(errorMessage(err, t('common.somethingWrong')));
    }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const totals = rows ? financialTotals(rows) : null;

  return (
    <section className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-brand-border-grey px-5 py-3.5 dark:border-[#2c2c2c]">
        <div>
          <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{t('admin.finops.title')}</h2>
          <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.finops.subtitle')}</p>
        </div>
        {totals && available && (
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px]">
            <Total label={t('admin.finops.funded')}     value={formatUSDFull(totals.funded)} />
            <Total label={t('admin.finops.expected')}   value={formatUSDFull((rows ?? []).reduce((a, r) => a + r.expected, 0))} />
            <Total label={t('admin.finops.authorised')} value={formatUSDFull(totals.authorised)} />
            <Total label={t('admin.finops.inTransit')}  value={formatUSDFull(totals.inTransit)} />
            <Total label={t('admin.finops.disbursed')}  value={formatUSDFull(totals.disbursed)} />
          </dl>
        )}
      </header>

      {rows === null ? (
        <p className="flex items-center gap-2 px-5 py-6 text-xs text-brand-mid-grey"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</p>
      ) : error ? (
        <p role="alert" className="px-5 py-6 text-xs text-state-alert">{error}</p>
      ) : !available ? (
        <p className="px-5 py-6 text-center text-xs text-brand-mid-grey">{t('admin.ledger.unavailable')}</p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-brand-mid-grey">{t('admin.finops.empty')}</p>
      ) : (
        <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
          {rows.map(r => (
            <li key={r.projectId}>
              <Link to={`/admin/projects/${r.projectId}?tab=financials`}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-brand-off-white dark:hover:bg-[#252525]">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="truncate text-sm font-medium text-brand-near-black dark:text-white">{r.projectName}</span>
                    {r.attention && (
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        r.attention === 'failed' ? 'bg-state-alert/10 text-state-alert'
                        : r.attention === 'reconciling' ? 'bg-state-held/10 text-state-held'
                        : 'bg-brand-off-white text-brand-mid-grey dark:bg-[#252525]')}>
                        {t(`admin.finops.attention.${r.attention}` as TKey)}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-brand-mid-grey">
                    {r.ownerName}
                    {r.budgetUsd != null ? ` · ${t('admin.finops.budget')} ${formatUSDFull(r.budgetUsd)}` : ` · ${t('admin.finops.noBudget')}`}
                    {!r.hasLedger
                      ? ` · ${t('admin.finops.noLedger')}`
                      : r.funded === 0 && r.expected > 0 ? ` · ${t('admin.finops.awaitingFunding')}` : ''}
                  </span>
                </span>

                {/* Nothing funded yet is not the same as nothing happening: a build whose
                    tranche is expected shows what it is waiting on, rather than three zeros. */}
                {r.hasLedger && (
                  <span className="hidden shrink-0 gap-4 text-[11px] sm:flex">
                    {r.funded === 0 && r.expected > 0 ? (
                      <Figure label={t('admin.finops.expected')} value={r.expected} emphasis />
                    ) : (
                      <>
                        <Figure label={t('admin.finops.funded')}    value={r.funded} />
                        <Figure label={t('admin.finops.available')} value={r.available} emphasis />
                        <Figure label={t('admin.finops.disbursed')} value={r.disbursed} />
                      </>
                    )}
                  </span>
                )}
                <ChevronRight className="size-4 shrink-0 text-brand-muted-grey" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-brand-muted-grey">{label}</dt>
      <dd className="font-semibold tabular-nums text-brand-near-black dark:text-white">{value}</dd>
    </div>
  );
}

function Figure({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <span className="text-right">
      <span className="block text-brand-muted-grey">{label}</span>
      <span className={cn('block font-semibold tabular-nums', emphasis ? 'text-brand-near-black dark:text-white' : 'text-brand-mid-grey')}>
        {formatUSDFull(value)}
      </span>
    </span>
  );
}
