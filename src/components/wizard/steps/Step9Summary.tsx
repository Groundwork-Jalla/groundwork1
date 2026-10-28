import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  MapPin, Building2, Layers, Home, Wrench,
  ShieldCheck, Info, CalendarDays, TriangleAlert, ChevronDown,
} from 'lucide-react';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import {
  BUDGET_SLICES, calculateBudgetDetail, formatUSDFull, formatLocalCurrency,
  buildDurationDays, buildDurationMonths,
} from '@/lib/budget';
import { checkEstimate } from '@/lib/budget/sanity';
import { calculateBudget } from '@/lib/budget';
import { floorPlanSummary, floorPlanEvidence } from '@/lib/budget/floor-plan-summary';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useDomainLabels } from '@/lib/domain-labels';

// Was `const PREDICTED_DAYS = 196` — the fifth copy of that number, and the one a client
// sees before they commit. It now follows the floors they just chose.

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

function dateInputDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(start: string, end: string): number {
  const startUtc = Date.parse(`${start}T00:00:00Z`);
  const endUtc = Date.parse(`${end}T00:00:00Z`);
  return Math.max(0, Math.round((endUtc - startUtc) / 86_400_000));
}

// ── Label helpers ─────────────────────────────────────────

// ── Budget breakdown display ───────────────────────────────

function BudgetBreakdownCard() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { data, constructionRate, cityRate, rateLoading } = useWizard();
  const detail = calculateBudgetDetail(data, constructionRate, cityRate);
  const isVerified = detail.dataSource === 'real_bq';
  // Floor check, not a second estimate — see lib/budget/sanity.ts. Silent on the engine
  // since the per-floor deck fix; it earns its keep on the costing tab, where the total
  // can be one the owner typed.
  const sanity = checkEstimate(detail.budget.total, {
    sqm: data.sqm, floors: data.floors, rate: constructionRate, cityRate,
  });
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

      {/* Header — click to expand the breakdown */}
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="block w-full text-left px-5 py-4 border-b border-brand-off-white">
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
            <ChevronDown className={cn('ml-auto mt-1 size-4 text-brand-mid-grey transition-transform', open && 'rotate-180')} aria-hidden />
          </div>
        </div>
      </button>

      {open && (<>
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
      </>)}

      {/* Under-estimate warning. Above the disclaimer because it is the more urgent of
          the two, and only ever rendered when we can actually defend the comparison. */}
      {sanity.low && (
        <div className="px-5 pb-1">
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
            <TriangleAlert className="size-3.5 shrink-0 mt-0.5 text-amber-600" aria-hidden />
            <div>
              <p className="text-[11px] font-semibold text-amber-900 leading-snug">
                {t('wizard.lowEstimateTitle')}
              </p>
              <p className="mt-1 text-[10px] text-amber-800 leading-relaxed">
                {t('wizard.lowEstimateBody')}
              </p>
            </div>
          </div>
        </div>
      )}

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

