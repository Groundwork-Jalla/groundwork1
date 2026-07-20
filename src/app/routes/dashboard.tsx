import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import {
  Plus, BadgeCheck, ShieldCheck, Briefcase,
  MapPin, Building2, ChevronRight, FolderOpen,
  Wallet, HardHat, CheckCircle2, Shield,
  UserCircle, Check, ArrowRight, TrendingUp,
  Lock, CircleDot, Info,
} from 'lucide-react';
import { useAuth }                    from '@/contexts/AuthContext';
import { supabase }                   from '@/lib/supabase/client';
import { fetchProjects }              from '@/lib/supabase/projects';
import { fetchContractorProjects }    from '@/lib/supabase/invites';
import { formatUSDFull, formatLocalCurrency, calculateBudgetDetail } from '@/lib/budget';
import { getConstructionRate }        from '@/lib/supabase/construction-rates';
import { findCountry }                from '@/lib/countries';
import type { ProjectRow, ConstructionRate } from '@/types/project';

// ── Types ──────────────────────────────────────────────────

type StageStatus = 'locked' | 'active' | 'pending_review' | 'complete';

interface ProjectStage {
  id: string;
  stage_number: number;
  name: string;
  status: StageStatus;
  budget_pct: number | null;
}

// ── Stage status helpers ───────────────────────────────────

const isComplete = (s: ProjectStage) => s.status === 'complete';
const isActive   = (s: ProjectStage) => s.status === 'active' || s.status === 'pending_review';
const isLocked   = (s: ProjectStage) => s.status === 'locked';

function stageBadge(status: StageStatus) {
  switch (status) {
    case 'complete':       return { label: 'Done',              cls: 'bg-green-50 text-green-700 border-green-200'  };
    case 'pending_review': return { label: 'Awaiting approval', cls: 'bg-amber-50 text-amber-700 border-amber-200'  };
    case 'active':         return { label: 'In progress',       cls: 'bg-blue-50 text-blue-700 border-blue-200'     };
    default:               return { label: 'Upcoming',          cls: 'bg-brand-off-white text-brand-mid-grey border-brand-border-grey' };
  }
}

function stageBarColor(status: StageStatus): string {
  if (status === 'complete')       return '#22c55e';
  if (status === 'active' || status === 'pending_review') return '#3b82f6';
  return '#e2e8f0';
}

// ── Constants ──────────────────────────────────────────────

const STARTER_LIMIT = 3;
const TOTAL_STAGES  = 10;

const TIER_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  self_verify:      { label: 'Self Verify',      icon: <BadgeCheck className="size-3" />,  color: 'text-brand-mid-grey' },
  jalla_verify:     { label: 'Jalla Verify',     icon: <ShieldCheck className="size-3" />, color: 'text-blue-600'       },
  jalla_management: { label: 'Jalla Management', icon: <Briefcase className="size-3" />,   color: 'text-purple-600'     },
  starter:          { label: 'Self Verify',      icon: <BadgeCheck className="size-3" />,  color: 'text-brand-mid-grey' },
  pro:              { label: 'Jalla Verify',     icon: <ShieldCheck className="size-3" />, color: 'text-blue-600'       },
  enterprise:       { label: 'Jalla Management', icon: <Briefcase className="size-3" />,   color: 'text-purple-600'     },
};

const BT_LABELS: Record<string, string> = {
  single_family: 'Single Family', multi_family: 'Multi-Family',
  townhouse: 'Townhouse',         semi_detached: 'Semi-Detached',
  duplex: 'Duplex',               bungalow: 'Bungalow',
  office: 'Office',               retail: 'Retail',
  warehouse_commercial: 'Warehouse', hotel: 'Hotel',
  guest_house: 'Guest House',     villa: 'Villa',
  apartment: 'Apartment',         commercial: 'Commercial',
};

const PROJECT_STATUS_META = {
  active:    { label: 'Active',   dot: 'bg-green-500',         badge: 'bg-green-50 text-green-700 border border-green-200'                    },
  on_hold:   { label: 'On Hold',  dot: 'bg-amber-500',         badge: 'bg-amber-50 text-amber-700 border border-amber-200'                    },
  completed: { label: 'Complete', dot: 'bg-brand-mid-grey',    badge: 'bg-brand-off-white text-brand-mid-grey border border-brand-border-grey' },
  archived:  { label: 'Archived', dot: 'bg-brand-border-grey', badge: 'bg-brand-off-white text-brand-mid-grey border border-brand-border-grey' },
};

