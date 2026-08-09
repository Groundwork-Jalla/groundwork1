import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import {
  Plus, BadgeCheck, ShieldCheck, Briefcase,
  ChevronRight, HardHat,
  UserCircle, Check, Upload, MessageSquare, FolderArchive,
} from 'lucide-react';
import { useAuth }                    from '@/contexts/AuthContext';
import { supabase }                   from '@/lib/supabase/client';
import { fetchProjects }              from '@/lib/supabase/projects';
import { fetchContractorProjects }    from '@/lib/supabase/invites';
import { formatUSDFull, BUDGET_ROLLUP_PCT, projectBudget } from '@/lib/budget';
import { formatMoney } from '@/lib/format';
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
  /** Stored milestone. Null on older rows — fall back to budget_pct × total. */
  payment_milestone_usd: number | null;
  payment_status: 'unpaid' | 'partial' | 'paid' | null;
}

// ── Stage status helpers ───────────────────────────────────

const isComplete = (s: ProjectStage) => s.status === 'complete';
const isActive   = (s: ProjectStage) => s.status === 'active' || s.status === 'pending_review';

// ── Constants ──────────────────────────────────────────────

const STARTER_LIMIT  = 3;
const TOTAL_STAGES   = 10;

// Tier is an identity, not a status, so it does not get a hue. Colour on this
// platform is reserved for state — active, held, overdue — and spending blue and
// purple on plan names made the one signal that does mean something harder to see.
const TIER_META: Record<string, { labelKey: TKey; icon: React.ReactNode; color: string }> = {
  self_verify:      { labelKey: 'tiers.selfVerify',      icon: <BadgeCheck className="size-3" />,  color: 'text-brand-mid-grey' },
  jalla_verify:     { labelKey: 'tiers.jallaVerify',     icon: <ShieldCheck className="size-3" />, color: 'text-brand-mid-grey' },
  jalla_management: { labelKey: 'tiers.jallaManagement', icon: <Briefcase className="size-3" />,   color: 'text-brand-mid-grey' },
  starter:          { labelKey: 'tiers.selfVerify',      icon: <BadgeCheck className="size-3" />,  color: 'text-brand-mid-grey' },
  pro:              { labelKey: 'tiers.jallaVerify',     icon: <ShieldCheck className="size-3" />, color: 'text-brand-mid-grey' },
  enterprise:       { labelKey: 'tiers.jallaManagement', icon: <Briefcase className="size-3" />,   color: 'text-brand-mid-grey' },
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

/** Returns a key, not a string — the greeting was the one untranslated line here. */
function greetingKey(): TKey {
  const h = new Date().getHours();
  if (h < 12) return 'dashboard.goodMorning';
  if (h < 17) return 'dashboard.goodAfternoon';
  return 'dashboard.goodEvening';
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

// ── Active project hero (Design B) ─────────────────────────
// The one card the dashboard is built around: the build you are actually running.
// Design B's argument is that a dashboard is a place to act, not a place to read
// statistics, so the active project gets the whole top of the page and everything
// else is secondary.

interface MoneySplit { released: number; held: number; remaining: number }

/**
 * Where this project's money currently sits.
 *
 * Derived from stage payment state rather than from a running total, so it stays
 * correct when a stage is approved out of order or a payment is reversed:
 *   · released  — milestones actually paid out
 *   · held      — milestones for stages under way but not yet released
 *   · remaining — everything still locked ahead
 */
function moneySplit(project: ProjectRow, stages: ProjectStage[]): MoneySplit {
  const { total } = projectBudget(project);

  let released = 0, held = 0;
  for (const s of stages) {
    const amount = s.payment_milestone_usd ?? pctToDollars(s.budget_pct, total);
    if (s.payment_status === 'paid') released += amount;
    else if (isActive(s)) held += amount;
  }
  return { released, held, remaining: Math.max(total - released - held, 0) };
}

function ActiveProjectHero({ project, stages, stagesLoading }: {
  project: ProjectRow; stages: ProjectStage[]; stagesLoading: boolean;
}) {
  const t = useT();
  const { stageLabel } = useStageLabels();
  const { buildingType } = useDomainLabels();

  const done    = stages.filter(isComplete).length;
  const current = stages.find(isActive);
  const pct     = stages.length ? Math.round((done / stages.length) * 100) : 0;
  const { released, held, remaining } = moneySplit(project, stages);
  const { total } = projectBudget(project);

  const meta = [
    buildingType(project.building_type),
    [project.city, project.country].filter(Boolean).join(', '),
    total > 0 ? formatUSDFull(total) : null,
  ].filter(Boolean).join(' · ');

  const status = PROJECT_STATUS_META[project.status] ?? PROJECT_STATUS_META.active;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="rounded-2xl border border-[#333] bg-brand-near-black p-6 sm:p-7"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold tracking-wide text-white/80">
          <span className={`size-1.5 rounded-full ${status.dot}`} />
          {t(status.labelKey)}
        </span>
        <span className="shrink-0 text-[11px] text-white/40 tabular-nums">
          {stagesLoading
            ? '—'
            : t('dashboard.hero.stageOf', { n: current?.stage_number ?? done, total: stages.length || TOTAL_STAGES })}
        </span>
      </div>

      <h2 className="text-xl font-bold text-white sm:text-2xl">{project.name}</h2>
      <p className="mt-1 text-xs text-white/45">{meta}</p>

      <div className="mt-5">
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full rounded-full bg-white"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-white/40">
          <span className="tabular-nums">{t('dashboard.hero.percentComplete', { pct })}</span>
          <span className="truncate pl-3">
            {current ? stageLabel(current) : t('dashboard.stageProgress.notStarted')}
          </span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2.5">
        {([
          ['dashboard.hero.released',  released],
          ['dashboard.hero.held',      held],
          ['dashboard.hero.remaining', remaining],
        ] as const).map(([labelKey, amount]) => (
          <div key={labelKey} className="rounded-xl bg-white/6 px-3 py-2.5">
            <p className="text-[9px] font-semibold text-white/40">{t(labelKey)}</p>
            <p className="mt-0.5 text-base font-bold tabular-nums text-white">
              {stagesLoading ? '—' : fmtShort(amount)}
            </p>
          </div>
        ))}
      </div>

      <Link
        to={`/projects/${project.id}`}
        className="group mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-brand-near-black transition-colors hover:bg-brand-off-white"
      >
        {t('dashboard.hero.openProject')}
        <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </motion.div>
  );
}

// ── Quick actions (Design B) ───────────────────────────────
// Four destinations with a live subtitle each, so the tile says what is waiting
// rather than merely where it goes. Monochrome icons — no emoji anywhere.

function QuickActions({ project, unread, documentCount, contractorCount }: {
  project: ProjectRow | undefined;
  unread: number;
  documentCount: number;
  contractorCount: number;
}) {
  const t = useT();

  const actions = [
    {
      to: project ? `/projects/${project.id}` : '/projects',
      icon: Upload,
      labelKey: 'dashboard.quick.evidence' as TKey,
      sub: project
        ? t('dashboard.quick.evidenceSub', { project: project.name })
        : t('dashboard.quick.evidenceNone'),
    },
    {
      to: '/notifications',
      icon: MessageSquare,
      labelKey: 'dashboard.quick.messages' as TKey,
      sub: unread > 0
        ? t('dashboard.quick.messagesSub', { count: unread })
        : t('dashboard.quick.messagesNone'),
    },
    {
      to: '/documents',
      icon: FolderArchive,
      labelKey: 'dashboard.quick.documents' as TKey,
      sub: t('dashboard.quick.documentsSub', { count: documentCount }),
    },
    {
      to: '/contractors',
      icon: HardHat,
      labelKey: 'dashboard.quick.contractors' as TKey,
      sub: t('dashboard.quick.contractorsSub', { count: contractorCount }),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {actions.map(({ to, icon: Icon, labelKey, sub }) => (
        <Link
          key={labelKey}
          to={to}
          className="group flex items-center gap-3.5 rounded-2xl border border-brand-border-grey bg-white p-4 transition-colors hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-off-white transition-colors group-hover:bg-brand-near-black dark:bg-[#252525]">
            <Icon className="size-4.5 text-brand-mid-grey transition-colors group-hover:text-white" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-brand-near-black dark:text-white">{t(labelKey)}</span>
            <span className="block truncate text-xs text-brand-mid-grey">{sub}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

// ── Costing allocation donut (Materials / Labor / Fees / Permits) ──

// Shares the roll-up used by the project Overview donut. These two showed different
// numbers for the same project before — 34%/2% here against 27%/9% there.
//
// Greyscale, not a hue per slice. Colour on this platform marks status — paid,
// held, overdue — and spending it on four categories that carry no status makes
// the one signal that does mean something harder to see. The ramp runs dark to
// light in the same order as the legend, so a slice is identified by position and
// by its label, and the chart survives being printed or read by a colourblind user.
const COST_SHADES = ['#1f2937', '#4b5563', '#9ca3af', '#d1d5db'];

const COST_CATS = [
  { key: 'materials', labelKey: 'dashboard.costCats.materials.label', descKey: 'dashboard.costCats.materials.desc', shade: COST_SHADES[0], pct: BUDGET_ROLLUP_PCT.materials },
  { key: 'labor',     labelKey: 'dashboard.costCats.labor.label',     descKey: 'dashboard.costCats.labor.desc',     shade: COST_SHADES[1], pct: BUDGET_ROLLUP_PCT.labor     },
  { key: 'fees',      labelKey: 'dashboard.costCats.fees.label',      descKey: 'dashboard.costCats.fees.desc',      shade: COST_SHADES[2], pct: BUDGET_ROLLUP_PCT.fees      },
  { key: 'permits',   labelKey: 'dashboard.costCats.permits.label',   descKey: 'dashboard.costCats.permits.desc',   shade: COST_SHADES[3], pct: BUDGET_ROLLUP_PCT.permits   },
] satisfies { key: string; labelKey: TKey; descKey: TKey; shade: string; pct: number }[];

function CostingDonut({ project }: { project: ProjectRow }) {
  const t = useT();
  // projectBudget resolves budget_usd ?? engine estimate — so a project the owner
  // has not yet confirmed a budget for still shows its allocation instead of "no
  // budget", and the amounts here can never disagree with the total beside them.
  const { total } = projectBudget(project);
  const biggest = COST_CATS[0];

  const r = 68, cx = 100, cy = 100, circ = 2 * Math.PI * r, GAP = 3;
  let acc = 0;

  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <h3 className="mb-0.5 text-sm font-semibold text-brand-near-black dark:text-white">{t('dashboard.costingAllocation')}</h3>
      <p className="mb-4 text-xs text-brand-mid-grey">
        {total > 0
          ? <>{t('dashboard.biggestCostPre')} <strong className="text-brand-near-black dark:text-white">{t(biggest.labelKey)}</strong> {biggest.pct}% {t('dashboard.biggestCostPost')}</>
          : t('dashboard.costing.byCategory')}
      </p>

      <div className="mb-4 flex justify-center">
        <svg viewBox="0 0 200 200" className="h-40 w-40" role="img"
          aria-label={COST_CATS.map(c => `${t(c.labelKey)} ${c.pct}%`).join(', ')}>
          <g transform={`rotate(-90, ${cx}, ${cy})`}>
            {COST_CATS.map((cat) => {
              const fraction = cat.pct / 100;
              const vis = fraction * circ - GAP;
              const off = -acc;
              acc += fraction * circ;
              return (
                <circle key={cat.key}
                  cx={cx} cy={cy} r={r} fill="none"
                  stroke={cat.shade} strokeWidth="26"
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
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: cat.shade }} />
            <div className="min-w-0 flex-1">
              <span className="text-xs font-medium text-brand-near-black dark:text-white">{t(cat.labelKey)}</span>
              <span className="ml-1 text-[10px] text-brand-mid-grey">· {t(cat.descKey)}</span>
            </div>
            <span className="text-[10px] font-semibold tabular-nums text-brand-mid-grey">{cat.pct}%</span>
          </div>
        ))}
      </div>

      {total > 0 && (
        <p className="mt-4 border-t border-brand-border-grey pt-3 text-[10px] text-brand-mid-grey dark:border-[#2c2c2c]">
          {t('dashboard.costing.totalEstimated', { amount: formatMoney(total) })}
        </p>
      )}
    </div>
  );
}

// ── Other projects row (Design B) ──────────────────────────
// Deliberately quieter than the hero: one line, no progress bar, no imagery. These
// are builds you are not working on right now, and the page's job is to keep the
// active one unambiguous.

function OtherProjectRow({ project }: { project: ProjectRow }) {
  const t = useT();
  const { buildingType } = useDomainLabels();
  const { total } = projectBudget(project);
  const tier   = TIER_META[project.tier] ?? TIER_META.self_verify;
  const status = PROJECT_STATUS_META[project.status] ?? PROJECT_STATUS_META.active;

  return (
    <Link
      to={`/projects/${project.id}`}
      className="flex items-center gap-4 rounded-2xl border border-brand-border-grey bg-white p-4 transition-colors hover:border-brand-near-black dark:border-[#2c2c2c] dark:bg-[#1e1e1e]"
    >
      <span className={`size-2 shrink-0 rounded-full ${status.dot}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-brand-near-black dark:text-white">{project.name}</p>
        <p className="truncate text-xs text-brand-mid-grey">
          {[
            buildingType(project.building_type),
            [project.city, project.country].filter(Boolean).join(', '),
            t('dashboard.card.stages', { done: completedStages(project), total: TOTAL_STAGES }),
          ].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold tabular-nums text-brand-near-black dark:text-white">
          {total > 0 ? fmtShort(total) : '—'}
        </p>
        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${tier.color}`}>
          {tier.icon}{t(tier.labelKey)}
        </span>
      </div>
      <ChevronRight className="size-4 shrink-0 text-brand-border-grey" />
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
  const [unreadCount,      setUnreadCount]      = useState(0);
  const [documentCount,    setDocumentCount]    = useState(0);
  const [contractorCount,  setContractorCount]  = useState(0);

  const displayName = user?.user_metadata?.full_name
    ?? user?.email?.split('@')[0]
    ?? 'there';
  const nameSet    = !!user?.user_metadata?.full_name;
  const idUploaded = !!user?.user_metadata?.id_document_path;

  const atStarterLimit = projects.filter(
    p => p.tier === 'self_verify' || (p.tier as string) === 'starter'
  ).length >= STARTER_LIMIT;


  const activeProject = projects
    .filter(p => p.status === 'active')
    .sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime())[0]
    ?? projects[0];


  useEffect(() => {
    if (!user) return;
    const loader = isContractor ? fetchContractorProjects(user.id) : fetchProjects(user.id);
    loader
      .then(setProjects)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, isContractor]);

  useEffect(() => {
    if (!activeProject?.id) { setActiveStages([]); return; }
    setStagesLoading(true);
    supabase
      .from('project_stages')
      .select('id, stage_number, stage_key, name, status, budget_pct, completed_at, payment_milestone_usd, payment_status')
      .eq('project_id', activeProject.id)
      .order('stage_number')
      .then(({ data }) => {
        setActiveStages((data ?? []) as ProjectStage[]);
        setStagesLoading(false);
      });
  }, [activeProject?.id]);

  // Counts behind the quick-action subtitles. Head-only queries — we want the
  // number, never the rows. Failures leave the count at 0 and the tile still
  // works as a link, so a slow table never blocks the dashboard rendering.
  useEffect(() => {
    if (!user || projects.length === 0) return;
    const ids = projects.map(p => p.id);

    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('read_at', null)          // unread is a null timestamp, not a boolean
      .then(({ count }) => setUnreadCount(count ?? 0));

    supabase
      .from('project_documents')
      .select('id', { count: 'exact', head: true })
      .in('project_id', ids)
      .then(({ count }) => setDocumentCount(count ?? 0));

    supabase
      .from('contractor_invites')
      .select('id', { count: 'exact', head: true })
      .in('project_id', ids)
      .eq('status', 'accepted')
      .then(({ count }) => setContractorCount(count ?? 0));
  }, [user, projects]);

  const otherProjects = projects.filter(p => p.id !== activeProject?.id);

  return (
    // Design B: focus-forward. One active build owns the top of the page; everything
    // else is secondary. The dense stat grid Design A used lives on /projects now.
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 pb-24 sm:px-6 md:pb-8">

      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-brand-mid-grey">{t(greetingKey())}</p>
          <h1 className="mt-1 text-2xl font-bold text-brand-near-black dark:text-white">{displayName}</h1>
        </div>
        {!isContractor && !atStarterLimit && (
          <Link to="/projects/new"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-brand-near-black px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-black">
            <Plus className="size-4" /> {t('dashboard.newProject')}
          </Link>
        )}
      </div>

      {!loading && !isContractor && (
        <ProfileCompletion nameSet={nameSet} idUploaded={idUploaded} hasProject={projects.length > 0} />
      )}

      {loading ? (
        <div className="h-72 animate-pulse rounded-2xl bg-brand-light-grey dark:bg-[#1e1e1e]" />
      ) : activeProject ? (
        <>
          <ActiveProjectHero
            project={activeProject}
            stages={activeStages}
            stagesLoading={stagesLoading}
          />

          <QuickActions
            project={activeProject}
            unread={unreadCount}
            documentCount={documentCount}
            contractorCount={contractorCount}
          />

          <CostingDonut project={activeProject} />
        </>
      ) : isContractor ? (
        <div className="rounded-2xl border border-dashed border-brand-border-grey p-6 text-sm text-brand-mid-grey">
          {t('dashboard.empty.contractor')}
        </div>
      ) : (
        <EmptyBuilds />
      )}

      {otherProjects.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-wide text-brand-mid-grey">
              {t('dashboard.otherProjects')}
            </h2>
            <Link to="/projects" className="text-xs font-medium text-brand-mid-grey transition-colors hover:text-brand-near-black">
              {t('common.viewAll')} →
            </Link>
          </div>
          <div className="space-y-2.5">
            {otherProjects.slice(0, 3).map((p, i) => (
              <motion.div key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}>
                <OtherProjectRow project={p} />
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {!loading && !isContractor && projects.length > 0 && !atStarterLimit && (
        <Link
          to="/projects/new"
          className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-border-grey py-4 text-sm font-semibold text-brand-mid-grey transition-colors hover:border-brand-near-black hover:text-brand-near-black"
        >
          <Plus className="size-4" /> {t('dashboard.newProject')}
        </Link>
      )}
    </div>
  );
}
