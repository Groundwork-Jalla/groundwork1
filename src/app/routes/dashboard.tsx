import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import {
  Plus, BadgeCheck, ShieldCheck, Briefcase,
  MapPin, Building2, ChevronRight, FolderOpen,
  Wallet, CreditCard, CheckCircle2, HardHat,
  UserCircle, Check, ArrowRight, TrendingUp,
  Lock, CircleDot,
} from 'lucide-react';
import { useAuth }                    from '@/contexts/AuthContext';
import { supabase }                   from '@/lib/supabase/client';
import { fetchProjects }              from '@/lib/supabase/projects';
import { fetchContractorProjects }    from '@/lib/supabase/invites';
import { formatUSDFull, BUDGET_ROLLUP_PCT } from '@/lib/budget';
import { formatDate, formatMoney } from '@/lib/format';
import { findCountry }   from '@/lib/countries';
import { useT, type TKey } from '@/lib/i18n';
import type { ProjectRow } from '@/types/project';
import { useStageLabels } from '@/lib/stage-labels';
import { useDomainLabels } from '@/lib/domain-labels';

// ── Types ──────────────────────────────────────────────────

type StageStatus = 'locked' | 'active' | 'pending_review' | 'complete';

interface ProjectStage {
  id: string;
  stage_number: number;
  /** i18n key (migration 024); null falls back to `name`. */
  stage_key: string | null;
  name: string;
  status: StageStatus;
  budget_pct: number | null;
  completed_at: string | null;
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

const STARTER_LIMIT  = 3;
const TOTAL_STAGES   = 10;
const PREDICTED_DAYS = 196;

const TIER_META: Record<string, { labelKey: TKey; icon: React.ReactNode; color: string }> = {
  self_verify:      { labelKey: 'tiers.selfVerify',      icon: <BadgeCheck className="size-3" />,  color: 'text-brand-mid-grey' },
  jalla_verify:     { labelKey: 'tiers.jallaVerify',     icon: <ShieldCheck className="size-3" />, color: 'text-blue-600'       },
  jalla_management: { labelKey: 'tiers.jallaManagement', icon: <Briefcase className="size-3" />,   color: 'text-purple-600'     },
  starter:          { labelKey: 'tiers.selfVerify',      icon: <BadgeCheck className="size-3" />,  color: 'text-brand-mid-grey' },
  pro:              { labelKey: 'tiers.jallaVerify',     icon: <ShieldCheck className="size-3" />, color: 'text-blue-600'       },
  enterprise:       { labelKey: 'tiers.jallaManagement', icon: <Briefcase className="size-3" />,   color: 'text-purple-600'     },
};

const PROJECT_STATUS_META: Record<string, { labelKey: TKey; dot: string; badge: string }> = {
  active:    { labelKey: 'common.active',   dot: 'bg-green-500',         badge: 'bg-green-50 text-green-700 border border-green-200'                    },
  on_hold:   { labelKey: 'common.onHold',   dot: 'bg-amber-500',         badge: 'bg-amber-50 text-amber-700 border border-amber-200'                    },
  completed: { labelKey: 'common.complete', dot: 'bg-brand-mid-grey',    badge: 'bg-brand-off-white text-brand-mid-grey border border-brand-border-grey' },
  archived:  { labelKey: 'common.archived', dot: 'bg-brand-border-grey', badge: 'bg-brand-off-white text-brand-mid-grey border border-brand-border-grey' },
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

function HorizBar({ pct, color = 'var(--color-progress-bar-default)' }: { pct: number; color?: string }) {
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
  const t = useT();
  const items: { label: string; done: boolean }[] = [
    { label: t('dashboard.profileCompletion.accountCreated'), done: true       },
    { label: t('dashboard.profileCompletion.nameSet'),        done: nameSet    },
    { label: t('dashboard.profileCompletion.idUploaded'),     done: idUploaded },
    { label: t('dashboard.profileCompletion.firstProject'),   done: hasProject },
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
            <p className="text-sm font-semibold text-brand-near-black">{t('dashboard.profileCompletion.title')}</p>
            <p className="text-xs text-brand-mid-grey mt-0.5">{t('dashboard.profileCompletion.subtitle')}</p>
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

// ── Journey card (Your Journey) ────────────────────────────

function JourneyCard({ projects, activeProject, completedCount }: {
  projects: ProjectRow[];
  activeProject: ProjectRow | undefined;
  completedCount: number;
}) {
  const t = useT();
  const hasProjects = projects.length > 0;
  const hasActive   = !!activeProject;

  let status: string;
  let statusCls: string;
  let title: string;
  let desc: string;
  let href: string;
  let btnLabel: string;

  if (!hasProjects) {
    status    = 'Planning';
    statusCls = 'bg-brand-off-white text-brand-mid-grey border-brand-border-grey';
    title     = "Let's get building";
    desc      = 'Create your first project to start tracking your build from day one.';
    href      = '/projects/new';
    btnLabel  = 'Create project';
  } else if (!hasActive) {
    status    = 'Onboarding';
    statusCls = 'bg-blue-50 text-blue-700 border-blue-200';
    title     = 'Almost there';
    desc      = 'Open a project and add your contractor to begin stage tracking.';
    href      = '/projects';
    btnLabel  = 'Open projects';
  } else if (completedCount >= TOTAL_STAGES) {
    status    = 'Completed';
    statusCls = 'bg-green-50 text-green-700 border-green-200';
    title     = 'Build complete';
    desc      = 'All stages are done. Download your project summary and certificate.';
    href      = `/projects/${activeProject.id}`;
    btnLabel  = 'View project';
  } else if (completedCount > 7) {
    status    = 'Finishing';
    statusCls = 'bg-green-50 text-green-700 border-green-200';
    title     = 'Nearly there';
    desc      = `${completedCount} of ${TOTAL_STAGES} stages done — prepare for handover on ${activeProject.name}.`;
    href      = `/projects/${activeProject.id}`;
    btnLabel  = 'View project';
  } else if (completedCount >= 1) {
    status    = 'Active';
    statusCls = 'bg-blue-50 text-blue-700 border-blue-200';
    title     = 'Build in progress';
    desc      = `${completedCount} of ${TOTAL_STAGES} stages complete on ${activeProject.name}. Check your current stage and approve progress.`;
    href      = `/projects/${activeProject.id}`;
    btnLabel  = 'Open project';
  } else {
    // project exists but no stages done — could be dormant
    const lastUpdated = activeProject.updated_at ? new Date(activeProject.updated_at) : null;
    const daysSince   = lastUpdated ? Math.floor((Date.now() - lastUpdated.getTime()) / 86400000) : 999;
    status    = daysSince > 7 ? 'Dormant' : 'Active';
    statusCls = daysSince > 7
      ? 'bg-brand-off-white text-brand-mid-grey border-brand-border-grey'
      : 'bg-blue-50 text-blue-700 border-blue-200';
    title     = daysSince > 7 ? "We're still here" : 'Ready to build';
    desc      = daysSince > 7
      ? "It's been a while — pick up where you left off in a few clicks."
      : `${activeProject.name} is set up and ready. Upload your first evidence to get started.`;
    href      = `/projects/${activeProject.id}`;
    btnLabel  = 'Open project';
  }

  const lastActivity = activeProject?.updated_at
    ? formatDate(activeProject.updated_at, 'short')
    : null;

  return (
    <div className="bg-white dark:bg-[#1e1e1e] border border-brand-border-grey dark:border-[#2c2c2c] rounded-2xl px-5 py-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold text-brand-mid-grey uppercase tracking-widest">{t('dashboard.yourJourney')}</p>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusCls}`}>
            {status}
          </span>
        </div>
      </div>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-lg font-bold text-brand-near-black dark:text-white leading-snug">{title}</p>
          <p className="text-xs text-brand-mid-grey mt-1 leading-relaxed max-w-sm">{desc}</p>
          {lastActivity && (
            <p className="text-[10px] text-brand-mid-grey mt-2">Last activity: {lastActivity}</p>
          )}
        </div>
        <Link to={href}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black text-xs font-semibold px-4 py-2.5 hover:opacity-90 transition-opacity whitespace-nowrap">
          {btnLabel} <ArrowRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}

// ── Progress velocity chart ────────────────────────────────

function VelocityChart({ project, stages }: {
  project: ProjectRow;
  stages: ProjectStage[];
}) {
  const t = useT();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const start      = new Date(project.created_at).getTime();
  const now        = Date.now();
  const plannedEnd = start + PREDICTED_DAYS * 86400000;
  const chartEnd   = Math.max(now, plannedEnd) + 20 * 86400000;
  const xSpan      = chartEnd - start;

  const W = 460, H = 186;
  const PL = 36, PR = 14, PT = 16, PB = 38;
  const cw = W - PL - PR;
  const ch = H - PT - PB;

  const toX   = (t: number) => PL + ((t - start) / xSpan) * cw;
  const toY   = (c: number) => PT + ((TOTAL_STAGES - c) / TOTAL_STAGES) * ch;
  const fromX = (px: number) => start + ((px - PL) / cw) * xSpan;
  const nowX  = toX(now);

  // Planned line: steady linear from (start,0) → (plannedEnd, 10)
  const plannedPts = [
    { x: toX(start),      y: toY(0),            t: start,      c: 0 },
    { x: toX(plannedEnd), y: toY(TOTAL_STAGES),  t: plannedEnd, c: TOTAL_STAGES },
  ];

  // Actual line: step-wise using real completed_at timestamps
  const doneByDate = stages
    .filter(s => s.status === 'complete' && s.completed_at)
    .sort((a, b) => +new Date(a.completed_at!) - +new Date(b.completed_at!));

  const actualPts: { x: number; y: number; t: number; c: number; name?: string }[] = [
    { x: toX(start), y: toY(0), t: start, c: 0 },
  ];
  doneByDate.forEach((s, i) => {
    const t = +new Date(s.completed_at!);
    actualPts.push({ x: toX(t), y: toY(i + 1), t, c: i + 1, name: s.name });
  });
  const totalDone = stages.filter(s => s.status === 'complete').length;
  // Extend to today (plateau at current count)
  actualPts.push({ x: toX(now), y: toY(totalDone), t: now, c: totalDone });

  // Monthly X ticks
  const allMonths: { t: number; label: string }[] = [];
  const md = new Date(project.created_at);
  md.setDate(1);
  md.setMonth(md.getMonth() + 1);
  while (md.getTime() <= chartEnd) {
    allMonths.push({ t: md.getTime(), label: formatDate(md, 'month') });
    md.setMonth(md.getMonth() + 1);
  }
  const tickStep = allMonths.length <= 8 ? 1 : Math.ceil(allMonths.length / 8);
  const months   = allMonths.filter((_, i) => i % tickStep === 0);

  const yTicks = [0, 2, 4, 6, 8, 10];

  // Hover helpers
  const hoverT       = hoverX !== null ? fromX(hoverX) : null;
  const hoverActual  = hoverT !== null
    ? actualPts.reduce((b, p) => Math.abs(p.t - hoverT) < Math.abs(b.t - hoverT) ? p : b)
    : null;
  const hoverPlanned = hoverT !== null
    ? Math.min(10, Math.max(0, ((hoverT - start) / (plannedEnd - start)) * 10))
    : null;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px   = (e.clientX - rect.left) * (W / rect.width);
    setHoverX(px >= PL && px <= W - PR ? px : null);
  };

  const polyStr = (pts: { x: number; y: number }[]) =>
    pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const areaStr = [
    ...actualPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `${actualPts.at(-1)!.x.toFixed(1)},${(PT + ch).toFixed(1)}`,
    `${actualPts[0].x.toFixed(1)},${(PT + ch).toFixed(1)}`,
  ].join(' ');

  const fmtD = (t: number) => formatDate(t, 'medium');

  return (
    <div className="rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] p-4">
      {/* Header + legend */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-brand-near-black dark:text-white">{t('dashboard.buildProgress')}</p>
          <p className="text-xs text-brand-mid-grey mt-0.5">{t('dashboard.progressSub')}</p>
        </div>
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-brand-mid-grey">
            <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden>
              <line x1="0" y1="5" x2="22" y2="5" stroke="#9ca3af" strokeWidth="2" strokeDasharray="4,3" />
            </svg>
            {t('dashboard.planned')}
          </span>
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-blue-500">
            <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden>
              <line x1="0" y1="5" x2="22" y2="5" stroke="#3b82f6" strokeWidth="2" />
              <circle cx="11" cy="5" r="3" fill="#3b82f6" stroke="white" strokeWidth="1.5" />
            </svg>
            {t('dashboard.actual')}
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          preserveAspectRatio="none"
          style={{ overflow: 'visible', height: '130px' }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverX(null)}
        >
          {/* Y grid + labels */}
          {yTicks.map(c => (
            <g key={c}>
              <line x1={PL} y1={toY(c)} x2={W - PR} y2={toY(c)}
                stroke="var(--color-brand-border-grey)"
                strokeWidth={c === 0 ? 1.2 : 0.6}
                strokeDasharray={c === 0 ? undefined : '4,4'} />
              <text x={PL - 5} y={toY(c) + 3.5} textAnchor="end" fontSize="9"
                style={{ fill: 'var(--color-brand-mid-grey)', fontVariantNumeric: 'tabular-nums' }}>
                {c}
              </text>
            </g>
          ))}

          {/* Y-axis title */}
          <text x={9} y={PT + ch / 2} textAnchor="middle" fontSize="9"
            transform={`rotate(-90, 9, ${PT + ch / 2})`}
            style={{ fill: 'var(--color-brand-mid-grey)' }}>
            {t('dashboard.stagesAxis')}
          </text>

          {/* X baseline */}
          <line x1={PL} y1={PT + ch} x2={W - PR} y2={PT + ch}
            stroke="var(--color-brand-border-grey)" strokeWidth="1.2" />

          {/* Month ticks + labels */}
          {months.map((m, i) => {
            const x = toX(m.t);
            if (x < PL || x > W - PR) return null;
            return (
              <g key={i}>
                <line x1={x} y1={PT + ch} x2={x} y2={PT + ch + 4}
                  stroke="var(--color-brand-border-grey)" strokeWidth="1" />
                <text x={x} y={PT + ch + 15} textAnchor="middle" fontSize="9"
                  style={{ fill: 'var(--color-brand-mid-grey)' }}>
                  {m.label}
                </text>
              </g>
            );
          })}

          {/* X-axis title */}
          <text x={PL + cw / 2} y={H - 1} textAnchor="middle" fontSize="9"
            style={{ fill: 'var(--color-brand-mid-grey)' }}>
            {t('dashboard.monthAxis')}
          </text>

          {/* TODAY marker */}
          {nowX >= PL && nowX <= W - PR && (
            <>
              <line x1={nowX} y1={PT} x2={nowX} y2={PT + ch}
                stroke="#ef4444" strokeWidth="1" strokeDasharray="3,3" opacity="0.45" />
              <text x={nowX + 3} y={PT + 10} fontSize="8"
                style={{ fill: '#ef4444' }} opacity="0.75">{t('dashboard.today')}</text>
            </>
          )}

          {/* Planned line (dashed grey) */}
          <polyline points={polyStr(plannedPts)}
            fill="none" stroke="#9ca3af" strokeWidth="1.5"
            strokeDasharray="5,4" strokeLinecap="round" />

          {/* Actual area fill */}
          {actualPts.length > 1 && (
            <polygon points={areaStr} fill="rgba(59,130,246,0.07)" />
          )}

          {/* Actual line (solid blue) */}
          <polyline points={polyStr(actualPts)}
            fill="none" stroke="#3b82f6" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />

          {/* Data dots on actual */}
          {actualPts.map((p, i) => {
            if (i === 0) return null;
            const isLast = i === actualPts.length - 1;
            return (
              <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)}
                r={isLast ? 5 : 3.5}
                fill="#3b82f6" stroke="white" strokeWidth={isLast ? 2 : 1.5} />
            );
          })}

          {/* Hover crosshair ring */}
          {hoverActual && (
            <circle cx={hoverActual.x.toFixed(1)} cy={hoverActual.y.toFixed(1)} r={7}
              fill="white" stroke="#3b82f6" strokeWidth="2" opacity="0.9" />
          )}
        </svg>

        {/* Tooltip */}
        {hoverActual && hoverPlanned !== null && (
          <div
            className="pointer-events-none absolute z-20 min-w-36 rounded-lg border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#252525] shadow-lg px-3 py-2 text-xs"
            style={{
              left:      `${(hoverActual.x / W) * 100}%`,
              top:       `${(hoverActual.y / H) * 100}%`,
              transform: 'translate(-50%, calc(-100% - 10px))',
            }}
          >
            <p className="font-semibold text-brand-near-black dark:text-white mb-1">
              {hoverActual.c} of {TOTAL_STAGES} stages
            </p>
            {hoverActual.name && (
              <p className="text-brand-mid-grey text-[10px] mb-0.5 truncate max-w-40">{hoverActual.name}</p>
            )}
            <p className="text-brand-mid-grey text-[10px]">{fmtD(hoverActual.t)}</p>
            <p className="text-[10px] text-brand-mid-grey mt-1 pt-1 border-t border-brand-border-grey dark:border-[#333]">
              Planned: {Math.round(hoverPlanned * 10) / 10} stages
            </p>
          </div>
        )}
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
  const { stageLabel } = useStageLabels();
  const t = useT();
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
              <h3 className="text-sm font-semibold text-brand-near-black">{t('dashboard.stageProgressTitle')}</h3>
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
                    {stageLabel(stage)}
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

// ── Costing allocation donut (Materials / Labor / Fees / Permits) ──

// Shares the roll-up used by the project Overview donut. These two showed different
// numbers for the same project before — 34%/2% here against 27%/9% there.
const COST_CATS = [
  { key: 'materials', label: 'Materials',         desc: 'Cement, blocks, rebar, fittings',     color: '#3b82f6', pct: BUDGET_ROLLUP_PCT.materials },
  { key: 'labor',     label: 'Labor',             desc: 'Site workers + supervision',          color: '#22c55e', pct: BUDGET_ROLLUP_PCT.labor     },
  { key: 'fees',      label: 'Professional Fees', desc: 'Architects, engineers, project mgmt', color: '#f59e0b', pct: BUDGET_ROLLUP_PCT.fees      },
  { key: 'permits',   label: 'Permits & contingency', desc: 'Government approvals & reserve',  color: '#1f2937', pct: BUDGET_ROLLUP_PCT.permits   },
];

function CostingDonut({ project }: { project: ProjectRow }) {
  const t = useT();
  const total = project.budget_usd ?? 0;
  const biggest = COST_CATS[0];

  const r = 68, cx = 100, cy = 100, circ = 2 * Math.PI * r, GAP = 3;
  let acc = 0;

  return (
    <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] p-5">
      <h3 className="text-sm font-semibold text-brand-near-black dark:text-white mb-0.5">{t('dashboard.costingAllocation')}</h3>
      <p className="text-xs text-brand-mid-grey mb-4">
        {total > 0
          ? <>{t('dashboard.biggestCostPre')} <strong className="text-brand-near-black dark:text-white">{biggest.label}</strong> {biggest.pct}% {t('dashboard.biggestCostPost')}</>
          : 'Budget breakdown by category'}
      </p>

      <div className="flex justify-center mb-4">
        <svg viewBox="0 0 200 200" className="w-40 h-40">
          <g transform={`rotate(-90, ${cx}, ${cy})`}>
            {COST_CATS.map((cat) => {
              const fraction = cat.pct / 100;
              const vis = fraction * circ - GAP;
              const off = -acc;
              acc += fraction * circ;
              return (
                <circle key={cat.key}
                  cx={cx} cy={cy} r={r} fill="none"
                  stroke={cat.color} strokeWidth="26"
                  strokeDasharray={`${Math.max(vis, 0)} ${circ}`}
                  strokeDashoffset={off} strokeLinecap="butt"
                />
              );
            })}
          </g>
          <circle cx={cx} cy={cy} r="55" fill="var(--color-donut-bg, white)" />
          {total > 0 ? (
            <>
              <text x={cx} y={cy - 8} textAnchor="middle" style={{ fontSize: '9px', fill: '#9ca3af' }}>{t('dashboard.totalBudget')}</text>
              <text x={cx} y={cy + 9} textAnchor="middle" style={{ fontSize: '13px', fontWeight: 700 }} fill="var(--color-brand-near-black, #111)">
                {fmtShort(total)}
              </text>
            </>
          ) : (
            <text x={cx} y={cy + 4} textAnchor="middle" style={{ fontSize: '11px', fill: '#9ca3af' }}>{t('dashboard.noBudget')}</text>
          )}
        </svg>
      </div>

      <div className="space-y-2.5">
        {COST_CATS.map(cat => (
          <div key={cat.key} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: cat.color }} />
            <div className="flex-1 min-w-0">
              <span className="text-xs text-brand-near-black dark:text-white font-medium">{cat.label}</span>
              <span className="text-[10px] text-brand-mid-grey ml-1">· {cat.desc}</span>
            </div>
            <span className="text-[10px] tabular-nums text-brand-mid-grey font-semibold">{cat.pct}%</span>
          </div>
        ))}
      </div>

      {total > 0 && (
        <p className="text-[10px] text-brand-mid-grey mt-4 pt-3 border-t border-brand-border-grey dark:border-[#2c2c2c]">
          Total estimated cost: {formatMoney(total)}.
        </p>
      )}
    </div>
  );
}

// ── Platform newsfeed ──────────────────────────────────────

const FEED_ITEMS = [
  {
    id: 1,
    icon: '🏗️',
    title: 'Budget Breakdown v2 live',
    body: 'Accurate construction rates now calibrated from real Cameroonian BQ data.',
    age: '2d ago',
  },
  {
    id: 2,
    icon: '📋',
    title: 'Stage certificates coming',
    body: 'Auto-generated PDF certificates issued on every approved stage.',
    age: '1w ago',
  },
  {
    id: 3,
    icon: '🌍',
    title: '27 African markets',
    body: 'Country coverage expanded — Cameroon, Nigeria, Kenya, South Africa and more.',
    age: '2w ago',
  },
];

function NewsfeedCard() {
  const t = useT();
  return (
    <div className="bg-white rounded-2xl border border-brand-border-grey overflow-hidden flex flex-col">
      <div className="px-5 py-3.5 border-b border-brand-off-white">
        <p className="text-sm font-semibold text-brand-near-black">{t('dashboard.platformUpdates')}</p>
      </div>
      <div className="flex-1 divide-y divide-brand-off-white">
        {FEED_ITEMS.map(item => (
          <div key={item.id} className="flex items-start gap-3 px-5 py-3.5">
            <span className="text-base shrink-0 mt-0.5">{item.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-brand-near-black leading-snug">{item.title}</p>
              <p className="text-[10px] text-brand-mid-grey leading-relaxed mt-0.5">{item.body}</p>
            </div>
            <span className="text-[9px] text-brand-mid-grey shrink-0 mt-0.5 tabular-nums">{item.age}</span>
          </div>
        ))}
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
  const labels = useDomainLabels();
  const t       = useT();
  const tier    = TIER_META[project.tier] ?? TIER_META.self_verify;
  const status  = PROJECT_STATUS_META[project.status as keyof typeof PROJECT_STATUS_META] ?? PROJECT_STATUS_META.active;
  const done    = completedStages(project);
  const pct     = Math.round((done / TOTAL_STAGES) * 100);
  const loc     = [project.city, labels.country(project.country)].filter(Boolean).join(', ');

  return (
    <Link to={`/projects/${project.id}`}
      className="group block rounded-2xl border border-brand-border-grey bg-white p-5 hover:border-brand-near-black hover:shadow-sm transition-all duration-200">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${tier.color}`}>
          {tier.icon} {t(tier.labelKey)}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${status.badge}`}>
          <span className={`size-1.5 rounded-full ${status.dot}`} />
          {t(status.labelKey)}
        </span>
      </div>
      <h3 className="text-base font-bold text-brand-near-black leading-snug truncate mb-1">{project.name}</h3>
      <div className="flex items-center gap-2 text-xs text-brand-mid-grey mb-4 flex-wrap">
        <span className="flex items-center gap-1">
          <Building2 className="size-3 shrink-0" />
          {labels.buildingType(project.building_type)}
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
          <span>{t('dashboard.card.stages', { done, total: TOTAL_STAGES })}</span>
          <span className="font-semibold text-brand-near-black">{pct}%</span>
        </div>
        <HorizBar pct={pct} color="#22c55e" />
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] text-brand-mid-grey mb-0.5">{t('dashboard.card.estBudget')}</p>
          <p className="text-sm font-bold text-brand-near-black tabular-nums">
            {project.budget_usd ? formatUSDFull(project.budget_usd) : '—'}
          </p>
        </div>
        <span className="flex items-center gap-1 text-xs font-semibold text-brand-mid-grey group-hover:text-brand-near-black transition-colors">
          {t('dashboard.card.open')} <ChevronRight className="size-3.5 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </div>
    </Link>
  );
}

// ── Empty state ────────────────────────────────────────────

function EmptyBuilds() {
  const t = useT();

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
        <p className="text-base font-semibold text-brand-near-black mb-1">{t('dashboard.empty.title')}</p>
        <p className="text-sm text-brand-mid-grey leading-relaxed max-w-xs mx-auto">
          {t('dashboard.empty.body')}
        </p>
      </div>
      <span className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black text-white text-sm font-semibold px-6 py-3 group-hover:bg-black transition-colors">
        <Plus className="size-4" /> {t('dashboard.empty.cta')}
      </span>
    </Link>
  );
}

// ── Dashboard ──────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const t = useT();
  const isContractor = user?.user_metadata?.role === 'contractor';

  const [projects,      setProjects]      = useState<ProjectRow[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [activeStages,  setActiveStages]  = useState<ProjectStage[]>([]);
  const [stagesLoading, setStagesLoading] = useState(false);
  const [totalPaid,     setTotalPaid]     = useState(0);

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

  const completedStageCount = activeStages.filter(s => s.status === 'complete').length;

  useEffect(() => {
    if (!user) return;
    const loader = isContractor ? fetchContractorProjects(user.id) : fetchProjects(user.id);
    loader.then(ps => {
      setProjects(ps);
      if (ps.length > 0) {
        supabase
          .from('project_stages')
          .select('payment_milestone_usd')
          .in('project_id', ps.map(p => p.id))
          .eq('payment_status', 'paid')
          .then(({ data }) => {
            setTotalPaid((data ?? []).reduce((s, r) => s + (r.payment_milestone_usd ?? 0), 0));
          });
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [user, isContractor]);

  useEffect(() => {
    if (!activeProject?.id) { setActiveStages([]); return; }
    setStagesLoading(true);
    supabase
      .from('project_stages')
      .select('id, stage_number, stage_key, name, status, budget_pct, completed_at')
      .eq('project_id', activeProject.id)
      .order('stage_number')
      .then(({ data }) => {
        setActiveStages((data ?? []) as ProjectStage[]);
        setStagesLoading(false);
      });
  }, [activeProject?.id]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 space-y-5">

      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-near-black dark:text-white">{t('dashboard.title')}</h1>
          <p className="text-sm text-brand-mid-grey mt-0.5">{t('dashboard.subtitle')}</p>
        </div>
        {!isContractor && !atStarterLimit && (
          <Link to="/projects/new"
            className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black text-white text-sm font-semibold px-5 py-2.5 hover:bg-black transition-colors shrink-0">
            <Plus className="size-4" /> {t('dashboard.newProject')}
          </Link>
        )}
      </div>

      {/* Profile completion */}
      {!loading && !isContractor && (
        <ProfileCompletion nameSet={nameSet} idUploaded={idUploaded} hasProject={projects.length > 0} />
      )}

      {/* Journey card */}
      {!loading && !isContractor && (
        <JourneyCard projects={projects} activeProject={activeProject} completedCount={completedStageCount} />
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label={t('dashboard.stats.projects')}    value={loading ? '—' : String(projects.length)}
          sub={t('dashboard.stats.activeSuffix', { count: activeCount })} icon={FolderOpen} accent />
        <StatCard label={t('dashboard.stats.totalBudget')} value={loading ? '—' : fmtShort(totalBudget)}
          sub={t('dashboard.stats.acrossAll')} icon={Wallet} />
        <StatCard label={t('dashboard.stats.totalPaid')}   value={loading ? '—' : fmtShort(totalPaid)}
          sub={totalPaid > 0
            ? t('dashboard.stats.outstanding', { amount: fmtShort(totalBudget - totalPaid) })
            : t('dashboard.stats.noPayments')} icon={CreditCard} />
        <StatCard label={t('dashboard.stats.stagesDone')}  value={loading ? '—' : `${totalDone}/${totalPossible || '—'}`}
          sub={totalPossible > 0
            ? t('dashboard.stats.percentDone', { pct: Math.round((totalDone / totalPossible) * 100) })
            : t('dashboard.stats.noStages')} icon={CheckCircle2} />
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
              <CostingDonut project={activeProject} />
              <NewsfeedCard />
            </div>
          </div>

        </>
      ) : !loading && projects.length === 0 && !isContractor ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: <Building2 className="size-5 text-brand-mid-grey" />,    title: t('dashboard.tips.createTitle'),     desc: t('dashboard.tips.createDesc')     },
            { icon: <HardHat   className="size-5 text-brand-mid-grey" />,    title: t('dashboard.tips.contractorTitle'), desc: t('dashboard.tips.contractorDesc') },
            { icon: <CheckCircle2 className="size-5 text-brand-mid-grey" />, title: t('dashboard.tips.approveTitle'),    desc: t('dashboard.tips.approveDesc')    },
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
          <h2 className="text-sm font-semibold text-brand-near-black">{t('dashboard.recentProjects')}</h2>
          {projects.length > 0 && (
            <Link to="/projects" className="text-xs font-medium text-brand-mid-grey hover:text-brand-near-black transition-colors">
              {t('common.viewAll')} →
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
                {t('dashboard.empty.contractor')}
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
