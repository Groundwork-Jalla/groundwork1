import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, Briefcase, ExternalLink, X, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { adminStartProjectTracking } from '@/lib/supabase/tracking';
import { formatUSDFull } from '@/lib/budget';
import { cn } from '@/lib/utils';

interface PendingBudget {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  country: string;
  estimate: number;
}

function ConfirmBudgetModal({ project, onClose, onConfirmed }: {
  project: PendingBudget;
  onClose: () => void;
  onConfirmed: (id: string) => void;
}) {
  const [raw, setRaw] = useState(String(Math.round(project.estimate)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finalBudget = Math.max(0, Math.round(Number(raw.replace(/[^0-9.]/g, '')) || 0));
  const diff    = finalBudget - project.estimate;
  const changed = Math.abs(diff) >= 1 && project.estimate > 0;
  const up      = diff > 0;
  const diffPct = project.estimate > 0 ? (diff / project.estimate) * 100 : 0;

  async function handleConfirm() {
    if (finalBudget <= 0) { setError('Enter a valid budget.'); return; }
    setError(null);
    setSubmitting(true);
    try {
      await adminStartProjectTracking(project.id, finalBudget, project.ownerId, project.name);
      onConfirmed(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm budget.');
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.2 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white border border-brand-border-grey overflow-hidden"
      >
        <div className="px-6 py-5 border-b border-brand-border-grey flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-brand-near-black">Confirm budget & start tracking</h2>
            <p className="text-xs text-brand-mid-grey mt-0.5">{project.name} · {project.ownerName || project.ownerEmail}</p>
          </div>
          <button type="button" onClick={onClose} className="flex size-7 items-center justify-center rounded-lg text-brand-mid-grey hover:bg-brand-off-white transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-brand-off-white px-4 py-3">
            <div>
              <p className="text-[11px] font-semibold text-brand-mid-grey uppercase tracking-wide">Wizard estimate</p>
              <p className="text-xs text-brand-mid-grey mt-0.5">Auto-calculated from build details</p>
            </div>
            <p className="text-lg font-bold tabular-nums text-brand-near-black">{project.estimate > 0 ? formatUSDFull(project.estimate) : '—'}</p>
          </div>

          <div>
            <label htmlFor="admin-budget" className="block text-sm font-semibold text-brand-near-black mb-2">Confirmed budget</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-brand-mid-grey">$</span>
              <input
                id="admin-budget"
                inputMode="numeric"
                value={raw === '0' ? '' : Number(raw.replace(/[^0-9.]/g, '') || 0).toLocaleString('en-US')}
                onChange={e => setRaw(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0"
                className="w-full rounded-xl border border-brand-border-grey bg-white pl-9 pr-4 py-3 text-lg font-bold tabular-nums text-brand-near-black focus:outline-none focus:border-brand-near-black transition-colors"
              />
            </div>
          </div>

          {changed && (
            <div className={cn(
              'flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium',
              up ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700',
            )}>
              {up ? <TrendingUp className="size-3.5 shrink-0" /> : <TrendingDown className="size-3.5 shrink-0" />}
              {up ? 'Higher than estimate by' : 'Lower than estimate by'}{' '}
              <span className="font-bold tabular-nums">{formatUSDFull(Math.abs(diff))}</span>
              <span className="tabular-nums">({up ? '+' : '−'}{Math.abs(diffPct).toFixed(1)}%)</span>
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-brand-border-grey bg-brand-off-white/50 flex items-center justify-between gap-3">
          <p className="text-[11px] text-brand-mid-grey max-w-[55%]">Activates Stage 1, sets the payment schedule, and notifies the client.</p>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || finalBudget <= 0}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-near-black text-white text-sm font-semibold px-5 py-2.5 hover:bg-black transition-colors disabled:opacity-50"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {submitting ? 'Starting…' : 'Confirm & Start'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function AdminBudgets() {
  const [items, setItems] = useState<PendingBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PendingBudget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('projects')
        .select(`id, name, user_id, country, budget_usd,
                 profiles!inner(full_name, email)`)
        .in('tier', ['jalla_management', 'enterprise'])
        .is('tracking_started_at', null)
        .order('created_at', { ascending: true });

      setItems((data ?? []).map((p: Record<string, unknown>) => {
        const profile = p.profiles as Record<string, unknown>;
        return {
          id:         p.id as string,
          name:       p.name as string,
          ownerId:    p.user_id as string,
          ownerEmail: (profile?.email as string) ?? '',
          ownerName:  (profile?.full_name as string) ?? '',
          country:    p.country as string,
          estimate:   Number(p.budget_usd ?? 0),
        };
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function remove(id: string) {
    setItems(prev => prev.filter(i => i.id !== id));
    setSelected(null);
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-brand-near-black">Budget Confirmations</h1>
        <p className="mt-1 text-sm text-brand-mid-grey">
          Jalla Management projects awaiting a confirmed budget before tracking can begin
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" /> Loading pending projects…
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <CheckCircle2 className="size-10 text-green-500" />
          <p className="text-sm font-medium text-brand-near-black">All caught up</p>
          <p className="text-xs text-brand-mid-grey">No Jalla Management projects are awaiting a budget.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 max-w-2xl">
          {items.map(p => (
            <div key={p.id} className="rounded-2xl border border-brand-border-grey bg-white p-5 flex items-center gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-off-white">
                <Briefcase className="size-5 text-brand-near-black" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-brand-near-black truncate">{p.name}</p>
                  <Link to={`/projects/${p.id}`} className="text-brand-mid-grey hover:text-brand-near-black shrink-0" title="Open project">
                    <ExternalLink className="size-3.5" />
                  </Link>
                </div>
                <p className="text-xs text-brand-mid-grey mt-0.5 truncate">
                  {p.ownerName || p.ownerEmail} · {p.country}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] font-semibold text-brand-mid-grey uppercase tracking-wide">Estimate</p>
                <p className="text-sm font-bold tabular-nums text-brand-near-black">{p.estimate > 0 ? formatUSDFull(p.estimate) : '—'}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(p)}
                className="shrink-0 rounded-xl bg-brand-near-black text-white text-xs font-semibold px-4 py-2.5 hover:bg-black transition-colors"
              >
                Set budget
              </button>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {selected && (
          <ConfirmBudgetModal project={selected} onClose={() => setSelected(null)} onConfirmed={remove} />
        )}
      </AnimatePresence>
    </div>
  );
}