// ── Helpers ────────────────────────────────────────────────

function completedStages(p: ProjectRow): number {
  return p.status === 'completed' ? TOTAL_STAGES : Math.max(0, p.current_stage - 1);
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function fmtShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function pctToDollars(pct: number | null, total: number): number {
  return ((pct ?? 0) / 100) * total;
}

// ── Shared progress bar ────────────────────────────────────

function HorizBar({ pct, color = '#0a0a0a' }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-brand-light-grey overflow-hidden">
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(pct, 100)}%` }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      />
    </div>
  );
}

// ── Stat card ──────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, accent = false,
}: {
  label: string; value: string; sub?: string;
  icon: React.ComponentType<{ className?: string }>; accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-5 flex flex-col gap-3 ${
      accent ? 'bg-brand-near-black border-brand-near-black' : 'bg-white border-brand-border-grey'
    }`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${accent ? 'text-white/55' : 'text-brand-mid-grey'}`}>{label}</span>
        <span className={`flex size-8 items-center justify-center rounded-lg ${accent ? 'bg-white/10' : 'bg-brand-off-white'}`}>
          <Icon className={`size-4 ${accent ? 'text-white/70' : 'text-brand-mid-grey'}`} />
        </span>
      </div>
      <div>
        <p className={`text-2xl font-bold tabular-nums ${accent ? 'text-white' : 'text-brand-near-black'}`}>{value}</p>
        {sub && <p className={`text-xs mt-0.5 ${accent ? 'text-white/45' : 'text-brand-mid-grey'}`}>{sub}</p>}
      </div>
    </div>
  );
}

// ── Profile completion ─────────────────────────────────────

function ProfileCompletion({ nameSet, idUploaded, hasProject }: {
  nameSet: boolean; idUploaded: boolean; hasProject: boolean;
}) {
  const items = [
    { label: 'Account created',      done: true       },
    { label: 'Display name set',      done: nameSet    },
    { label: 'ID uploaded',           done: idUploaded },
    { label: 'First project created', done: hasProject },
  ];
  const count = items.filter(i => i.done).length;
  const pct   = Math.round((count / items.length) * 100);
  if (pct === 100) return null;

  return (
    <div className="bg-white rounded-2xl border border-brand-border-grey p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-full bg-brand-off-white">
            <UserCircle className="size-5 text-brand-mid-grey" />
          </div>
          <div>
            <p className="text-sm font-semibold text-brand-near-black">Complete Your Profile</p>
            <p className="text-xs text-brand-mid-grey mt-0.5">Unlock full access to Groundwork</p>
          </div>
        </div>
        <span className="text-sm font-bold text-brand-near-black tabular-nums">{pct}%</span>
      </div>
      <div className="mb-4"><HorizBar pct={pct} /></div>
      <div className="grid grid-cols-2 gap-2">
        {items.map(item => (
          <div key={item.label} className="flex items-center gap-2">
            <div className={`flex size-4 shrink-0 items-center justify-center rounded-full ${
              item.done ? 'bg-brand-near-black' : 'border-2 border-brand-border-grey'
            }`}>
              {item.done && <Check className="size-2.5 text-white stroke-3" />}
            </div>
            <span className={`text-xs ${item.done ? 'text-brand-mid-grey line-through' : 'text-brand-near-black font-medium'}`}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stage Progress + Payment Schedule (merged) ─────────────
// Each stage shows its name, status, and dollar allocation.

function StageProgressPanel({
  project, stages, stagesLoading,
}: {
  project: ProjectRow;
  stages: ProjectStage[];
  stagesLoading: boolean;
}) {
  const total      = project.budget_usd ?? 0;
  const totalPct   = stages.reduce((s, st) => s + (st.budget_pct ?? 0), 0) || 100;
  const done       = stages.filter(isComplete).length;
  const stageTotal = stages.length || TOTAL_STAGES;
  const pct        = Math.round((done / stageTotal) * 100);
  const currentStg = stages.find(isActive) ?? stages.find(isLocked);

  const spent     = stages.filter(isComplete).reduce((acc, s) => acc + pctToDollars(s.budget_pct, total), 0);
  const activeAmt = stages.filter(isActive).reduce(  (acc, s) => acc + pctToDollars(s.budget_pct, total), 0);
  const remaining = stages.filter(isLocked).reduce(  (acc, s) => acc + pctToDollars(s.budget_pct, total), 0);

  return (
    <div className="bg-white rounded-2xl border border-brand-border-grey overflow-hidden flex flex-col h-full">

      {/* Header */}
      <div className="px-5 py-4 border-b border-brand-off-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-brand-near-black">Stage Progress</h3>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                pct === 100 ? 'bg-green-50 text-green-700 border-green-200'
                  : pct > 0  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-brand-off-white text-brand-mid-grey border-brand-border-grey'
              }`}>
                <TrendingUp className="size-2.5" />
                {pct === 100 ? 'Complete' : pct > 0 ? 'On track' : 'Not started'}
              </span>
            </div>
            <p className="text-xs text-brand-mid-grey">
              {done} of {stageTotal} stages complete
              {done < stageTotal && currentStg && (
                <> — <strong className="text-brand-near-black">{currentStg.name}</strong> {isActive(currentStg) ? 'in progress' : 'up next'}</>
              )}
            </p>
          </div>
          <Link to={`/projects/${project.id}`}
            className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-brand-mid-grey hover:text-brand-near-black transition-colors">
            Open <ArrowRight className="size-3" />
          </Link>
        </div>

        {/* Overall bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-brand-mid-grey mb-1.5">
            <span className="font-semibold text-brand-near-black truncate max-w-40">{project.name}</span>
            <span>{pct}% complete</span>
          </div>
          <HorizBar pct={pct} color="#22c55e" />
        </div>
      </div>

      {/* Mini budget summary */}
      {total > 0 && stages.length > 0 && (
        <div className="grid grid-cols-3 divide-x divide-brand-off-white border-b border-brand-off-white">
          {[
            { label: 'Spent',     amount: spent,     color: 'text-green-700' },
            { label: 'Active',    amount: activeAmt, color: 'text-blue-700'  },
            { label: 'Remaining', amount: remaining, color: 'text-brand-mid-grey' },
          ].map(row => (
            <div key={row.label} className="flex flex-col items-center py-3 px-2 gap-0.5">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-brand-mid-grey">{row.label}</span>
              <span className={`text-sm font-black tabular-nums ${row.color}`}>{fmtShort(row.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Stage rows */}
      <div className="flex-1 overflow-y-auto divide-y divide-brand-off-white">
        {stagesLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3 animate-pulse">
              <div className="size-6 rounded-full bg-brand-light-grey shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-3/4 rounded bg-brand-light-grey" />
                <div className="h-1.5 w-full rounded-full bg-brand-light-grey" />
              </div>
              <div className="h-4 w-12 rounded bg-brand-light-grey" />
            </div>
          ))
        ) : stages.map((stage, i) => {
          const done_     = isComplete(stage);
          const active_   = isActive(stage);
          const amount    = pctToDollars(stage.budget_pct, total);
          const barW      = totalPct > 0 ? ((stage.budget_pct ?? 0) / totalPct) * 100 : 0;
          const { label: badgeLabel, cls: badgeCls } = stageBadge(stage.status);

          return (
            <motion.div
              key={stage.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.025 }}
              className={`flex items-start gap-3 px-4 py-3 ${active_ ? 'bg-blue-50/30' : ''}`}
            >
              {/* Status circle */}
              <div className={`flex size-6 shrink-0 items-center justify-center rounded-full mt-0.5 text-[10px] font-bold ${
                done_   ? 'bg-green-500 text-white'
                  : active_ ? 'bg-blue-500 text-white'
                  : stage.status === 'pending_review' ? 'bg-amber-400 text-white'
                  : 'bg-brand-off-white text-brand-mid-grey border border-brand-border-grey'
              }`}>
                {done_   ? <Check className="size-3.5 stroke-3" />
                  : active_ ? <CircleDot className="size-3" />
                  : isLocked(stage) ? <Lock className="size-3 text-brand-mid-grey" />
                  : <span>{stage.stage_number}</span>}
              </div>

              {/* Stage details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className={`text-xs font-semibold leading-snug ${
                    done_ ? 'line-through text-brand-mid-grey' : active_ ? 'text-brand-near-black' : 'text-brand-mid-grey'
                  }`}>
                    {stage.name}
                  </span>
                  {/* Dollar amount */}
                  {total > 0 && (
                    <span className={`text-xs font-black tabular-nums shrink-0 ${
                      done_ ? 'text-green-700' : active_ ? 'text-blue-700' : 'text-brand-mid-grey'
                    }`}>
                      {fmtShort(amount)}
                    </span>
                  )}
                </div>
                {/* Budget bar + pct + badge */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 rounded-full bg-brand-light-grey overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: stageBarColor(stage.status) }}
                      initial={{ width: 0 }}
                      animate={{ width: `${barW}%` }}
                      transition={{ duration: 0.6, delay: 0.1 + i * 0.03, ease: 'easeOut' }}
                    />
                  </div>
                  <span className="text-[9px] tabular-nums text-brand-mid-grey shrink-0 w-6 text-right">
                    {stage.budget_pct ?? 0}%
                  </span>
                  <span className={`text-[9px] font-semibold rounded-full px-1.5 py-0.5 shrink-0 border ${badgeCls}`}>
                    {badgeLabel}
                  </span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ── Budget allocation donut ────────────────────────────────

function CostingDonut({ project, stages }: {
  project: ProjectRow;
  stages: ProjectStage[];
}) {
  const total    = project.budget_usd ?? 0;
  const spent    = stages.filter(isComplete).reduce((acc, s) => acc + pctToDollars(s.budget_pct, total), 0);
  const activeAmt= stages.filter(isActive).reduce(  (acc, s) => acc + pctToDollars(s.budget_pct, total), 0);
  const remaining= stages.filter(isLocked).reduce(  (acc, s) => acc + pctToDollars(s.budget_pct, total), 0);
  const base     = spent + activeAmt + remaining || total || 1;

  const SEGS = [
    { pct: spent     / base, color: '#22c55e' },
    { pct: activeAmt / base, color: '#3b82f6' },
    { pct: remaining / base, color: '#e2e8f0' },
  ].filter(s => s.pct > 0);

  const segs = SEGS.length ? SEGS : [{ pct: 1, color: '#e2e8f0' }];
  const r = 68, cx = 100, cy = 100, circ = 2 * Math.PI * r, GAP = 4;
  let acc = 0;

  const spentPct     = total > 0 ? Math.round((spent     / total) * 100) : 0;
  const activePct    = total > 0 ? Math.round((activeAmt / total) * 100) : 0;
  const remainingPct = total > 0 ? Math.round((remaining / total) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl border border-brand-border-grey p-5">
      <h3 className="text-sm font-semibold text-brand-near-black mb-0.5">Budget Allocation</h3>
      <p className="text-xs text-brand-mid-grey mb-4">
        {spentPct > 0 ? `${spentPct}% committed to completed stages`
          : stages.length === 0 ? 'Loading stage data…' : 'No stages completed yet'}
      </p>

      <div className="flex justify-center mb-4">
        <svg viewBox="0 0 200 200" className="w-36 h-36">
          <g transform={`rotate(-90, ${cx}, ${cy})`}>
            {segs.map((seg, i) => {
              const vis = seg.pct * circ - (segs.length > 1 ? GAP : 0);
              const off = -acc;
              acc += seg.pct * circ;
              return (
                <circle key={i}
                  cx={cx} cy={cy} r={r} fill="none"
                  stroke={seg.color} strokeWidth="26"
                  strokeDasharray={`${Math.max(vis, 0)} ${circ}`}
                  strokeDashoffset={off} strokeLinecap="butt"
                />
              );
            })}
          </g>
          <circle cx={cx} cy={cy} r="57" fill="white" />
          {total > 0 ? (
            <>
              <text x={cx} y={cy - 7} textAnchor="middle" style={{ fontSize: '10px', fill: '#9ca3af' }}>Total</text>
              <text x={cx} y={cy + 9} textAnchor="middle" style={{ fontSize: '14px', fontWeight: 700, fill: '#0a0a0a' }}>
                {fmtShort(total)}
              </text>
            </>
          ) : (
            <text x={cx} y={cy + 5} textAnchor="middle" style={{ fontSize: '11px', fill: '#9ca3af' }}>No budget</text>
          )}
        </svg>
      </div>

      <div className="space-y-2">
        {[
          { label: 'Spent',     value: spent,      pct: spentPct,     color: '#22c55e', desc: 'Completed stages'      },
          { label: 'Active',    value: activeAmt,  pct: activePct,    color: '#3b82f6', desc: 'In progress'           },
          { label: 'Remaining', value: remaining,  pct: remainingPct, color: '#e2e8f0', desc: 'Upcoming stages'       },
        ].map(row => (
          <div key={row.label} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full border border-black/10"
              style={{ backgroundColor: row.color }} />
            <div className="flex-1 min-w-0">
              <span className="text-xs text-brand-near-black font-medium">{row.label}</span>
              <span className="text-[10px] text-brand-mid-grey ml-1">· {row.desc}</span>
            </div>
            <span className="text-xs font-bold tabular-nums text-brand-near-black">
              {total > 0 ? fmtShort(row.value) : '—'}
            </span>
            <span className="text-[10px] tabular-nums text-brand-mid-grey w-7 text-right">{row.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── How Your Budget Was Calculated ─────────────────────────

function BudgetCalculation({ project }: { project: ProjectRow }) {
  const [rate, setRate]           = useState<ConstructionRate | null>(null);
  const [rateLoading, setRateLoading] = useState(true);

  useEffect(() => {
    if (!project.country) return;
    setRateLoading(true);
    getConstructionRate(project.country).then(r => {
      setRate(r);
      setRateLoading(false);
    });
  }, [project.country]);

  const detail = calculateBudgetDetail({
    country:         project.country,
    finishLevel:     project.finish_level,
    sqm:             Number(project.sqm),
    floors:          project.num_floors,
    buildingType:    project.building_type,
    roofType:        project.roof_type,
    hasBoysQuarters: project.has_boys_quarters,
    bqRooms:         project.bq_rooms,
  }, rate);

  const isVerified = detail.dataSource === 'real_bq';
  const maxAmount  = Math.max(...detail.sections.map(s => s.amountUSD), 1);
  const country    = findCountry(project.country);

  if (rateLoading) {
    return (
      <div className="bg-white rounded-2xl border border-brand-border-grey p-6 animate-pulse">
        <div className="h-4 w-60 bg-brand-light-grey rounded mb-2" />
        <div className="h-3 w-40 bg-brand-light-grey rounded mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-2.5 w-32 bg-brand-light-grey rounded" />
                <div className="flex-1 h-1.5 bg-brand-light-grey rounded-full" />
                <div className="h-2.5 w-16 bg-brand-light-grey rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-brand-border-grey overflow-hidden">

      {/* Header */}
      <div className="px-6 py-5 border-b border-brand-off-white">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-near-black">
            <Info className="size-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-brand-near-black">Budget Breakdown</h3>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide border ${
                isVerified
                  ? 'bg-green-50 text-green-700 border-green-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}>
                {isVerified ? 'Verified data' : 'Regional estimate'}
              </span>
            </div>
            <p className="text-xs text-brand-mid-grey mt-0.5">
              {isVerified
                ? `Calibrated from real BQ data for ${country?.name ?? project.country}`
                : `Indexed from comparable markets — no verified BQ for ${country?.name ?? project.country} yet`}
            </p>
          </div>
          <div className="text-right shrink-0">
            <span className="text-xl font-black tabular-nums text-brand-near-black">
              {formatUSDFull(detail.total)}
            </span>
            {detail.currencyCode !== 'USD' && (
              <p className="text-[10px] text-brand-mid-grey tabular-nums mt-0.5">
                ~{formatLocalCurrency(detail.totalLocal, detail.currencyCode)}{' '}
                <span className="text-[9px]">(approx.)</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Trade sections */}
      <div className="px-6 py-5">
        <p className="text-[10px] font-semibold text-brand-mid-grey uppercase tracking-widest mb-4">
          Construction Cost Breakdown by Trade
        </p>
        <div className="space-y-3">
          {detail.sections.map((section, i) => {
            const barW = (section.amountUSD / maxAmount) * 100;
            return (
              <div key={section.key}>
                <div className="flex items-baseline justify-between mb-1 flex-wrap gap-x-3">
                  <div className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm shrink-0" style={{ backgroundColor: section.color }} />
                    <span className="text-xs font-semibold text-brand-near-black">{section.label}</span>
                  </div>
                  <div className="flex items-baseline gap-2 shrink-0">
                    <span className="text-[10px] text-brand-mid-grey tabular-nums">{section.pct}%</span>
                    <span className="text-sm font-black tabular-nums text-brand-near-black">
                      {formatUSDFull(section.amountUSD)}
                    </span>
                    {detail.currencyCode !== 'USD' && (
                      <span className="text-[10px] tabular-nums text-brand-mid-grey hidden sm:block">
                        ~{formatLocalCurrency(section.amountLocal, detail.currencyCode)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-2 w-full rounded-full bg-brand-light-grey overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: section.color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${barW}%` }}
                    transition={{ duration: 0.7, delay: i * 0.05, ease: 'easeOut' }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Context note */}
        <div className="mt-5 rounded-xl bg-brand-off-white border border-brand-border-grey p-3">
          <p className="text-[10px] text-brand-mid-grey leading-relaxed">
            <strong className="text-brand-near-black">How this is calculated:</strong>{' '}
            {project.sqm} sqm × ${rate?.base_rate_usd ?? '—'}/sqm (
            {country?.name ?? project.country}, {project.finish_level} finish),
            adjusted for building type, {project.num_floors > 1 ? `${project.num_floors} floors, ` : ''}and roof.
            Actual costs vary by city, contractor, and current material prices.
            Confirm with a certified quantity surveyor.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Jalla badge ────────────────────────────────────────────

function JallaBadge() {
  return (
    <div className="bg-white rounded-2xl border border-brand-border-grey px-5 py-4 flex items-center gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-near-black">
        <Shield className="size-4 text-white" />
      </div>
      <div>
        <p className="text-xs font-semibold text-brand-near-black">Jalla project</p>
        <p className="text-[10px] text-brand-mid-grey">Tracked end-to-end on the Jalla platform</p>
      </div>
    </div>
  );
}

// ── Skeleton ───────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white p-5 flex flex-col gap-3 animate-pulse">
      <div className="flex justify-between">
        <div className="h-3 w-14 rounded bg-brand-light-grey" />
        <div className="h-5 w-16 rounded-full bg-brand-light-grey" />
      </div>
      <div className="h-5 w-2/3 rounded bg-brand-light-grey" />
      <div className="h-3 w-1/2 rounded bg-brand-light-grey" />
      <div className="h-2 w-full rounded-full bg-brand-light-grey mt-1" />
    </div>
  );
}

// ── Project card ───────────────────────────────────────────

function ProjectCard({ project }: { project: ProjectRow }) {
  const tier    = TIER_META[project.tier] ?? TIER_META.self_verify;
  const status  = PROJECT_STATUS_META[project.status as keyof typeof PROJECT_STATUS_META] ?? PROJECT_STATUS_META.active;
  const country = findCountry(project.country);
  const done    = completedStages(project);
  const pct     = Math.round((done / TOTAL_STAGES) * 100);
  const loc     = [project.city, country?.name ?? project.country].filter(Boolean).join(', ');

  return (
    <Link to={`/projects/${project.id}`}
      className="group block rounded-2xl border border-brand-border-grey bg-white p-5 hover:border-brand-near-black hover:shadow-sm transition-all duration-200">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${tier.color}`}>
          {tier.icon} {tier.label}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${status.badge}`}>
          <span className={`size-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </span>
      </div>
      <h3 className="text-base font-bold text-brand-near-black leading-snug truncate mb-1">{project.name}</h3>
      <div className="flex items-center gap-2 text-xs text-brand-mid-grey mb-4 flex-wrap">
        <span className="flex items-center gap-1">
          <Building2 className="size-3 shrink-0" />
          {BT_LABELS[project.building_type] ?? project.building_type}
        </span>
        {loc && (
          <>
            <span className="text-brand-border-grey">·</span>
            <span className="flex items-center gap-1"><MapPin className="size-3 shrink-0" />{loc}</span>
          </>
        )}
      </div>
      <div className="mb-4">
        <div className="flex items-center justify-between text-[10px] text-brand-mid-grey mb-1.5">
          <span>{done}/{TOTAL_STAGES} stages</span>
          <span className="font-semibold text-brand-near-black">{pct}%</span>
        </div>
        <HorizBar pct={pct} color="#22c55e" />
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] text-brand-mid-grey mb-0.5">Est. budget</p>
          <p className="text-sm font-bold text-brand-near-black tabular-nums">
            {project.budget_usd ? formatUSDFull(project.budget_usd) : '—'}
          </p>
        </div>
        <span className="flex items-center gap-1 text-xs font-semibold text-brand-mid-grey group-hover:text-brand-near-black transition-colors">
          Open <ChevronRight className="size-3.5 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </div>
    </Link>
  );
}

// ── Empty state ────────────────────────────────────────────

function EmptyBuilds() {
  return (
    <Link to="/projects/new"
      className="flex flex-col items-center justify-center gap-5 rounded-2xl border-2 border-dashed border-brand-border-grey p-12 hover:border-brand-near-black hover:bg-white transition-all group text-center">
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
        className="flex size-16 items-center justify-center rounded-full bg-brand-off-white group-hover:bg-brand-near-black transition-colors">
        <HardHat className="size-8 text-brand-mid-grey group-hover:text-white transition-colors" />
      </motion.div>
      <div>
        <p className="text-base font-semibold text-brand-near-black mb-1">Start your first build</p>
        <p className="text-sm text-brand-mid-grey leading-relaxed max-w-xs mx-auto">
          Track every stage, manage your budget, and stay connected with your contractor — all in one place.
        </p>
      </div>
      <span className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black text-white text-sm font-semibold px-6 py-3 group-hover:bg-black transition-colors">
        <Plus className="size-4" /> Create a build
      </span>
    </Link>
  );
}

// ── Dashboard ──────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const isContractor = user?.user_metadata?.role === 'contractor';

  const [projects,      setProjects]      = useState<ProjectRow[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [activeStages,  setActiveStages]  = useState<ProjectStage[]>([]);
  const [stagesLoading, setStagesLoading] = useState(false);

  const displayName = user?.user_metadata?.full_name
    ?? user?.email?.split('@')[0]
    ?? 'there';
  const nameSet    = !!user?.user_metadata?.full_name;
  const idUploaded = !!user?.user_metadata?.id_document_path;

  const atStarterLimit = projects.filter(
    p => p.tier === 'self_verify' || (p.tier as string) === 'starter'
  ).length >= STARTER_LIMIT;

  const totalBudget   = projects.reduce((s, p) => s + (p.budget_usd ?? 0), 0);
  const activeCount   = projects.filter(p => p.status === 'active').length;
  const totalDone     = projects.reduce((s, p) => s + completedStages(p), 0);
  const totalPossible = projects.length * TOTAL_STAGES;

  const activeProject = projects
    .filter(p => p.status === 'active')
    .sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime())[0]
    ?? projects[0];

  useEffect(() => {
    if (!user) return;
    const loader = isContractor ? fetchContractorProjects(user.id) : fetchProjects(user.id);
    loader.then(setProjects).catch(() => {}).finally(() => setLoading(false));
  }, [user, isContractor]);

  useEffect(() => {
    if (!activeProject?.id) { setActiveStages([]); return; }
    setStagesLoading(true);
    supabase
      .from('project_stages')
      .select('id, stage_number, name, status, budget_pct')
      .eq('project_id', activeProject.id)
      .order('stage_number')
      .then(({ data }) => {
        setActiveStages((data ?? []) as ProjectStage[]);
        setStagesLoading(false);
      });
  }, [activeProject?.id]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 space-y-5">

      {/* Greeting hero */}
      <div className="relative rounded-2xl bg-brand-near-black overflow-hidden px-6 sm:px-8 py-7">
        <svg aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.07]"
          viewBox="0 0 700 160" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="dg" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="700" height="160" fill="url(#dg)" />
          <line x1="150" y1="0" x2="150" y2="160" stroke="white" strokeWidth="1" />
          <line x1="380" y1="0" x2="380" y2="160" stroke="white" strokeWidth="1" />
          <line x1="580" y1="0" x2="580" y2="160" stroke="white" strokeWidth="1" />
          <line x1="0" y1="60" x2="700" y2="60" stroke="white" strokeWidth="0.8" />
          <line x1="0" y1="120" x2="700" y2="120" stroke="white" strokeWidth="0.8" />
        </svg>
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-white/45 text-xs font-medium tracking-widest uppercase mb-1">{greeting()}</p>
            <h1 className="text-white text-2xl sm:text-3xl font-bold mb-1">{displayName.split(' ')[0]}</h1>
            <p className="text-white/55 text-sm max-w-sm">
              {loading ? 'Loading your builds…'
                : projects.length === 0
                  ? "You haven't started any builds yet. Let's change that."
                  : `You have ${activeCount} active build${activeCount !== 1 ? 's' : ''} in progress.`}
            </p>
          </div>
          {!isContractor && !atStarterLimit && (
            <Link to="/projects/new"
              className="inline-flex items-center gap-2 rounded-xl bg-white text-brand-near-black text-sm font-semibold px-5 py-2.5 hover:bg-brand-off-white transition-colors shrink-0">
              <Plus className="size-4" /> New Project
            </Link>
          )}
        </div>
      </div>

      {/* Profile completion */}
      {!loading && !isContractor && (
        <ProfileCompletion nameSet={nameSet} idUploaded={idUploaded} hasProject={projects.length > 0} />
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Projects"      value={loading ? '—' : String(projects.length)}    sub={`${activeCount} active`}           icon={FolderOpen}   accent />
        <StatCard label="Total Budget"  value={loading ? '—' : fmtShort(totalBudget)}      sub="Across all projects"               icon={Wallet}              />
        <StatCard label="Stages Done"   value={loading ? '—' : `${totalDone}/${totalPossible || '—'}`}
          sub={totalPossible > 0 ? `${Math.round((totalDone / totalPossible) * 100)}% complete` : 'No stages yet'} icon={CheckCircle2} />
        <StatCard label="Active Builds" value={loading ? '—' : String(activeCount)}         sub="Currently in progress"            icon={HardHat}             />
      </div>

      {/* Analytics — active project */}
      {!loading && activeProject ? (
        <>
          {/* Two-column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
            <div className="lg:col-span-3">
              <StageProgressPanel
                project={activeProject}
                stages={activeStages}
                stagesLoading={stagesLoading}
              />
            </div>
            <div className="lg:col-span-2 flex flex-col gap-4">
              <CostingDonut project={activeProject} stages={activeStages} />
              <JallaBadge />
            </div>
          </div>

          {/* How your budget was calculated */}
          <BudgetCalculation project={activeProject} />
        </>
      ) : !loading && projects.length === 0 && !isContractor ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: <Building2 className="size-5 text-brand-mid-grey" />, title: 'Create a build', desc: 'Tell us your project type, location, floors, and rooms.' },
            { icon: <HardHat   className="size-5 text-brand-mid-grey" />, title: 'Add your contractor', desc: 'Invite your contractor so they can upload site evidence.' },
            { icon: <CheckCircle2 className="size-5 text-brand-mid-grey" />, title: 'Approve stages', desc: 'Review and approve each build stage as your project progresses.' },
          ].map(tip => (
            <div key={tip.title} className="bg-white rounded-2xl border border-brand-border-grey p-5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-brand-off-white mb-3">{tip.icon}</div>
              <p className="text-sm font-semibold text-brand-near-black mb-1">{tip.title}</p>
              <p className="text-xs text-brand-mid-grey leading-relaxed">{tip.desc}</p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Recent projects */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-brand-near-black">Recent Projects</h2>
          {projects.length > 0 && (
            <Link to="/projects" className="text-xs font-medium text-brand-mid-grey hover:text-brand-near-black transition-colors">
              View all →
            </Link>
          )}
        </div>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <SkeletonCard /><SkeletonCard /><SkeletonCard />
          </div>
        ) : projects.length === 0 ? (
          isContractor
            ? <div className="rounded-2xl border border-dashed border-brand-border-grey p-6 text-sm text-brand-mid-grey">
                No assigned builds yet. Check back once your invite is confirmed.
              </div>
            : <EmptyBuilds />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {projects.slice(0, 4).map((p, i) => (
              <motion.div key={p.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}>
                <ProjectCard project={p} />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