function BudgetConfirmField({ confirmed, onConfirmed }: { confirmed: boolean; onConfirmed: (v: boolean) => void }) {
  const t = useT();
  const { data, constructionRate, cityRate, confirmationDraft, updateConfirmationDraft } = useWizard();
  // Fall back to the calculated budget whichever flow this is.
  //
  // The document flow used to fall back to 0 when the bill of quantities could not be
  // read. That is the one case where the person is most stuck: the field stays empty,
  // the checkbox below is disabled on `amount <= 0`, and "Confirm budget" can never
  // enable — while the summary panel beside it shows a perfectly good calculated figure.
  // Reported from a live activation call as "I can't get past this stage".
  const estimate = Math.round(
    data.bqTotalUsd ?? calculateBudget(data, constructionRate, cityRate).total);
  const raw = confirmationDraft?.raw ?? '';
  const previousEstimate = useRef<number | null>(null);
  const touchedByUser = useRef(false);

  // Keep the shown amount in sync with estimate changes unless the person has
  // deliberately overridden it with a custom figure.
  useEffect(() => {
    const numericRaw = Number(raw.replace(/[^0-9.]/g, '') || 0);
    const wasAutoFilled = previousEstimate.current != null && numericRaw === previousEstimate.current;
    if (estimate > 0 && !touchedByUser.current && (!raw || wasAutoFilled)) {
      updateConfirmationDraft?.({ raw: String(estimate) });
    }
    previousEstimate.current = estimate;
  }, [raw, estimate, updateConfirmationDraft]);

  const amount = Number(raw.replace(/[^0-9.]/g, '') || 0);
  return (
    <div className="mt-5 rounded-xl border border-brand-border-grey px-5 py-4 space-y-1.5">
      <label htmlFor="final-budget" className="text-sm font-semibold text-brand-near-black">
        {t('wizard.confirmBudget.glanceTitle')}
      </label>
      <p className="text-xs text-brand-mid-grey">{t('wizard.confirmBudget.glanceSub')}</p>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-brand-mid-grey">$</span>
        <input
          id="final-budget"
          inputMode="numeric"
          value={raw}
          onChange={e => {
            touchedByUser.current = true;
            updateConfirmationDraft?.({ raw: e.target.value.replace(/[^0-9.]/g, '') });
          }}
          placeholder="0"
          className="w-full rounded-xl border border-brand-border-grey bg-white pl-9 pr-4 py-3 text-lg font-bold tabular-nums text-brand-near-black focus:outline-none focus:border-brand-near-black"
        />
      </div>
      {estimate > 0 && amount !== estimate && (
        <button type="button" className="text-xs underline text-brand-mid-grey"
          onClick={() => {
            touchedByUser.current = false;
            updateConfirmationDraft?.({ raw: String(estimate) });
          }}>
          {t('wizard.confirmBudget.estimateLabel')}: ${estimate.toLocaleString('en-US')}
        </button>
      )}
      <label className="flex items-start gap-2.5 pt-2">
        <input type="checkbox" checked={confirmed} disabled={amount <= 0}
          onChange={e => onConfirmed(e.target.checked)} className="mt-0.5" />
        <span className="text-sm text-brand-near-black">{t('wizard.confirmBudget.glanceCheck')}</span>
      </label>
    </div>
  );
}

// ── Page component ─────────────────────────────────────────

