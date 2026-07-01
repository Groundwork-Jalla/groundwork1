import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, BadgeCheck, ShieldCheck, Briefcase,
  MapPin, Building2, ChevronRight, User,
} from 'lucide-react';
import { useAuth }           from '@/contexts/AuthContext';
import { fetchProjects }     from '@/lib/supabase/projects';
import { formatUSDFull }     from '@/lib/budget';
import { findCountry }       from '@/lib/countries';
import type { ProjectRow, ProjectTier } from '@/types/project';

// ── Constants ─────────────────────────────────────────────

const STARTER_LIMIT = 3;

const TIER_META: Record<ProjectTier, { label: string; icon: React.ReactNode; color: string }> = {
  starter:    { label: 'Starter',    icon: <BadgeCheck className="size-3" />,  color: 'text-brand-mid-grey'  },
  pro:        { label: 'Pro',        icon: <ShieldCheck className="size-3" />, color: 'text-blue-600'        },
  enterprise: { label: 'Enterprise', icon: <Briefcase className="size-3" />,   color: 'text-purple-600'      },
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
  mixed_residential_commercial:'Res + Commercial',
  live_work:                   'Live / Work',
  mixed_retail_residential:    'Retail + Residential',
  transit_oriented:            'Transit-Oriented',
};

const STATUS_META = {
  active:    { label: 'Active',    className: 'bg-green-50 text-green-700 border border-green-200' },
  on_hold:   { label: 'On Hold',   className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  completed: { label: 'Complete',  className: 'bg-brand-off-white text-brand-mid-grey border border-brand-border-grey' },
  archived:  { label: 'Archived',  className: 'bg-brand-off-white text-brand-mid-grey border border-brand-border-grey' },
};

const TOTAL_STAGES = 10;

// ── Helpers ───────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

function completedStages(p: ProjectRow): number {
  return p.status === 'completed' ? TOTAL_STAGES : Math.max(0, p.current_stage - 1);
}

// ── Skeleton card ─────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-brand-border-grey p-5 flex flex-col gap-3 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-3 w-14 rounded bg-brand-light-grey" />
        <div className="h-5 w-16 rounded-full bg-brand-light-grey" />
      </div>
      <div className="h-5 w-2/3 rounded bg-brand-light-grey" />
      <div className="h-3 w-1/2 rounded bg-brand-light-grey" />
      <div className="mt-1 h-1.5 w-full rounded-full bg-brand-light-grey" />
      <div className="flex items-center justify-between mt-1">
        <div className="h-3 w-20 rounded bg-brand-light-grey" />
        <div className="h-3 w-12 rounded bg-brand-light-grey" />
      </div>
    </div>
  );
}

// ── Project card ──────────────────────────────────────────

