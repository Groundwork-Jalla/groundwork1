import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Wallet, TrendingUp, CheckCircle2, Download, X, Plus } from 'lucide-react';
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
    <div className={`rounded-2xl border p-5 flex flex-col gap-3 ${accent ? 'bg-brand-near-black border-brand-near-black dark:bg-white dark:border-white' : 'bg-white dark:bg-brand-dark-grey border-brand-border-grey dark:border-[#2c2c2c]'}`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${accent ? 'text-white/55 dark:text-brand-near-black/55' : 'text-brand-mid-grey dark:text-brand-mid-grey'}`}>{label}</span>
        <span className={`flex size-8 items-center justify-center rounded-lg ${accent ? 'bg-white/10 dark:bg-brand-near-black/10' : 'bg-brand-off-white dark:bg-[#1c1c1c]'}`}>
          <Icon className={`size-4 ${accent ? 'text-white/70 dark:text-brand-near-black/70' : 'text-brand-mid-grey dark:text-brand-mid-grey'}`} />
        </span>
      </div>
      <div>
        <p className={`text-2xl font-bold tabular-nums ${accent ? 'text-white dark:text-brand-near-black' : 'text-brand-near-black dark:text-white'}`}>{value}</p>
        {sub && <p className={`text-xs mt-0.5 ${accent ? 'text-white/45 dark:text-brand-near-black/45' : 'text-brand-mid-grey dark:text-brand-mid-grey'}`}>{sub}</p>}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-brand-dark-grey p-5 flex flex-col gap-3 animate-pulse">
      <div className="h-3 w-20 rounded bg-brand-light-grey dark:bg-[#2c2c2c]" />
      <div className="h-8 w-32 rounded bg-brand-light-grey dark:bg-[#2c2c2c]" />
      <div className="h-2 w-full rounded-full bg-brand-light-grey dark:bg-[#2c2c2c]" />
    </div>
  );
}

// ── Record Payment Modal ──────────────────────────────────────────────────────

interface RecordedPayment {
  projectId: string;
  amount: string;
  currency: string;
  method: string;
  note: string;
  recordedAt: number;
}

interface RecordPaymentModalProps {
  project: ProjectRow;
  onClose: () => void;
  onSuccess: () => void;
}

function RecordPaymentModal({ project, onClose, onSuccess }: RecordPaymentModalProps) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [method, setMethod] = useState('Bank Transfer');
  const [note, setNote] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payment: RecordedPayment = {
      projectId: project.id,
      amount,
      currency,
      method,
      note,
      recordedAt: Date.now(),
    };
    // Store in local state (no payments table yet)
    try {
      const existing = JSON.parse(localStorage.getItem('gw_local_payments') ?? '[]') as RecordedPayment[];
      localStorage.setItem('gw_local_payments', JSON.stringify([...existing, payment]));
    } catch { /* ignore */ }
    onSuccess();
    onClose();
  }

  const inputClass =
    'flex h-10 w-full rounded-md border border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#111] pl-3 pr-3 py-2 text-sm text-brand-near-black dark:text-white outline-none transition-colors placeholder:text-brand-mid-grey focus-visible:border-brand-near-black dark:focus-visible:border-white';

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-black/40 dark:bg-black/60 z-50 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="bg-white dark:bg-brand-rich-black rounded-2xl p-6 w-full max-w-sm mx-4"
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-brand-near-black dark:text-white">Record Payment</h3>
            <button
              type="button"
              onClick={onClose}
              className="flex size-7 items-center justify-center rounded-full hover:bg-brand-light-grey dark:hover:bg-[#2c2c2c] transition-colors"
              aria-label="Close"
            >
              <X className="size-4 text-brand-mid-grey dark:text-brand-mid-grey" />
            </button>
          </div>

          {/* Project name */}
          <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mb-4">
            For: <span className="font-medium text-brand-near-black dark:text-white">{project.name}</span>
          </p>

          {/* Info note */}
          <div className="rounded-lg bg-brand-off-white dark:bg-[#111] border border-brand-border-grey dark:border-[#2c2c2c] px-3 py-2.5 text-[11px] text-brand-mid-grey dark:text-brand-mid-grey leading-relaxed mb-4">
            Coming soon — this records locally for your tracking. Full payment processing coming soon.
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {/* Amount */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-brand-mid-grey dark:text-brand-mid-grey uppercase tracking-wide">Amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                required
                className={inputClass}
              />
            </div>

            {/* Currency */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-brand-mid-grey dark:text-brand-mid-grey uppercase tracking-wide">Currency</label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className={inputClass}
              >
                <option value="USD">USD — US Dollar</option>
                <option value="XAF">XAF — CFA Franc</option>
                <option value="NGN">NGN — Nigerian Naira</option>
                <option value="GHS">GHS — Ghanaian Cedi</option>
                <option value="KES">KES — Kenyan Shilling</option>
              </select>
            </div>

            {/* Method */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-brand-mid-grey dark:text-brand-mid-grey uppercase tracking-wide">Method</label>
              <select
                value={method}
                onChange={e => setMethod(e.target.value)}
                className={inputClass}
              >
                <option>Bank Transfer</option>
                <option>Mobile Money</option>
                <option>Cash</option>
                <option>Cheque</option>
              </select>
            </div>

            {/* Note */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-brand-mid-grey dark:text-brand-mid-grey uppercase tracking-wide">Note (optional)</label>
              <input
                type="text"
                placeholder="e.g. Stage 3 milestone payment"
                value={note}
                onChange={e => setNote(e.target.value)}
                className={inputClass}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 h-10 rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] text-sm font-medium text-brand-mid-grey dark:text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white hover:border-brand-near-black dark:hover:border-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 h-10 rounded-xl bg-brand-near-black dark:bg-white text-sm font-semibold text-white dark:text-brand-near-black hover:opacity-90 transition-opacity"
              >
                Record
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <motion.div
      className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black text-sm font-medium rounded-xl shadow-lg"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.2 }}
    >
      {message}
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const { user } = useAuth();
  const isContractor = user?.user_metadata?.role === 'contractor';

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading,  setLoading]  = useState(true);

  // Modal + toast state
  const [recordingProject, setRecordingProject] = useState<ProjectRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dismissToast = useRef<(() => void) | null>(null);
  dismissToast.current = () => setToast(null);

  useEffect(() => {
    if (!user) return;
    const loader = isContractor ? fetchContractorProjects(user.id) : fetchProjects(user.id);
    loader.then(setProjects).catch(() => {}).finally(() => setLoading(false));
  }, [user, isContractor]);

  const totalBudget = projects.reduce((s, p) => s + (p.budget_usd ?? 0), 0);
  const estSpent    = projects.reduce((s, p) => s + (p.budget_usd ?? 0) * (completedStages(p) / TOTAL_STAGES), 0);
  const remaining   = Math.max(totalBudget - estSpent, 0);
  const maxBudget   = Math.max(...projects.map(p => p.budget_usd ?? 0), 1);

  // ── CSV Export ────────────────────────────────────────────────────────────
  function handleExportCSV() {
    const headers = 'Project,Location,Total Budget (USD),Est. Spent (USD),Completion %';
    const rows = projects.map(p => {
      const spent    = (p.budget_usd ?? 0) * (completedStages(p) / TOTAL_STAGES);
      const spentPct = p.budget_usd ? (spent / p.budget_usd) * 100 : 0;
      const country  = findCountry(p.country);
      const loc      = [p.city, country?.name ?? p.country].filter(Boolean).join('; ');
      // Escape commas in fields
      const escape = (v: string) => v.includes(',') ? `"${v}"` : v;
      return [
        escape(p.name ?? ''),
        escape(loc),
        p.budget_usd ?? 0,
        spent.toFixed(0),
        Math.round(spentPct),
      ].join(',');
    });
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'groundwork-finances.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-8 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-brand-near-black dark:text-white">Finances</h2>
          <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mt-0.5">Budget overview across all your builds</p>
        </div>
        <button
          type="button"
          onClick={handleExportCSV}
          disabled={loading || projects.length === 0}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-mid-grey dark:text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white border border-brand-border-grey dark:border-[#2c2c2c] rounded-lg px-3 py-1.5 bg-white dark:bg-brand-dark-grey transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <Download className="size-3.5" />
          Export CSV
        </button>
      </div>

      {/* Info banner */}
      <div className="rounded-xl bg-brand-off-white dark:bg-[#1c1c1c] border border-brand-border-grey dark:border-[#2c2c2c] px-4 py-3 text-xs text-brand-mid-grey dark:text-brand-mid-grey leading-relaxed">
        💡 <span className="font-medium text-brand-near-black dark:text-white">Estimated spend</span> is calculated based on completed stages. Actual payments via Stripe + pawaPay are coming soon.
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
        <div className="rounded-2xl border border-dashed border-brand-border-grey dark:border-[#2c2c2c] p-12 text-center">
          <Wallet className="size-10 text-brand-border-grey dark:text-[#2c2c2c] mx-auto mb-3" />
          <p className="text-sm font-semibold text-brand-near-black dark:text-white mb-1">No financial data yet</p>
          <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey">Create your first build to start tracking your budget.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-brand-dark-grey rounded-2xl border border-brand-border-grey dark:border-[#2c2c2c] overflow-hidden">
          <div className="px-5 py-4 border-b border-brand-off-white dark:border-[#2c2c2c]">
            <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">Per-build breakdown</h2>
            <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mt-0.5">Estimated spend is calculated from completed stages</p>
          </div>
          <div className="divide-y divide-brand-off-white dark:divide-[#2c2c2c]">
            {loading
              ? [1, 2, 3].map(i => (
                  <div key={i} className="px-5 py-5 animate-pulse">
                    <div className="h-4 w-48 rounded bg-brand-light-grey dark:bg-[#2c2c2c] mb-3" />
                    <div className="h-2.5 w-full rounded-full bg-brand-light-grey dark:bg-[#2c2c2c]" />
                  </div>
                ))
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
                          <Link to={`/projects/${p.id}`} className="text-sm font-semibold text-brand-near-black dark:text-white hover:underline underline-offset-2">{p.name}</Link>
                          {loc && (
                            <p className="text-xs text-brand-mid-grey dark:text-brand-mid-grey mt-0.5 flex items-center gap-1">
                              <MapPin className="size-3 shrink-0" />{loc}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-6">
                          <div className="text-right">
                            <p className="text-sm font-bold text-brand-near-black dark:text-white tabular-nums">{p.budget_usd ? formatUSDFull(p.budget_usd) : '—'}</p>
                            <p className="text-[10px] text-brand-mid-grey dark:text-brand-mid-grey">total budget</p>
                          </div>
                          {/* Record Payment button */}
                          <button
                            type="button"
                            onClick={() => setRecordingProject(p)}
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-brand-mid-grey dark:text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white border border-brand-border-grey dark:border-[#2c2c2c] rounded-md px-2 py-1 bg-brand-off-white dark:bg-[#1c1c1c] transition-colors"
                          >
                            <Plus className="size-2.5" />
                            Record
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[10px] text-brand-mid-grey dark:text-brand-mid-grey">
                          <span>Est. spent: <span className="font-semibold text-brand-near-black dark:text-white">{formatUSDFull(spent)}</span></span>
                          <span className="tabular-nums">{Math.round(spentPct)}% used</span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-brand-light-grey dark:bg-[#2c2c2c] overflow-hidden">
                          <div className="h-full rounded-full bg-brand-off-white dark:bg-[#1c1c1c] relative" style={{ width: `${barPct}%` }}>
                            <motion.div className="absolute inset-y-0 left-0 rounded-full bg-brand-near-black dark:bg-white"
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

      {/* Record Payment Modal */}
      <AnimatePresence>
        {recordingProject && (
          <RecordPaymentModal
            project={recordingProject}
            onClose={() => setRecordingProject(null)}
            onSuccess={() => setToast('Payment recorded')}
          />
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <Toast message={toast} onDismiss={() => setToast(null)} />
        )}
      </AnimatePresence>

    </div>
  );
}
