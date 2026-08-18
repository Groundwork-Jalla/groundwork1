import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, Download, Printer } from 'lucide-react';
import { COUNTRIES, DEFAULT_COUNTRY_CODE } from '@/lib/countries';
import { getStageSeed } from '@/lib/supabase/stage-seeds';
import { useT, useFormat, type TKey } from '@/lib/i18n';
import { useDomainLabels } from '@/lib/domain-labels';

const STAGE_DAYS = [14, 21, 7, 14, 70, 14, 14, 21, 14, 7];

export default function MilestonesTool() {
  const t = useT();
  // See budget.tsx: the bare money helpers do not follow the language toggle.
  const f = useFormat();
  const labels = useDomainLabels();
  const [budget, setBudget] = useState(100000);
  const [country, setCountry] = useState(DEFAULT_COUNTRY_CODE);

  const stages = useMemo(() => getStageSeed('residential', 'single_family', 1), []);

  const milestones = useMemo(() =>
    stages.map((s, i) => ({
      ...s,
      // `budget` here is the construction fee the visitor typed, not a client total —
      // this tool has no project and therefore no fee lines to strip out first.
      amountUsd: Math.round(budget * s.budget_pct / 100),
      durationDays: STAGE_DAYS[i],
      whenToPayKey: `tools.whenToPay.s${i + 1}` as TKey,
    })),
    [stages, budget],
  );

  const handlePrint = useCallback(() => window.print(), []);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 print:px-0 print:py-4">
      {/* Non-print header */}
      <div className="print:hidden">
        <Link to="/tools" className="inline-flex items-center gap-1 text-xs text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white mb-8 transition-colors">
          <ChevronLeft className="size-3.5" /> {t('tools.backToTools')}
        </Link>

        <h1 className="text-2xl sm:text-3xl font-black text-brand-near-black dark:text-white mb-2">{t('tools.milestonesTitle')}</h1>
        <p className="text-sm text-brand-mid-grey mb-10">
          {t('tools.milestonesSub')}
        </p>

        {/* Inputs */}
        <div className="grid sm:grid-cols-2 gap-4 mb-10">
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <label className="block text-xs font-semibold text-brand-near-black dark:text-white mb-2 uppercase tracking-wide">
              {t('tools.totalBudget')}
            </label>
            <input
              type="number"
              min={10000}
              max={5000000}
              step={1000}
              value={budget}
              onChange={e => setBudget(Math.max(0, Number(e.target.value)))}
              className="w-full rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#282828] text-sm text-brand-near-black dark:text-white px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-near-black dark:focus:ring-white tabular-nums"
            />
          </div>
          <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-5">
            <label className="block text-xs font-semibold text-brand-near-black dark:text-white mb-2 uppercase tracking-wide">
              {t('tools.country')}
            </label>
            <select
              value={country}
              onChange={e => setCountry(e.target.value)}
              className="w-full rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#282828] text-sm text-brand-near-black dark:text-white px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-near-black dark:focus:ring-white"
            >
              {COUNTRIES.map(c => (
                <option key={c.code} value={c.code}>{c.flag} {labels.country(c.code)}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mb-8">
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] px-3 py-2 text-xs font-medium text-brand-near-black dark:text-white hover:bg-brand-off-white dark:hover:bg-[#282828] transition-colors"
          >
            <Printer className="size-3.5" /> {t('tools.print')}
          </button>
        </div>
      </div>

      {/* Print-only header */}
      <div className="hidden print:block mb-6">
        <p className="text-lg font-black">{t('tools.scheduleTitle')}</p>
        <p className="text-sm text-gray-500">{t('tools.printMeta', { total: f.money(budget) })}</p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] print:rounded-none print:border-gray-200">
        <table className="w-full min-w-150 text-sm">
          <thead>
            <tr className="bg-brand-near-black dark:bg-[#111] print:bg-gray-900">
              <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wide">#</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wide">{t('tools.colStage')}</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-white uppercase tracking-wide">{t('tools.colDuration')}</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-white uppercase tracking-wide">{t('tools.colMilestone')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wide hidden sm:table-cell">{t('tools.colWhenToPay')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-off-white dark:divide-[#2c2c2c] print:divide-gray-100">
            {milestones.map((m, i) => (
              <tr key={m.stage_number} className={i % 2 === 1 ? 'bg-brand-off-white/50 dark:bg-[#1a1a1a]' : 'bg-white dark:bg-[#1e1e1e]'}>
                <td className="px-4 py-3 text-xs text-brand-mid-grey tabular-nums">{m.stage_number}</td>
                <td className="px-4 py-3 text-sm font-medium text-brand-near-black dark:text-white">{t(`stages.${m.key}` as TKey)}</td>
                <td className="px-4 py-3 text-xs text-brand-mid-grey text-right tabular-nums">{t('tools.durationShort', { days: m.durationDays })}</td>
                <td className="px-4 py-3 text-sm font-bold text-brand-near-black dark:text-white text-right tabular-nums">
                  {f.money(m.amountUsd)}
                  <span className="ml-1 text-[10px] font-normal text-brand-mid-grey">({t('tools.pctValue', { pct: m.budget_pct })})</span>
                </td>
                <td className="px-4 py-3 text-xs text-brand-mid-grey hidden sm:table-cell">{t(m.whenToPayKey)}</td>
              </tr>
            ))}
            <tr className="bg-brand-near-black dark:bg-[#111] print:bg-gray-900">
              <td className="px-4 py-3" colSpan={2}><span className="text-xs font-bold text-white">{t('tools.total')}</span></td>
              <td />
              <td className="px-4 py-3 text-right">
                <span className="text-sm font-black text-white tabular-nums">{f.money(budget)}</span>
              </td>
              <td className="hidden sm:table-cell" />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Safety note */}
      <div className="mt-6 rounded-xl border border-state-held/30 dark:border-state-held bg-brand-off-white dark:bg-state-held/20 px-4 py-3 print:hidden">
        <p className="text-xs text-state-held dark:text-state-held leading-relaxed">
          <span className="font-semibold">{t('tools.safetyTip')}</span> {t('tools.safetyBody')}
        </p>
      </div>

      {/* CTA */}
      <div className="mt-8 print:hidden rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-brand-off-white dark:bg-[#1a1a1a] p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <p className="text-xs text-brand-mid-grey">
          <span className="font-semibold text-brand-near-black dark:text-white">{t('tools.buildingSoon')}</span> {t('tools.milestonesCta')}
        </p>
        <Link to="/auth/signup" className="shrink-0 inline-flex rounded-lg bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black px-3 py-2 text-xs font-semibold hover:opacity-90 transition-opacity">
          {t('tools.getStartedFree')}
        </Link>
      </div>
    </div>
  );
}
