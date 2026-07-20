import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, BadgeCheck, ShieldCheck, Briefcase,
  MapPin, Building2, ChevronRight, HardHat,
} from 'lucide-react';
import { useAuth }               from '@/contexts/AuthContext';
import { fetchProjects }         from '@/lib/supabase/projects';
import { fetchContractorProjects } from '@/lib/supabase/invites';
import { formatUSDFull }         from '@/lib/budget';
import { findCountry }           from '@/lib/countries';
import type { ProjectRow }       from '@/types/project';

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
  townhouse: 'Townhouse', semi_detached: 'Semi-Detached',
  office: 'Office', retail: 'Retail', hotel: 'Hotel',
  factory: 'Factory', warehouse_commercial: 'Warehouse',
  warehouse_industrial: 'Warehouse', industrial_complex: 'Industrial Complex',
  distribution_centre: 'Distribution Centre',
  mixed_residential_commercial: 'Res + Commercial',
  live_work: 'Live / Work', mixed_retail_residential: 'Retail + Residential',
  transit_oriented: 'Transit-Oriented',
};

const STATUS_META = {
  active:    { label: 'Active',   dot: 'bg-green-500',         badge: 'bg-green-50 text-green-700 border border-green-200'                    },
  on_hold:   { label: 'On Hold',  dot: 'bg-amber-500',         badge: 'bg-amber-50 text-amber-700 border border-amber-200'                    },
  completed: { label: 'Complete', dot: 'bg-brand-mid-grey',    badge: 'bg-brand-off-white text-brand-mid-grey border border-brand-border-grey' },
  archived:  { label: 'Archived', dot: 'bg-brand-border-grey', badge: 'bg-brand-off-white text-brand-mid-grey border border-brand-border-grey' },
};

function completedStages(p: ProjectRow) {
  return p.status === 'completed' ? TOTAL_STAGES : Math.max(0, p.current_stage - 1);
}

function HorizBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-brand-light-grey overflow-hidden">
      <motion.div className="h-full rounded-full bg-brand-near-black"
        initial={{ width: 0 }} animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }} />
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white p-5 flex flex-col gap-3 animate-pulse">
      <div className="flex justify-between"><div className="h-3 w-14 rounded bg-brand-light-grey" /><div className="h-5 w-16 rounded-full bg-brand-light-grey" /></div>
      <div className="h-5 w-2/3 rounded bg-brand-light-grey" />
      <div className="h-3 w-1/2 rounded bg-brand-light-grey" />
      <div className="h-2 w-full rounded-full bg-brand-light-grey mt-1" />
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectRow }) {
  const tier   = TIER_META[project.tier] ?? TIER_META.self_verify;
  const status = STATUS_META[project.status as keyof typeof STATUS_META] ?? STATUS_META.active;
  const country = findCountry(project.country);
  const done   = completedStages(project);
  const pct    = Math.round((done / TOTAL_STAGES) * 100);
  const loc    = [project.city, country?.name ?? project.country].filter(Boolean).join(', ');

  return (
    <Link to={`/projects/${project.id}`}
      className="group block rounded-2xl border border-brand-border-grey bg-white p-5 hover:border-brand-near-black hover:shadow-sm transition-all duration-200">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${tier.color}`}>{tier.icon} {tier.label}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${status.badge}`}>
          <span className={`size-1.5 rounded-full ${status.dot}`} />{status.label}
        </span>
      </div>
      <h3 className="text-base font-bold text-brand-near-black leading-snug truncate mb-1">{project.name}</h3>
      <div className="flex items-center gap-2 text-xs text-brand-mid-grey mb-4 flex-wrap">
        <span className="flex items-center gap-1"><Building2 className="size-3 shrink-0" />{BT_LABELS[project.building_type] ?? project.building_type}</span>
        {loc && <><span className="text-brand-border-grey">·</span><span className="flex items-center gap-1"><MapPin className="size-3 shrink-0" />{loc}</span></>}
      </div>
      <div className="mb-4">
        <div className="flex items-center justify-between text-[10px] text-brand-mid-grey mb-1.5">
          <span>Stage {done} of {TOTAL_STAGES}</span>
          <span className="font-semibold text-brand-near-black">{pct}%</span>
        </div>
        <HorizBar pct={pct} />
      </div>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] text-brand-mid-grey mb-0.5">Est. budget</p>
          <p className="text-sm font-bold text-brand-near-black tabular-nums">{project.budget_usd ? formatUSDFull(project.budget_usd) : '—'}</p>
        </div>
        <span className="flex items-center gap-1 text-xs font-semibold text-brand-mid-grey group-hover:text-brand-near-black transition-colors">
          Open <ChevronRight className="size-3.5 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </div>
    </Link>
  );
}

