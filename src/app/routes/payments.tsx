import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { MapPin, Wallet, TrendingUp, CheckCircle2 } from 'lucide-react';
import { useAuth }               from '@/contexts/AuthContext';
import { fetchProjects }         from '@/lib/supabase/projects';
import { fetchContractorProjects } from '@/lib/supabase/invites';
import { formatUSDFull }         from '@/lib/budget';
import { findCountry }           from '@/lib/countries';
import type { ProjectRow }       from '@/types/project';

const TOTAL_STAGES = 10;

function completedStages(p: ProjectRow) {
  return p.status === 'completed' ? TOTAL_STAGES : Math.max(0, p.current_stage - 1);
}

function StatCard({ label, value, sub, icon: Icon, accent = false }: {
  label: string; value: string; sub?: string;
  icon: React.ComponentType<{ className?: string }>; accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-5 flex flex-col gap-3 ${accent ? 'bg-brand-near-black border-brand-near-black' : 'bg-white border-brand-border-grey'}`}>
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

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white p-5 flex flex-col gap-3 animate-pulse">
      <div className="h-3 w-20 rounded bg-brand-light-grey" />
      <div className="h-8 w-32 rounded bg-brand-light-grey" />
      <div className="h-2 w-full rounded-full bg-brand-light-grey" />
    </div>
  );
}

export default function PaymentsPage() {
  const { user } = useAuth();
  const isContractor = user?.user_metadata?.role === 'contractor';

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!user) return;
    const loader = isContractor ? fetchContractorProjects(user.id) : fetchProjects(user.id);
    loader.then(setProjects).catch(() => {}).finally(() => setLoading(false));
  }, [user, isContractor]);

  const totalBudget = projects.reduce((s, p) => s + (p.budget_usd ?? 0), 0);
  const estSpent    = projects.reduce((s, p) => s + (p.budget_usd ?? 0) * (completedStages(p) / TOTAL_STAGES), 0);
  const remaining   = Math.max(totalBudget - estSpent, 0);
  const maxBudget   = Math.max(...projects.map(p => p.budget_usd ?? 0), 1);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 space-y-6">

      <div>
        <h2 className="text-lg font-bold text-brand-near-black">Finances</h2>
        <p className="text-xs text-brand-mid-grey mt-0.5">Budget overview across all your builds</p>
      </div>

      {/* Info banner */}
      <div className="rounded-xl bg-brand-off-white border border-brand-border-grey px-4 py-3 text-xs text-brand-mid-grey leading-relaxed">
        💡 <span className="font-medium text-brand-near-black">Estimated spend</span> is calculated based on completed stages. Actual payments via Stripe + pawaPay are coming soon.
      </div>

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label="Total Budget"   value={formatUSDFull(totalBudget)} sub="committed across all builds" icon={Wallet}       accent />
          <StatCard label="Est. Spent"     value={formatUSDFull(estSpent)}    sub="based on stage completion"   icon={TrendingUp}        />
          <StatCard label="Est. Remaining" value={formatUSDFull(remaining)}   sub="to spend on completion"      icon={CheckCircle2}      />
        </div>
      )}

      {/* Per-project breakdown */}
      {!loading && projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-brand-border-grey p-12 text-center">
          <Wallet className="size-10 text-brand-border-grey mx-auto mb-3" />
          <p className="text-sm font-semibold text-brand-near-black mb-1">No financial data yet</p>
          <p className="text-xs text-brand-mid-grey">Create your first build to start tracking your budget.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-brand-border-grey overflow-hidden">
          <div className="px-5 py-4 border-b border-brand-off-white">
            <h2 className="text-sm font-semibold text-brand-near-black">Per-build breakdown</h2>
            <p className="text-xs text-brand-mid-grey mt-0.5">Estimated spend is calculated from completed stages</p>
          </div>
          <div className="divide-y divide-brand-off-white">
            {loading
              ? [1, 2, 3].map(i => <div key={i} className="px-5 py-5 animate-pulse"><div className="h-4 w-48 rounded bg-brand-light-grey mb-3" /><div className="h-2.5 w-full rounded-full bg-brand-light-grey" /></div>)
              : projects.map(p => {
                  const spent    = (p.budget_usd ?? 0) * (completedStages(p) / TOTAL_STAGES);
                  const spentPct = p.budget_usd ? (spent / p.budget_usd) * 100 : 0;
                  const barPct   = ((p.budget_usd ?? 0) / maxBudget) * 100;
                  const country  = findCountry(p.country);
                  const loc      = [p.city, country?.name ?? p.country].filter(Boolean).join(', ');
                  return (
                    <div key={p.id} className="px-5 py-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="min-w-0">
                          <Link to={`/projects/${p.id}`} className="text-sm font-semibold text-brand-near-black hover:underline underline-offset-2">{p.name}</Link>
                          {loc && (
                            <p className="text-xs text-brand-mid-grey mt-0.5 flex items-center gap-1">
                              <MapPin className="size-3 shrink-0" />{loc}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0 ml-6">
                          <p className="text-sm font-bold text-brand-near-black tabular-nums">{p.budget_usd ? formatUSDFull(p.budget_usd) : '—'}</p>
                          <p className="text-[10px] text-brand-mid-grey">total budget</p>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[10px] text-brand-mid-grey">
                          <span>Est. spent: <span className="font-semibold text-brand-near-black">{formatUSDFull(spent)}</span></span>
                          <span className="tabular-nums">{Math.round(spentPct)}% used</span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-brand-light-grey overflow-hidden">
                          <div className="h-full rounded-full bg-brand-off-white relative" style={{ width: `${barPct}%` }}>
                            <motion.div className="absolute inset-y-0 left-0 rounded-full bg-brand-near-black"
                              initial={{ width: 0 }} animate={{ width: `${spentPct}%` }}
                              transition={{ duration: 1, ease: 'easeOut' }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
          </div>
        </div>
      )}
    </div>
  );
}
