import { motion } from 'framer-motion';
import {
  MapPin, Building2, Layers, Home, Wrench,
  ShieldCheck, Info,
} from 'lucide-react';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import { calculateBudgetDetail, formatUSDFull, formatLocalCurrency } from '@/lib/budget';
import { cn } from '@/lib/utils';

// ── Label helpers ─────────────────────────────────────────

const PT_LABELS: Record<string, string> = {
  residential: 'Residential', commercial: 'Commercial',
  industrial: 'Industrial', mixed_use: 'Mixed Use',
};

const BT_LABELS: Record<string, string> = {
  single_family: 'Single Family', multi_family: 'Multi-Family',
  townhouse: 'Townhouse', semi_detached: 'Semi-Detached',
  office: 'Office', retail: 'Retail', warehouse_commercial: 'Warehouse',
  hotel: 'Hotel', factory: 'Factory', warehouse_industrial: 'Warehouse',
  industrial_complex: 'Industrial Complex', distribution_centre: 'Distribution Centre',
  mixed_residential_commercial: 'Residential + Commercial', live_work: 'Live / Work',
  mixed_retail_residential: 'Retail + Residential', transit_oriented: 'Transit-Oriented',
  bungalow: 'Bungalow', duplex: 'Duplex', villa: 'Villa', apartment: 'Apartment',
  guest_house: 'Guest House',
};

const ROOF_LABELS: Record<string, string> = {
  long_span_aluminum: 'Long Span Aluminum', clay_tiles: 'Clay Tiles',
  concrete_flat: 'Concrete / Flat Roof', shingle: 'Shingle',
};

const FINISH_LABELS: Record<string, string> = {
  standard: 'Standard Finish', premium: 'Premium Finish', luxury: 'Luxury Finish',
};

// ── Budget breakdown display ───────────────────────────────

function BudgetBreakdownCard() {
  const { data, constructionRate, rateLoading } = useWizard();
  const detail = calculateBudgetDetail(data, constructionRate);
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
              <p className="text-sm font-semibold text-brand-near-black">Budget Estimate</p>
              <span className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide border',
                isVerified
                  ? 'bg-green-50 text-green-700 border-green-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200',
              )}>
                {isVerified ? <><ShieldCheck className="size-2.5" /> Verified data</> : <><Info className="size-2.5" /> Regional estimate</>}
              </span>
            </div>
            <p className="text-[10px] text-brand-mid-grey">
              {isVerified
                ? 'Based on real BQ data for this country'
                : 'Indexed from comparable markets — no verified BQ yet'}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-black tabular-nums text-brand-near-black">
              {formatUSDFull(detail.total)}
            </p>
            {detail.currencyCode !== 'USD' && (
              <p className="text-xs text-brand-mid-grey tabular-nums mt-0.5">
                ~{formatLocalCurrency(detail.totalLocal, detail.currencyCode)}
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

      {/* Disclaimer */}
      <div className="px-5 pb-4">
        <p className="text-[10px] text-brand-mid-grey leading-relaxed bg-brand-off-white rounded-lg px-3 py-2.5">
          <strong className="text-brand-near-black">Indicative estimate.</strong>{' '}
          Actual costs vary by city, contractor, and current material prices.
          Confirm final figures with a certified quantity surveyor.
          {!isVerified && ' Regional estimate — no verified BQ data for this country yet.'}
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
  const { data } = useWizard();

  return (
    <WizardShell
      canContinue={true}
      continueLabel="Continue"
    >
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          Your project at a glance
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          Review your project details and estimated budget before choosing a plan.
        </p>

        {/* Summary grid */}
        <div className="mt-7 rounded-xl border border-brand-border-grey divide-y divide-brand-border-grey overflow-hidden">
          <SummaryRow icon={<MapPin className="size-3.5" />}    label="Location"
            value={[data.city, data.countryName].filter(Boolean).join(', ')} />
          <SummaryRow icon={<Building2 className="size-3.5" />} label="Type"
            value={`${PT_LABELS[data.projectType ?? '']} · ${BT_LABELS[data.buildingType ?? '']}`} />
          <SummaryRow icon={<Layers className="size-3.5" />}    label="Scale"
            value={[
              `${data.floors} floor${data.floors > 1 ? 's' : ''}`,
              `${data.sqm} sqm`,
              `${data.bedrooms} bed`,
              `${data.bathrooms} bath`,
              data.hasBoysQuarters ? `BQ ×${data.bqRooms}` : null,
            ].filter(Boolean).join(' · ')}
          />
          <SummaryRow icon={<Home className="size-3.5" />}      label="Roof"
            value={ROOF_LABELS[data.roofType ?? '']} />
          <SummaryRow icon={<Wrench className="size-3.5" />}    label="Finish"
            value={FINISH_LABELS[data.finishLevel]} />
        </div>

        {/* Budget estimate with trade sections */}
        <div className="mt-6">
          <BudgetBreakdownCard />
        </div>

      </div>
    </WizardShell>
  );
}
