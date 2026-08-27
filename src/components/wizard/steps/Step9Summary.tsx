import { motion } from 'framer-motion';
import {
  MapPin, Building2, Layers, Home, Wrench,
  ShieldCheck, Info, CalendarDays,
} from 'lucide-react';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import { BUDGET_SLICES, calculateBudgetDetail, formatUSDFull, formatLocalCurrency } from '@/lib/budget';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useDomainLabels } from '@/lib/domain-labels';

const PREDICTED_DAYS = 196;

/** The three lines added to the construction subtotal. BUDGET_SLICES minus construction. */
const FEE_LINES = BUDGET_SLICES.filter(s => s.key !== 'construction');

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Label helpers ─────────────────────────────────────────

// ── Budget breakdown display ───────────────────────────────

function BudgetBreakdownCard() {
  const t = useT();
  const { data, constructionRate, cityRate, rateLoading } = useWizard();
  const detail = calculateBudgetDetail(data, constructionRate, cityRate);
  const isVerified = detail.dataSource === 'real_bq';
  const maxAmount  = Math.max(...detail.sections.map(s => s.amountUSD), 1);

  if (rateLoading) {
    return (
      <div className="rounded-xl border border-brand-border-grey p-5 animate-pulse">
        <div className="h-3 w-40 bg-brand-light-grey rounded mb-3" />
        <div className="h-8 w-32 bg-brand-light-grey rounded mb-4" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 mb-2.5">
            <div className="h-2.5 w-28 bg-brand-light-grey rounded" />
            <div className="flex-1 h-1.5 bg-brand-light-grey rounded-full" />
            <div className="h-2.5 w-14 bg-brand-light-grey rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-brand-border-grey overflow-hidden">

      {/* Header */}
      <div className="px-5 py-4 border-b border-brand-off-white">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-semibold text-brand-near-black">{t('wizard.budgetEstimate')}</p>
              <span className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide border',
                isVerified
                  ? 'bg-brand-off-white text-state-complete border-state-complete/30'
                  : 'bg-brand-off-white text-state-held border-state-held/30',
              )}>
                {isVerified ? <><ShieldCheck className="size-2.5" /> {t('wizard.verifiedData')}</> : <><Info className="size-2.5" /> {t('wizard.regionalEstimate')}</>}
              </span>
            </div>
            <p className="text-[10px] text-brand-mid-grey">
              {isVerified
                ? 'Based on real BQ data for this country'
                : 'Indexed from comparable markets — no verified BQ yet'}
            </p>
          </div>
          {/*
            The headline is the CLIENT total — construction plus design, professional and
            permit. `detail.total` is construction alone; it is what the trade sections
            below add up to, and it is shown as their subtotal rather than as the price.
          */}
          <div className="text-right shrink-0">
            <p className="text-2xl font-black tabular-nums text-brand-near-black">
              {formatUSDFull(detail.budget.total)}
            </p>
            {detail.currencyCode !== 'USD' && (
              <p className="text-xs text-brand-mid-grey tabular-nums mt-0.5">
                ~{formatLocalCurrency(Math.round(detail.budget.total * detail.approxFxRate), detail.currencyCode)}
                <span className="text-[9px] ml-1">(approx.)</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Trade sections */}
      <div className="px-5 py-4 space-y-3">
        {detail.sections.map((section, i) => {
          const barW = (section.amountUSD / maxAmount) * 100;
          return (
            <motion.div key={section.key}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}>
              <div className="flex items-baseline justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm shrink-0" style={{ backgroundColor: section.color }} />
                  <span className="text-xs font-medium text-brand-near-black">{section.label}</span>
                </div>
                <div className="flex items-baseline gap-2 shrink-0">
                  <span className="text-[10px] text-brand-mid-grey tabular-nums">{section.pct}%</span>
                  <span className="text-xs font-bold tabular-nums text-brand-near-black">
                    {formatUSDFull(section.amountUSD)}
                  </span>
                  {detail.currencyCode !== 'USD' && (
                    <span className="text-[9px] tabular-nums text-brand-mid-grey hidden sm:block">
                      ~{formatLocalCurrency(section.amountLocal, detail.currencyCode)}
                    </span>
                  )}
                </div>
              </div>
              <div className="h-1.5 w-full rounded-full bg-brand-light-grey overflow-hidden">
                <motion.div className="h-full rounded-full"
                  style={{ backgroundColor: section.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${barW}%` }}
                  transition={{ duration: 0.6, delay: 0.1 + i * 0.04, ease: 'easeOut' }}
                />
              </div>
            </motion.div>
          );
        })}
      </div>

      {/*
        The fee lines. Kept visually apart from the trades because they are not site work
        and are not part of what the bars above are proportioned against — the trades sum
        to the construction subtotal, and these three are added to it.
      */}
      <div className="border-t border-brand-off-white px-5 py-4">
        <div className="flex items-baseline justify-between mb-2.5">
          <span className="text-xs font-semibold text-brand-near-black">{t('project.costing.sliceConstruction')}</span>
          <span className="text-xs font-bold tabular-nums text-brand-near-black">{formatUSDFull(detail.budget.construction)}</span>
        </div>
        {FEE_LINES.map(line => (
          <div key={line.key} className="flex items-baseline justify-between mb-1.5">
            <span className="text-xs text-brand-mid-grey">+ {t(line.labelKey)}</span>
            <span className="text-xs font-medium tabular-nums text-brand-near-black">
              {formatUSDFull(detail.budget[line.key])}
            </span>
          </div>
        ))}
        <div className="mt-2.5 flex items-baseline justify-between border-t border-brand-near-black pt-2.5">
          <span className="text-xs font-bold text-brand-near-black">{t('project.overview.explain.total')}</span>
          <span className="text-sm font-black tabular-nums text-brand-near-black">{formatUSDFull(detail.budget.total)}</span>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="px-5 pb-4">
        <p className="text-[10px] text-brand-mid-grey leading-relaxed bg-brand-off-white rounded-lg px-3 py-2.5">
          <strong className="text-brand-near-black">{t('wizard.indicative')}</strong>{' '}
          {t('wizard.indicativeBody')}
          {!isVerified && ` ${t('wizard.noLocalBq')}`}
        </p>
      </div>
    </div>
  );
}

// ── Summary row ────────────────────────────────────────────

function SummaryRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 text-brand-mid-grey shrink-0">{icon}</span>
      <span className="w-20 text-xs text-brand-mid-grey shrink-0">{label}</span>
      <span className="flex-1 text-sm font-medium text-brand-near-black leading-snug">{value}</span>
    </div>
  );
}

// ── Page component ─────────────────────────────────────────

export default function Step9Summary() {
  const labels = useDomainLabels();
  const t = useT();
  const { data } = useWizard();

  return (
    <WizardShell
      canContinue={true}
      continueLabel="Continue"
    >
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          {t('wizard.s9Title')}
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          {t('wizard.s9Sub')}
        </p>

        {/* Summary grid */}
        <div className="mt-7 rounded-xl border border-brand-border-grey divide-y divide-brand-border-grey overflow-hidden">
          <SummaryRow icon={<MapPin className="size-3.5" />}    label="Location"
            value={[data.city, labels.country(data.country)].filter(Boolean).join(', ')} />
          <SummaryRow icon={<Building2 className="size-3.5" />} label="Type"
            value={`${labels.projectType(data.projectType)} · ${labels.buildingType(data.buildingType)}`} />
          <SummaryRow icon={<Layers className="size-3.5" />}    label="Scale"
            value={[
              `${data.floors} floor${data.floors > 1 ? 's' : ''}`,
              `${data.sqm} sqm`,
              `${data.bedrooms} bed`,
              `${data.bathrooms} bath`,
              data.hasBoysQuarters ? 'Staff quarters' : null,
            ].filter(Boolean).join(' · ')}
          />
          <SummaryRow icon={<Home className="size-3.5" />}      label="Roof"
            value={labels.roofType(data.roofType)} />
          <SummaryRow icon={<Wrench className="size-3.5" />}    label="Finish"
            value={labels.finishLevel(data.finishLevel)} />
        </div>

        {/* Budget estimate with trade sections */}
        <div className="mt-6">
          <BudgetBreakdownCard />
        </div>

        {/* Predicted build timeline */}
        <div className="mt-5 rounded-xl border border-brand-border-grey overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-brand-off-white bg-brand-off-white/50">
            <CalendarDays className="size-4 text-brand-mid-grey shrink-0" />
            <p className="text-sm font-semibold text-brand-near-black">{t('wizard.timelineTitle')}</p>
          </div>

          {(() => {
            const startDate = data.targetStartDate ? new Date(data.targetStartDate) : new Date();
            const endDate = addDays(startDate, PREDICTED_DAYS);
            const months = Math.round(PREDICTED_DAYS / 30);
            const rows = [
              { label: 'Estimated start', value: fmtDate(startDate) },
              { label: 'Projected completion', value: fmtDate(endDate) },
              { label: 'Total duration', value: `~${PREDICTED_DAYS} days (${months} months)` },
            ];
            return (
              <div className="divide-y divide-brand-off-white">
                {rows.map(r => (
                  <div key={r.label} className="flex items-center justify-between px-5 py-3">
                    <span className="text-xs text-brand-mid-grey">{r.label}</span>
                    <span className="text-sm font-medium text-brand-near-black tabular-nums">{r.value}</span>
                  </div>
                ))}
              </div>
            );
          })()}

          <div className="px-5 py-3 bg-brand-off-white/50 border-t border-brand-off-white">
            <p className="text-[10px] text-brand-mid-grey leading-relaxed">
              {t('wizard.timelineSub')}
            </p>
          </div>
        </div>

      </div>
    </WizardShell>
  );
}
