import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { CheckCircle2, MapPin, Building2, Layers, Home, Wrench, Check } from 'lucide-react';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import { calculateBudget, formatUSDFull, formatUSD } from '@/lib/budget';
import { createProject } from '@/lib/supabase/projects';
import { useAuth } from '@/contexts/AuthContext';
import type { ProjectTier } from '@/types/project';
import { cn } from '@/lib/utils';

// ── Budget bar ────────────────────────────────────────────

function BudgetBar({ label, pct, amount }: { label: string; pct: number; amount: number }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-24 text-xs text-brand-mid-grey shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-brand-light-grey overflow-hidden">
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ originX: 0, width: `${pct}%` }}
          className="h-full bg-brand-near-black rounded-full"
        />
      </div>
      <span className="w-20 text-right text-xs font-medium text-brand-near-black tabular-nums shrink-0">
        {formatUSD(amount)}
      </span>
      <span className="w-6 text-right text-[10px] text-brand-mid-grey shrink-0">{pct}%</span>
    </div>
  );
}

// ── Tier card ────────────────────────────────────────────

interface TierCardProps {
  value: ProjectTier;
  title: string;
  price: string;
  description: string;
  features: string[];
  selected: boolean;
  onSelect: () => void;
  popular?: boolean;
}

function TierCard({ value, title, price, description, features, selected, onSelect, popular }: TierCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'relative w-full text-left rounded-xl border-2 p-4 transition-all duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2',
        selected
          ? 'border-brand-near-black bg-brand-off-white'
          : 'border-brand-border-grey hover:border-brand-dark-grey',
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

// ── Label helpers ─────────────────────────────────────────

const PT_LABELS: Record<string, string> = {
  residential: 'Residential',
  commercial:  'Commercial',
  industrial:  'Industrial',
  mixed_use:   'Mixed Use',
};

const BT_LABELS: Record<string, string> = {
  single_family:               'Single Family',
  multi_family:                'Multi-Family',
  townhouse:                   'Townhouse',
  semi_detached:               'Semi-Detached',
  office:                      'Office',
  retail:                      'Retail',
  warehouse_commercial:        'Warehouse',
  hotel:                       'Hotel',
  factory:                     'Factory',
  warehouse_industrial:        'Warehouse',
  industrial_complex:          'Industrial Complex',
  distribution_centre:         'Distribution Centre',
  mixed_residential_commercial:'Residential + Commercial',
  live_work:                   'Live / Work',
  mixed_retail_residential:    'Retail + Residential',
  transit_oriented:            'Transit-Oriented',
};

const ROOF_LABELS: Record<string, string> = {
  long_span_aluminum: 'Long Span Aluminum',
  clay_tiles:         'Clay Tiles',
  concrete_flat:      'Concrete / Flat Roof',
  shingle:            'Shingle',
};

const FINISH_LABELS: Record<string, string> = {
  standard: 'Standard Finish',
  premium:  'Premium Finish',
  luxury:   'Luxury Finish',
};

// ── Component ─────────────────────────────────────────────

export default function Step9Summary() {
  const { data, update, reset } = useWizard();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const budget = calculateBudget(data);

  async function handleSubmit() {
    if (!user) return;
    setError(null);
    setSubmitting(true);
    try {
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
      price:       '$0 / mo',
      description: 'You manage your own build with the full Groundwork toolkit.',
      features:    ['Full platform access', 'Budget & stage tracking', 'Document vault', 'Progress reporting'],
      selected:    data.tier === 'self_verify',
      onSelect:    () => update({ tier: 'self_verify' }),
    },
    {
      value:       'jalla_verify',
      title:       'Jalla Verify',
      price:       '$199 / mo',
      description: 'Independent verification by Jalla professionals on every stage.',
      features:    ['Everything in Self Verify', 'Site visit verification', 'Quality & compliance checks', 'Priority support'],
      selected:    data.tier === 'jalla_verify',
      onSelect:    () => update({ tier: 'jalla_verify' }),
      popular:     true,
    },
    {
      value:       'jalla_management',
      title:       'Jalla Management',
      price:       'Custom',
      description: 'Full-service project management on your behalf.',
      features:    ['Everything in Jalla Verify', 'Dedicated project manager', 'Procurement oversight', 'On-site representation'],
      selected:    data.tier === 'jalla_management',
      onSelect:    () => update({ tier: 'jalla_management' }),
    },
  ];

  return (
    <WizardShell
      canContinue={true}
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

        {/* ── Summary grid ── */}
        <div className="mt-7 rounded-xl border border-brand-border-grey divide-y divide-brand-border-grey overflow-hidden">
          <SummaryRow icon={<MapPin className="size-3.5" />}     label="Location"    value={`${data.city}, ${data.countryName}`} />
          <SummaryRow icon={<Building2 className="size-3.5" />}  label="Type"        value={`${PT_LABELS[data.projectType ?? '']} · ${BT_LABELS[data.buildingType ?? '']}`} />
          <SummaryRow icon={<Layers className="size-3.5" />}     label="Scale"
            value={[
              `${data.floors} floor${data.floors > 1 ? 's' : ''}`,
              `${data.sqm} sqm`,
              `${data.bedrooms} bed`,
              `${data.bathrooms} bath`,
              data.hasBoysQuarters ? `BQ ×${data.bqRooms}` : null,
            ].filter(Boolean).join(' · ')}
          />
          <SummaryRow icon={<Home className="size-3.5" />}       label="Roof"        value={ROOF_LABELS[data.roofType ?? '']} />
          <SummaryRow icon={<Wrench className="size-3.5" />}     label="Finish"      value={FINISH_LABELS[data.finishLevel]} />
        </div>

        {/* ── Budget estimate ── */}
        <div className="mt-6 rounded-xl border border-brand-border-grey p-4">
          <div className="flex items-baseline justify-between mb-1">
            <p className="text-sm font-semibold text-brand-near-black">Budget Estimate</p>
            <p className="text-xs text-brand-mid-grey">USD · indicative</p>
          </div>
          <div className="mb-4">
            <span className="text-3xl font-black text-brand-near-black tabular-nums">
              {formatUSDFull(budget.total)}
            </span>
          </div>
          <div>
            <BudgetBar label="Materials"   pct={45} amount={budget.materials}   />
            <BudgetBar label="Labor"       pct={25} amount={budget.labor}       />
            <BudgetBar label="Engineering" pct={18} amount={budget.engineering} />
            <BudgetBar label="Permits"     pct={2}  amount={budget.permits}     />
            <BudgetBar label="Contingency" pct={10} amount={budget.contingency} />
          </div>
          <p className="mt-3 text-[11px] text-brand-mid-grey leading-relaxed">
            This is an indicative range based on your inputs. Final costs depend on local market conditions, site specifics, and contractor negotiations.
          </p>
        </div>

        {/* ── Tier selection ── */}
        <div className="mt-7">
          <p className="text-sm font-semibold text-brand-near-black mb-4">Choose your plan</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
            {tiers.map(tier => (
              <TierCard key={tier.value} {...tier} />
            ))}
          </div>
        </div>

        {/* Error state */}
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

function SummaryRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 text-brand-mid-grey shrink-0">{icon}</span>
      <span className="w-20 text-xs text-brand-mid-grey shrink-0">{label}</span>
      <span className="flex-1 text-sm font-medium text-brand-near-black leading-snug">{value}</span>
    </div>
  );
}
