import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import {
  CheckCircle2, MapPin, Building2, Layers, Home, Wrench, Check,
  ShieldCheck, BadgeCheck, Info,
} from 'lucide-react';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import { calculateBudget, calculateBudgetDetail, formatUSDFull, formatLocalCurrency } from '@/lib/budget';
import { createProject } from '@/lib/supabase/projects';
import { useAuth } from '@/contexts/AuthContext';
import type { ProjectTier } from '@/types/project';
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

// ── Tier card ─────────────────────────────────────────────

interface TierCardProps {
  value: ProjectTier; title: string; price: string;
  description: string; features: string[]; selected: boolean;
  onSelect: () => void; popular?: boolean;
}

function TierCard({ title, price, description, features, selected, onSelect, popular }: TierCardProps) {
  return (
    <button type="button" onClick={onSelect}
      className={cn(
        'relative w-full text-left rounded-xl border-2 p-4 transition-all duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2',
        selected ? 'border-brand-near-black bg-brand-off-white' : 'border-brand-border-grey hover:border-brand-dark-grey',
      )}
    >
      {popular && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-brand-near-black text-white text-[10px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap">
          Most popular
        </span>
      )}
      {selected && (
        <span className="absolute top-3 right-3 flex size-4 items-center justify-center rounded-full bg-brand-near-black">
          <Check className="size-2.5 text-white" strokeWidth={3} />
        </span>
      )}
      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-sm font-bold text-brand-near-black">{title}</span>
      </div>
      <div className="text-xs font-semibold text-brand-near-black mb-1">{price}</div>
      <p className="text-xs text-brand-mid-grey mb-3 leading-relaxed">{description}</p>
      <ul className="space-y-1">
        {features.map(f => (
          <li key={f} className="flex items-start gap-1.5 text-xs text-brand-mid-grey">
            <Check className="size-3 text-brand-near-black mt-0.5 shrink-0" strokeWidth={2.5} />
            {f}
          </li>
        ))}
      </ul>
    </button>
  );
}

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
  const { data, update, reset, constructionRate } = useWizard();
  const { user } = useAuth();
  const navigate  = useNavigate();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  async function handleSubmit() {
    if (!user) return;
    setError(null);
    setSubmitting(true);
    try {
      const budget  = calculateBudget(data, constructionRate);
      const project = await createProject(user.id, data, budget);
      reset();
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  const tiers: TierCardProps[] = [
    {
      value:       'self_verify',
      title:       'Self Verify',
      price:       'Free',
      description: 'Self-manage your build with the full Groundwork toolkit. Up to 3 projects.',
      features:    ['Up to 3 projects', 'Budget & stage tracking', 'Document vault', 'Self-verify stages'],
      selected:    data.tier === 'self_verify',
      onSelect:    () => update({ tier: 'self_verify' }),
    },
    {
      value:       'jalla_verify',
      title:       'Jalla Verify',
      price:       '$199 / mo',
      description: 'Unlimited projects, full contractor access, and Jalla-verified stages.',
      features:    ['Unlimited projects', 'Full contractor directory', 'Jalla-verified stages', 'Priority support'],
      selected:    data.tier === 'jalla_verify',
      onSelect:    () => update({ tier: 'jalla_verify' }),
      popular:     true,
    },
    {
      value:       'jalla_management',
      title:       'Jalla Management',
      price:       'Custom',
      description: 'Jalla manages everything on your behalf. Full-service, dedicated project manager.',
      features:    ['Everything in Jalla Verify', 'Dedicated project manager', 'Procurement oversight', 'On-site representation'],
      selected:    data.tier === 'jalla_management',
      onSelect:    () => update({ tier: 'jalla_management' }),
    },
  ];

  return (
    <WizardShell
      canContinue={!!data.tier}
      onContinue={handleSubmit}
      continueLabel="Create Project"
      isSubmitting={submitting}
    >
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          Your project at a glance
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          Review your choices, pick a plan, and create your project.
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

        {/* Tier selection */}
        <div className="mt-7">
          <div className="flex items-center gap-2 mb-4">
            <BadgeCheck className="size-4 text-brand-mid-grey" />
            <p className="text-sm font-semibold text-brand-near-black">Choose your plan</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
            {tiers.map(tier => <TierCard key={tier.value} {...tier} />)}
          </div>
        </div>

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-lg bg-brand-off-white border border-brand-border-grey px-4 py-3 text-sm text-brand-near-black"
          >
            {error}
          </motion.p>
        )}
      </div>
    </WizardShell>
  );
}
