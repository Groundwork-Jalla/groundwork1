import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, MapPin, Building2, Layers, Home, Wrench, CalendarDays,
  BadgeCheck, ShieldCheck, Briefcase, ChevronDown, Check,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchProject, fetchProjectStages, fetchProjectSubstages } from '@/lib/supabase/projects';
import { calculateBudget, formatUSDFull, formatUSD } from '@/lib/budget';
import { findCountry } from '@/lib/countries';
import { cn } from '@/lib/utils';
import type {
  ProjectRow, ProjectStageRow, ProjectSubstageRow,
  FinishLevel, ProjectTier, StageStatus, SubstageStatus,
} from '@/types/project';

// ── Label maps ────────────────────────────────────────────

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

const FINISH_LABELS: Record<FinishLevel, string> = {
  standard: 'Standard',
  premium:  'Premium',
  luxury:   'Luxury',
};

const TIER_META: Record<ProjectTier, { label: string; icon: React.ReactNode }> = {
  self_verify:      { label: 'Self Verify',      icon: <BadgeCheck className="size-3.5" />  },
  jalla_verify:     { label: 'Jalla Verify',     icon: <ShieldCheck className="size-3.5" /> },
  jalla_management: { label: 'Jalla Management', icon: <Briefcase className="size-3.5" />   },
};

// ── Budget bar ────────────────────────────────────────────

function BudgetBar({ label, pct, amount }: { label: string; pct: number; amount: number }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-24 text-xs text-brand-mid-grey shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-brand-light-grey overflow-hidden">
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
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

// ── Detail row ────────────────────────────────────────────

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 text-brand-mid-grey shrink-0">{icon}</span>
      <span className="w-24 text-xs text-brand-mid-grey shrink-0">{label}</span>
      <span className="flex-1 text-sm font-medium text-brand-near-black leading-snug">{value}</span>
    </div>
  );
}

// ── Stage status dot ──────────────────────────────────────

function StageDot({ status }: { status: StageStatus }) {
  if (status === 'complete') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-near-black">
        <Check className="size-3 text-white" strokeWidth={3} />
      </span>
    );
  }
  if (status === 'active' || status === 'pending_review') {
    return (
      <span className="relative flex size-6 shrink-0 items-center justify-center">
        <span className="absolute inline-flex size-6 rounded-full bg-brand-near-black opacity-20 animate-ping" />
        <span className="relative inline-flex size-4 rounded-full bg-brand-near-black" />
      </span>
    );
  }
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-brand-border-grey bg-white" />
  );
}

// ── Substage status dot ───────────────────────────────────

function SubstatusIcon({ status }: { status: SubstageStatus }) {
  if (status === 'complete') {
    return <span className="size-3 rounded-full bg-brand-near-black flex items-center justify-center shrink-0">
      <Check className="size-2 text-white" strokeWidth={3.5} />
    </span>;
  }
  if (status === 'in_progress') {
    return <span className="size-3 rounded-full bg-brand-near-black opacity-60 shrink-0" />;
  }
  if (status === 'pending') {
    return <span className="size-3 rounded-full border-2 border-brand-near-black shrink-0" />;
  }
  return <span className="size-3 rounded-full border border-brand-border-grey shrink-0" />;
}

// ── Stage row ─────────────────────────────────────────────