const FILTERS = [
  { id: 'all', label: 'All' }, { id: 'active', label: 'Active' },
  { id: 'on_hold', label: 'On Hold' }, { id: 'completed', label: 'Complete' },
];

export default function ProjectsIndex() {
  const { user } = useAuth();
  const isContractor = user?.user_metadata?.role === 'contractor';

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState('all');

  const starterCount   = projects.filter(p => p.tier === 'self_verify' || (p.tier as string) === 'starter').length;
  const atStarterLimit = starterCount >= STARTER_LIMIT;

  const filtered = filter === 'all' ? projects : projects.filter(p => p.status === filter);

  useEffect(() => {
    if (!user) return;
    const loader = isContractor ? fetchContractorProjects(user.id) : fetchProjects(user.id);
    loader.then(setProjects).catch(() => {}).finally(() => setLoading(false));
  }, [user, isContractor]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 space-y-5">

      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-brand-near-black">My Builds</h2>
          {!loading && <p className="text-xs text-brand-mid-grey mt-0.5">{projects.length} build{projects.length !== 1 ? 's' : ''} in total</p>}
        </div>
        {!isContractor && !atStarterLimit && (
          <Link to="/projects/new"
            className="flex items-center gap-2 rounded-xl bg-brand-near-black text-white text-sm font-semibold px-4 py-2 hover:bg-black transition-colors">
            <Plus className="size-4" /> New Build
          </Link>
        )}
      </div>

      {/* Starter limit banner */}
      {!loading && !isContractor && starterCount > 0 && (
        <div className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm ${
          atStarterLimit
            ? 'bg-amber-50 border border-amber-200 text-amber-800'
            : 'bg-brand-off-white border border-brand-border-grey text-brand-mid-grey'
        }`}>
          <span><span className="font-medium">{starterCount} / {STARTER_LIMIT}</span> Self Verify projects used{atStarterLimit && ' — limit reached'}</span>
          {atStarterLimit && <span className="text-xs font-semibold text-amber-700">Upgrade to Jalla Verify</span>}
        </div>
      )}

      {/* Filters */}
      {!loading && projects.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map(f => (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f.id ? 'bg-brand-near-black text-white' : 'bg-white border border-brand-border-grey text-brand-mid-grey hover:text-brand-near-black hover:border-brand-near-black'
              }`}>
              {f.label}
              {f.id !== 'all' && <span className="ml-1.5 opacity-60">{projects.filter(p => p.status === f.id).length}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      ) : filtered.length === 0 ? (
        isContractor
          ? <div className="rounded-2xl border border-dashed border-brand-border-grey p-6 text-sm text-brand-mid-grey">No builds in this category yet.</div>
          : (
            <Link to="/projects/new"
              className="flex flex-col items-center justify-center gap-5 rounded-2xl border-2 border-dashed border-brand-border-grey p-12 hover:border-brand-near-black hover:bg-white transition-all group text-center">
              <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                className="flex size-16 items-center justify-center rounded-full bg-brand-off-white group-hover:bg-brand-near-black transition-colors">
                <HardHat className="size-8 text-brand-mid-grey group-hover:text-white transition-colors" />
              </motion.div>
              <div>
                <p className="text-base font-semibold text-brand-near-black mb-1">Start your first build</p>
                <p className="text-sm text-brand-mid-grey max-w-xs mx-auto leading-relaxed">Track every stage, manage your budget, and stay connected with your contractor.</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black text-white text-sm font-semibold px-6 py-3">
                <Plus className="size-4" /> Create a build
              </span>
            </Link>
          )
      ) : (
        <AnimatePresence>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((p, i) => (
              <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                <ProjectCard project={p} />
              </motion.div>
            ))}
            {!isContractor && !atStarterLimit && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: filtered.length * 0.06 }}>
                <Link to="/projects/new"
                  className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-brand-border-grey bg-white/50 p-8 min-h-48 hover:border-brand-near-black hover:bg-white transition-all group h-full">
                  <span className="flex size-10 items-center justify-center rounded-full bg-brand-light-grey group-hover:bg-brand-near-black transition-colors">
                    <Plus className="size-4 text-brand-near-black group-hover:text-white transition-colors" />
                  </span>
                  <span className="text-sm font-medium text-brand-mid-grey group-hover:text-brand-near-black transition-colors">New Build</span>
                </Link>
              </motion.div>
            )}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}