export default function Step9Summary() {
  const labels = useDomainLabels();
  const t = useT();
  const { data, update, documentExtraction } = useWizard();
  const documentFlow = data.hasArchitecturePlan === true;
  const hasExtractedFloors = documentExtraction?.floorPlans.some(plan => plan.facts.floors != null) ?? false;
  const hasExtractedFootprint = documentExtraction?.floorPlans
    .some(plan => plan.facts.footprintSqm != null) ?? false;
  const [manualFloors, setManualFloors] = useState(data.floors > 1 ? String(data.floors) : '');
  const [manualFootprint, setManualFootprint] = useState(data.sqm > 0 ? String(data.sqm) : '');
  const [budgetConfirmed, setBudgetConfirmed] = useState(false);
  const hasValidFloors = hasExtractedFloors || Number(manualFloors) > 0;
  const hasValidFootprint = hasExtractedFootprint || Number(manualFootprint) > 0;
  const validDateRange = !data.targetStartDate || !data.targetEndDate
    || data.targetEndDate >= data.targetStartDate;

  return (
    <WizardShell
      canContinue={validDateRange && budgetConfirmed
        && (!documentFlow || (!!data.projectName.trim() && hasValidFloors && hasValidFootprint))}
      continueLabel={t('wizard.confirmBudget.glanceCta')}
    >
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          {t('wizard.s9Title')}
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          {t('wizard.s9Sub')}
        </p>

        {documentFlow && (
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-3">
              <span className="mb-1 block text-xs font-medium text-brand-near-black">
                {t('planGate.projectNameRequired')}
              </span>
              <input
                value={data.projectName}
                onChange={event => update({ projectName: event.target.value })}
                className="w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black"
                required
              />
            </label>
            {!hasExtractedFloors && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-brand-near-black">
                  {t('planGate.floorsRequired')}
                </span>
                <input
                  type="number" min="1" step="1" value={manualFloors}
                  onChange={event => {
                    setManualFloors(event.target.value);
                    update({ floors: Number(event.target.value) || 1 });
                  }}
                  className="w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black"
                  required
                />
              </label>
            )}
            {!hasExtractedFootprint && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-brand-near-black">
                  {t('planGate.footprintRequired')}
                </span>
                <input
                  type="number" min="1" step="0.1" value={manualFootprint}
                  onChange={event => {
                    setManualFootprint(event.target.value);
                    update({ sqm: Number(event.target.value) || 0 });
                  }}
                  className="w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black"
                  required
                />
              </label>
            )}
            {(!hasValidFloors || !hasValidFootprint || !data.projectName.trim()) && (
              <p className="text-xs text-brand-mid-grey sm:col-span-3">{t('planGate.missingProjectDetails')}</p>
            )}
          </div>
        )}

        {/* Summary grid */}
        <div className="mt-7 rounded-xl border border-brand-border-grey divide-y divide-brand-border-grey overflow-hidden">
          <SummaryRow icon={<MapPin className="size-3.5" />}    label="Location"
            value={[data.city, labels.country(data.country)].filter(Boolean).join(', ')} />
          <SummaryRow icon={<Building2 className="size-3.5" />} label="Type"
            value={`${labels.projectType(data.projectType)} · ${labels.buildingType(data.buildingType)}`} />
          {documentFlow ? (
            <SummaryRow icon={<Layers className="size-3.5" />} label={t('wizard.stepFloors')}
              value={hasExtractedFloors
                ? `${data.floors} ${data.floors === 1 ? 'floor' : 'floors'}`
                : t('planGate.floorCountMissing')} />
          ) : (
            <>
              <SummaryRow icon={<Layers className="size-3.5" />}    label="Scale"
                value={[
                  `${data.floors} floor${data.floors > 1 ? 's' : ''}`,
                  `${data.sqm} sqm`,
                  `${data.bedrooms} bed`,
                  `${data.bathrooms} bath`,
                  data.livingRooms > 0 ? `${data.livingRooms} ${t('wizardFields.livingAreas')}` : null,
                  data.kitchens > 0 ? `${data.kitchens} ${t('wizardFields.kitchens')}` : null,
                  data.offices > 0 ? `${data.offices} ${t('wizardFields.offices')}` : null,
                ].filter(Boolean).join(' · ')}
              />
              <SummaryRow icon={<Home className="size-3.5" />}      label="Roof"
                value={labels.roofType(data.roofType)} />
              <SummaryRow icon={<Wrench className="size-3.5" />}    label="Finish"
                value={labels.finishLevel(data.finishLevel)} />
            </>
          )}
        </div>

        {documentFlow
          ? <DocumentBudgetBreakdown />
          : <div className="mt-6"><BudgetBreakdownCard /></div>}

        <BudgetConfirmField confirmed={budgetConfirmed} onConfirmed={setBudgetConfirmed} />

        <div className="mt-5 rounded-xl border border-brand-border-grey overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-brand-off-white bg-brand-off-white/50">
            <CalendarDays className="size-4 text-brand-mid-grey shrink-0" />
            <p className="text-sm font-semibold text-brand-near-black">{t('wizard.timelineTitle')}</p>
          </div>

          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-brand-near-black">
                {t('wizard.targetStartDate')}
              </span>
              <input
                type="date"
                value={data.targetStartDate}
                max={data.targetEndDate || undefined}
                onChange={event => update({ targetStartDate: event.target.value })}
                className="w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-brand-near-black">
                {t('wizard.targetEndDate')}
              </span>
              <input
                type="date"
                value={data.targetEndDate}
                min={data.targetStartDate || undefined}
                onChange={event => update({ targetEndDate: event.target.value })}
                className="w-full rounded-lg border border-brand-border-grey bg-white px-3 py-2 text-sm text-brand-near-black"
              />
            </label>
          </div>
          {!validDateRange && (
            <p role="alert" className="px-4 pb-3 text-xs text-state-alert">
              {t('wizard.timelineDateRangeError')}
            </p>
          )}

          {(() => {
            const startDate = dateInputDate(data.targetStartDate) ?? new Date();
            const predictedDays = buildDurationDays(data.floors);
            const selectedEnd = dateInputDate(data.targetEndDate);
            const endDate = selectedEnd ?? addDays(startDate, predictedDays);
            const durationDays = data.targetStartDate && data.targetEndDate
              ? daysBetween(data.targetStartDate, data.targetEndDate)
              : predictedDays;
            const months = data.targetStartDate && data.targetEndDate
              ? Math.max(1, Math.ceil(durationDays / 30))
              : buildDurationMonths(data.floors);
            const rows = [
              { label: data.targetStartDate ? t('wizard.targetStartDate') : 'Estimated start', value: fmtDate(startDate) },
              { label: data.targetEndDate ? t('wizard.targetEndDate') : 'Projected completion', value: fmtDate(endDate) },
              { label: 'Total duration', value: `${data.targetStartDate && data.targetEndDate ? '' : '~'}${durationDays} days (${months} months)` },
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

function DocumentBudgetBreakdown() {
  const t = useT();
  const { documentExtraction } = useWizard();
  const reading = documentExtraction?.bqReading ?? null;
  const currency = reading?.currencyCode;
  const floorPlans = documentExtraction?.floorPlans ?? [];
  const amount = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="mt-6 space-y-4">
      <section className="overflow-hidden rounded-xl border border-brand-border-grey">
        <div className="border-b border-brand-off-white px-5 py-4">
          <p className="text-sm font-semibold text-brand-near-black">{t('planGate.bq')}</p>
          {reading ? (
            <>
              <p className="mt-1 text-2xl font-black tabular-nums text-brand-near-black">
                {amount(reading.total)} {currency ?? ''}
              </p>
              <p className="mt-1 text-xs text-brand-mid-grey">
                {currency ? reading.label : t('planGate.documentCurrencyUnknown')}
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-brand-mid-grey">{t('planGate.noDocumentTotal')}</p>
          )}
        </div>
        {documentExtraction?.bqLineItems.length ? (
          <div className="px-5 py-4">
            <p className="mb-3 text-xs font-semibold text-brand-near-black">{t('planGate.lineItemsTitle')}</p>
            <div className="space-y-2">
              {documentExtraction.bqLineItems.map((item, index) => (
                <div key={`${item.label}-${index}`} className="flex items-start justify-between gap-4 text-xs">
                  <span className="text-brand-mid-grey">{item.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-brand-near-black">
                    {amount(item.amount)}{currency ? ` ${currency}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="px-5 py-4 text-xs text-brand-mid-grey">{t('planGate.noLineItems')}</p>
        )}
      </section>

      <section className="rounded-xl border border-brand-border-grey px-5 py-4">
        <p className="text-xs font-semibold text-brand-near-black">{t('planGate.floorPlanFactsTitle')}</p>
        <div className="mt-3 space-y-2">
          {floorPlans.map(plan => (
            <div key={plan.fileName} className="text-xs text-brand-mid-grey">
              <p className="font-medium text-brand-near-black">{plan.fileName}</p>
              <p>{floorPlanSummary(plan.facts, t, amount)}</p>
              {floorPlanEvidence(plan.facts) && (
                <p className="mt-1 truncate font-mono text-[10px]"
                   title={floorPlanEvidence(plan.facts) ?? undefined}>
                  {floorPlanEvidence(plan.facts)}
                </p>
              )}
            </div>
          ))}
          {!floorPlans.length && <p>{t('planGate.areaMissing')}</p>}
        </div>
      </section>
    </div>
  );
}