function StageRow({
  stage,
  substages,
  isLast,
  open,
  onToggle,
}: {
  stage: ProjectStageRow;
  substages: ProjectSubstageRow[];
  isLast: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const isInteractive = stage.status !== 'locked';

  return (
    <div className="relative flex gap-4">
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-3 top-6 bottom-0 w-px bg-brand-border-grey" />
      )}

      {/* Dot */}
      <div className="relative z-10 mt-1 shrink-0">
        <StageDot status={stage.status} />
      </div>

      {/* Content */}
      <div className="flex-1 pb-5">
        <button
          type="button"
          disabled={!isInteractive}
          onClick={onToggle}
          className={cn(
            'w-full text-left flex items-start justify-between gap-3 group',
            isInteractive ? 'cursor-pointer' : 'cursor-default',
          )}
        >
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn(
                'text-[11px] font-medium',
                stage.status === 'locked' ? 'text-brand-mid-grey' : 'text-brand-near-black',
              )}>
                Stage {stage.stage_number}
              </span>
              {stage.status === 'active' && (
                <span className="inline-flex items-center rounded-full bg-brand-near-black px-1.5 py-px text-[9px] font-semibold text-white uppercase tracking-wide">
                  Active
                </span>
              )}
              {stage.status === 'pending_review' && (
                <span className="inline-flex items-center rounded-full border border-brand-border-grey px-1.5 py-px text-[9px] font-medium text-brand-mid-grey uppercase tracking-wide">
                  In Review
                </span>
              )}
              {stage.status === 'complete' && (
                <span className="inline-flex items-center rounded-full bg-brand-off-white border border-brand-border-grey px-1.5 py-px text-[9px] font-medium text-brand-mid-grey uppercase tracking-wide">
                  Complete
                </span>
              )}
            </div>
            <p className={cn(
              'text-sm font-semibold mt-0.5 leading-snug',
              stage.status === 'locked' ? 'text-brand-mid-grey' : 'text-brand-near-black',
            )}>
              {stage.name}
            </p>
          </div>

          <div className="flex items-center gap-2 mt-0.5 shrink-0">
            <span className="text-xs text-brand-mid-grey tabular-nums">
              {formatUSD(stage.payment_milestone_usd ?? 0)}
              <span className="ml-1 text-[10px]">({stage.budget_pct}%)</span>
            </span>
            {isInteractive && (
              <ChevronDown
                className={cn(
                  'size-4 text-brand-mid-grey transition-transform duration-200',
                  open ? 'rotate-180' : '',
                )}
              />
            )}
          </div>
        </button>

        {/* Substages */}
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <ul className="mt-3 space-y-2 pr-1">
                {substages.map(sub => (
                  <li key={sub.id} className="flex items-start gap-2.5">
                    <SubstatusIcon status={sub.status} />
                    <span className={cn(
                      'text-xs leading-snug',
                      sub.status === 'complete'
                        ? 'line-through text-brand-mid-grey'
                        : sub.status === 'locked'
                          ? 'text-brand-mid-grey'
                          : 'text-brand-near-black',
                    )}>
                      {sub.name}
                    </span>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────

export default function ProjectDetail() {
  const { id }     = useParams<{ id: string }>();
  const navigate   = useNavigate();
  const { user }   = useAuth();

  const [project,    setProject]    = useState<ProjectRow | null>(null);
  const [stages,     setStages]     = useState<ProjectStageRow[]>([]);
  const [substages,  setSubstages]  = useState<ProjectSubstageRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [openStage,  setOpenStage]  = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;

    Promise.all([
      fetchProject(id),
      fetchProjectStages(id),
      fetchProjectSubstages(id),
    ])
      .then(([p, s, sub]) => {
        if (!p) { setError('Project not found.'); return; }
        setProject(p);
        setStages(s);
        setSubstages(sub);
        // Auto-open the active stage
        const active = s.find(st => st.status === 'active');
        if (active) setOpenStage(active.stage_number);
      })
      .catch(() => setError('Failed to load project.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-brand-border-grey border-t-brand-near-black animate-spin" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
        <p className="text-sm text-brand-mid-grey">{error ?? 'Project not found.'}</p>
        <Link to="/dashboard" className="text-sm font-medium text-brand-near-black underline underline-offset-4">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const budget  = calculateBudget({
    country:         project.country,
    floors:          project.num_floors,
    buildingType:    project.building_type,
    roofType:        project.roof_type,
    hasBoysQuarters: project.has_boys_quarters,
    bqRooms:         project.bq_rooms,
    sqm:             Number(project.sqm),
    finishLevel:     project.finish_level,
  });

  const country = findCountry(project.country);
  const tier    = TIER_META[project.tier];

  const scaleStr = [
    `${project.num_floors} floor${project.num_floors > 1 ? 's' : ''}`,
    `${project.sqm} sqm`,
    project.bedrooms  > 0 ? `${project.bedrooms} bed`  : null,
    project.bathrooms > 0 ? `${project.bathrooms} bath` : null,
    project.has_boys_quarters ? `BQ ×${project.bq_rooms}` : null,
  ].filter(Boolean).join(' · ');

  const startDate = project.target_start
    ? new Date(project.target_start).toLocaleDateString('en-GB', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : null;

  const completedCount = stages.filter(s => s.status === 'complete').length;

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-brand-border-grey px-6 sm:px-8 py-4 flex items-center gap-4">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-1.5 text-sm text-brand-mid-grey hover:text-brand-near-black transition-colors"
        >
          <ArrowLeft className="size-4" />
          Dashboard
        </button>
        <span className="text-brand-border-grey">/</span>
        <span className="text-sm font-medium text-brand-near-black truncate">{project.name}</span>
      </nav>

      {/* Main */}
      <div className="max-w-[680px] mx-auto px-6 py-10">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>

          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-8">
            <div>
              <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
                {project.name}
              </h1>
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-brand-mid-grey">
                <MapPin className="size-3.5" />
                {project.city && <span>{project.city},</span>}
                <span>{country?.name ?? project.country}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-brand-near-black shrink-0 mt-1">
              {tier.icon}
              {tier.label}
            </div>
          </div>

          {/* Project spec card */}
          <div className="rounded-xl border border-brand-border-grey divide-y divide-brand-border-grey overflow-hidden mb-6">
            <DetailRow
              icon={<Building2 className="size-3.5" />}
              label="Type"
              value={`${PT_LABELS[project.project_type]} · ${BT_LABELS[project.building_type]}`}
            />
            <DetailRow icon={<Layers className="size-3.5" />}  label="Scale"  value={scaleStr} />
            <DetailRow icon={<Home className="size-3.5" />}    label="Roof"   value={ROOF_LABELS[project.roof_type]} />
            <DetailRow icon={<Wrench className="size-3.5" />}  label="Finish" value={FINISH_LABELS[project.finish_level]} />
            {startDate && (
              <DetailRow icon={<CalendarDays className="size-3.5" />} label="Target start" value={startDate} />
            )}
          </div>

          {/* Budget card */}
          <div className="rounded-xl border border-brand-border-grey p-5 mb-8">
            <div className="flex items-baseline justify-between mb-1">
              <p className="text-sm font-semibold text-brand-near-black">Budget Estimate</p>
              <p className="text-xs text-brand-mid-grey">USD · indicative</p>
            </div>
            <div className="mb-4">
              <span className="text-3xl font-black text-brand-near-black tabular-nums">
                {formatUSDFull(budget.total)}
              </span>
            </div>
            <BudgetBar label="Materials"   pct={45} amount={budget.materials}   />
            <BudgetBar label="Labor"       pct={25} amount={budget.labor}       />
            <BudgetBar label="Engineering" pct={18} amount={budget.engineering} />
            <BudgetBar label="Permits"     pct={2}  amount={budget.permits}     />
            <BudgetBar label="Contingency" pct={10} amount={budget.contingency} />
            <p className="mt-3 text-[11px] text-brand-mid-grey leading-relaxed">
              Indicative range. Final costs depend on local market conditions, site specifics, and contractor negotiations.
            </p>
          </div>

          {/* Construction pipeline */}
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-brand-near-black">Construction Pipeline</p>
            {stages.length > 0 && (
              <span className="text-xs text-brand-mid-grey tabular-nums">
                {completedCount} / {stages.length} stages complete
              </span>
            )}
          </div>

          {stages.length === 0 ? (
            <div className="rounded-xl border border-brand-border-grey p-6 text-center">
              <p className="text-xs text-brand-mid-grey">No stages found for this project.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-brand-border-grey px-5 py-6">
              {stages.map((stage, i) => (
                <StageRow
                  key={stage.id}
                  stage={stage}
                  substages={substages.filter(sub => sub.stage_id === stage.id)}
                  isLast={i === stages.length - 1}
                  open={openStage === stage.stage_number}
                  onToggle={() =>
                    setOpenStage(prev =>
                      prev === stage.stage_number ? null : stage.stage_number,
                    )
                  }
                />
              ))}
            </div>
          )}

        </motion.div>
      </div>
    </div>
  );
}