function ProjectCard({ project }: { project: ProjectRow }) {
  const tier       = TIER_META[project.tier];
  const status     = STATUS_META[project.status];
  const country    = findCountry(project.country);
  const completed  = completedStages(project);
  const progressPct = Math.round((completed / TOTAL_STAGES) * 100);

  const locationParts = [project.city, country?.name ?? project.country].filter(Boolean);

  return (
    <Link
      to={`/projects/${project.id}`}
      className="group block rounded-2xl border border-brand-border-grey bg-white p-5 hover:border-brand-near-black hover:shadow-sm transition-all duration-200"
    >
      {/* Top row: tier + status */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${tier.color}`}>
          {tier.icon}
          {tier.label}
        </span>
        <span className={`inline-flex items-center rounded-full px-2 py-px text-[10px] font-medium ${status.className}`}>
          {status.label}
        </span>
      </div>

      {/* Project name */}
      <h3 className="text-base font-bold text-brand-near-black leading-snug truncate mb-1">
        {project.name}
      </h3>

      {/* Meta: building type + location */}
      <div className="flex items-center gap-2 text-xs text-brand-mid-grey mb-4 flex-wrap">
        <span className="flex items-center gap-1">
          <Building2 className="size-3 shrink-0" />
          {BT_LABELS[project.building_type] ?? project.building_type}
        </span>
        {locationParts.length > 0 && (
          <>
            <span className="text-brand-border-grey">·</span>
            <span className="flex items-center gap-1">
              <MapPin className="size-3 shrink-0" />
              {locationParts.join(', ')}
            </span>
          </>
        )}
      </div>

      {/* Progress bar */}
      <div className="mb-1">
        <div className="flex items-center justify-between text-[10px] text-brand-mid-grey mb-1.5">
          <span>Stage progress</span>
          <span className="tabular-nums">{completed} / {TOTAL_STAGES}</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-brand-light-grey overflow-hidden">
          <div
            className="h-full rounded-full bg-brand-near-black transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Bottom: budget + CTA */}
      <div className="flex items-center justify-between mt-4">
        <div>
          <p className="text-[10px] text-brand-mid-grey mb-0.5">Est. budget</p>
          <p className="text-sm font-bold text-brand-near-black tabular-nums">
            {project.budget_usd ? formatUSDFull(project.budget_usd) : '—'}
          </p>
        </div>
        <span className="flex items-center gap-1 text-xs font-medium text-brand-mid-grey group-hover:text-brand-near-black transition-colors">
          View
          <ChevronRight className="size-3.5 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </div>
    </Link>
  );
}

// ── Empty state ───────────────────────────────────────────

function EmptyProjects() {
  return (
    <Link
      to="/projects/new"
      className="flex items-center gap-4 rounded-2xl border border-dashed border-brand-border-grey p-6 hover:border-brand-near-black hover:bg-brand-off-white transition-colors group"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-light-grey group-hover:bg-brand-near-black transition-colors">
        <Plus className="size-5 text-brand-near-black group-hover:text-white transition-colors" />
      </span>
      <span>
        <span className="block text-sm font-semibold text-brand-near-black">
          No projects yet
        </span>
        <span className="block text-sm text-brand-mid-grey mt-0.5">
          Create your first project to get started →
        </span>
      </span>
    </Link>
  );
}

// ── Starter limit banner ──────────────────────────────────

function StarterLimitBanner({ count }: { count: number }) {
  const atLimit = count >= STARTER_LIMIT;
  return (
    <div className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm ${
      atLimit
        ? 'bg-amber-50 border border-amber-200 text-amber-800'
        : 'bg-brand-off-white border border-brand-border-grey text-brand-mid-grey'
    }`}>
      <span>
        <span className="font-medium">{count} / {STARTER_LIMIT}</span> Starter projects used
        {atLimit && ' — limit reached'}
      </span>
      {atLimit && (
        <span className="text-xs font-semibold text-amber-700 underline underline-offset-2 cursor-pointer">
          Upgrade to Pro
        </span>
      )}
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────

function DashboardNav({ displayName, onLogout }: { displayName: string; onLogout: () => void }) {
  const initials = getInitials(displayName);

  return (
    <nav className="border-b border-brand-border-grey px-5 sm:px-8 py-3 flex items-center justify-between gap-4">
      <span className="font-sans text-lg font-bold text-brand-near-black tracking-tight">
        Groundwork
      </span>

      <div className="flex items-center gap-3">
        <Link
          to="/profile"
          className="flex items-center gap-2 text-sm text-brand-mid-grey hover:text-brand-near-black transition-colors"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-light-grey text-[11px] font-bold text-brand-near-black">
            {initials || <User className="size-3.5" />}
          </span>
          <span className="hidden sm:inline truncate max-w-35">{displayName}</span>
        </Link>
        <button
          type="button"
          onClick={onLogout}
          className="text-xs text-brand-mid-grey hover:text-brand-near-black transition-colors border border-brand-border-grey rounded-lg px-3 py-1.5"
        >
          Log out
        </button>
      </div>
    </nav>
  );
}

// ── Main ──────────────────────────────────────────────────

export default function Dashboard() {
  const navigate       = useNavigate();
  const { user, signOut } = useAuth();

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading,  setLoading]  = useState(true);

  const displayName = user?.user_metadata?.full_name
    ?? user?.email?.split('@')[0]
    ?? 'You';

  const starterProjects = projects.filter(p => p.tier === 'starter');
  const atStarterLimit  = starterProjects.length >= STARTER_LIMIT;

  useEffect(() => {
    if (!user) return;
    fetchProjects(user.id)
      .then(setProjects)
      .catch(() => {/* RLS will return empty on error */})
      .finally(() => setLoading(false));
  }, [user]);

  async function handleLogout() {
    await signOut();
    navigate('/', { replace: true });
  }

  return (
    <div className="min-h-screen bg-white">
      <DashboardNav displayName={displayName} onLogout={handleLogout} />

      <div className="max-w-215 mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>

          {/* Header */}
          <div className="flex items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black">
                Your Projects
              </h1>
              {!loading && projects.length > 0 && (
                <p className="mt-1 text-sm text-brand-mid-grey">
                  {projects.length} project{projects.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            {/* New project button — disabled at Starter limit */}
            {atStarterLimit ? (
              <button
                type="button"
                title="Starter plan limited to 3 projects"
                className="flex items-center gap-2 rounded-xl bg-brand-light-grey text-brand-mid-grey text-sm font-semibold px-4 py-2.5 cursor-not-allowed opacity-70"
              >
                <Plus className="size-4" />
                <span className="hidden sm:inline">New Project</span>
              </button>
            ) : (
              <Link
                to="/projects/new"
                className="flex items-center gap-2 rounded-xl bg-brand-near-black text-white text-sm font-semibold px-4 py-2.5 hover:bg-black transition-colors"
              >
                <Plus className="size-4" />
                <span className="hidden sm:inline">New Project</span>
              </Link>
            )}
          </div>

          {/* Starter limit banner (only if user has Starter projects) */}
          {!loading && starterProjects.length > 0 && (
            <div className="mb-5">
              <StarterLimitBanner count={starterProjects.length} />
            </div>
          )}

          {/* Content */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : projects.length === 0 ? (
            <EmptyProjects />
          ) : (
            <AnimatePresence>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {projects.map((project, i) => (
                  <motion.div
                    key={project.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.06 }}
                  >
                    <ProjectCard project={project} />
                  </motion.div>
                ))}

                {/* New project card — always last, disabled at Starter limit */}
                {!atStarterLimit && (
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: projects.length * 0.06 }}
                  >
                    <Link
                      to="/projects/new"
                      className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-brand-border-grey p-8 min-h-45 hover:border-brand-near-black hover:bg-brand-off-white transition-colors group h-full"
                    >
                      <span className="flex size-10 items-center justify-center rounded-full bg-brand-light-grey group-hover:bg-brand-near-black transition-colors">
                        <Plus className="size-4 text-brand-near-black group-hover:text-white transition-colors" />
                      </span>
                      <span className="text-sm font-medium text-brand-mid-grey group-hover:text-brand-near-black transition-colors">
                        New Project
                      </span>
                    </Link>
                  </motion.div>
                )}
              </div>
            </AnimatePresence>
          )}

        </motion.div>
      </div>
    </div>
  );
}
