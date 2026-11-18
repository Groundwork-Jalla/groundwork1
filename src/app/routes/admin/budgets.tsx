import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, Briefcase, ExternalLink, X, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ownerLookup } from '@/lib/supabase/admin-users';
import { adminStartProjectTracking } from '@/lib/supabase/tracking';
import { decomposeBudget, formatUSDFull } from '@/lib/budget';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useDomainLabels } from '@/lib/domain-labels';
import LedgerPanel from '@/components/admin/LedgerPanel';
import { FinancialOperations } from '@/components/admin/FinancialOperations';

interface PendingBudget {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  country: string;
  estimate: number;
  /** Ground-floor footprint × floors — the design fee is priced per built m². */
  builtAreaSqm: number;
  /** Storeys. Drives the build duration, which the monthly professional fees bill by. */
  floors: number;
  /** When the project was created — how long it has been waiting for a budget. */
  createdAt: string | null;
}

function ConfirmBudgetModal({ project, onClose, onConfirmed }: {
  project: PendingBudget;
  onClose: () => void;
  onConfirmed: (id: string) => void;
}) {
  const t = useT();
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
      await adminStartProjectTracking(
        project.id,
        decomposeBudget(finalBudget, { builtAreaSqm: project.builtAreaSqm, floors: project.floors }),
        project.ownerId,
        project.name,
      );
      onConfirmed(project.id);
    } catch (err) {
      setError(errorMessage(err, 'Could not confirm budget.'));
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
            <h2 className="text-base font-bold text-brand-near-black">{t('admin.confirmBudgetCta')}</h2>
            <p className="text-xs text-brand-mid-grey mt-0.5">{project.name} · {project.ownerName || project.ownerEmail}</p>
          </div>
          <button type="button" onClick={onClose} className="flex size-7 items-center justify-center rounded-lg text-brand-mid-grey hover:bg-brand-off-white transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-brand-off-white px-4 py-3">
            <div>
              <p className="text-[11px] font-semibold text-brand-mid-grey uppercase tracking-wide">{t('admin.wizardEstimate')}</p>
              <p className="text-xs text-brand-mid-grey mt-0.5">{t('admin.wizardEstimateSub')}</p>
            </div>
            <p className="text-lg font-bold tabular-nums text-brand-near-black">{project.estimate > 0 ? formatUSDFull(project.estimate) : '—'}</p>
          </div>

          <div>
            <label htmlFor="admin-budget" className="block text-sm font-semibold text-brand-near-black mb-2">{t('admin.confirmedBudget')}</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-brand-mid-grey">$</span>
              <input
                id="admin-budget"
                inputMode="numeric"
                // Grouping stays locale-neutral here on purpose. This is an input mask,
                // not a display figure: the onChange parse strips [^0-9.], so a French
                // group separator would be fine but a French decimal comma would be
                // silently eaten and turn 42 500,50 into 4250050. A budget field that
                // quietly corrupts the number is worse than one that groups in en-US.
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
              up ? 'bg-brand-off-white text-state-held' : 'bg-brand-off-white text-state-complete',
            )}>
              {up ? <TrendingUp className="size-3.5 shrink-0" /> : <TrendingDown className="size-3.5 shrink-0" />}
              {up ? 'Higher than estimate by' : 'Lower than estimate by'}{' '}
              <span className="font-bold tabular-nums">{formatUSDFull(Math.abs(diff))}</span>
              <span className="tabular-nums">({up ? '+' : '−'}{Math.abs(diffPct).toFixed(1)}%)</span>
            </div>
          )}

          {error && <p className="text-xs text-state-alert">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-brand-border-grey bg-brand-off-white/50 flex items-center justify-between gap-3">
          <p className="text-[11px] text-brand-mid-grey max-w-[55%]">{t('admin.confirmBudgetNote')}</p>
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
  const t = useT();
  const labels = useDomainLabels();
  const [items, setItems] = useState<PendingBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PendingBudget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // See admin-users.ts: the projects -> profiles embed is not a relationship
      // PostgREST can resolve, so it 400'd and this list was always empty.
      const [{ data }, owners] = await Promise.all([
        supabase
          .from('projects')
          .select('id, name, user_id, country, budget_usd, sqm, num_floors, created_at')
          .in('tier', ['jalla_management', 'enterprise'])
          .is('tracking_started_at', null)
          .order('created_at', { ascending: true }),
        ownerLookup(),
      ]);

      setItems((data ?? []).map((p: Record<string, unknown>) => {
        const profile = owners.get(p.user_id as string);
        return {
          id:         p.id as string,
          name:       p.name as string,
          ownerId:    p.user_id as string,
          ownerEmail: profile?.email ?? '',
          ownerName:  profile?.name ?? '',
          country:    p.country as string,
          estimate:   Number(p.budget_usd ?? 0),
          builtAreaSqm: Number(p.sqm ?? 0) * Number(p.num_floors ?? 1),
          floors:       Number(p.num_floors ?? 1),
          createdAt:    (p.created_at as string | null) ?? null,
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

  // Three jobs on one page (18 Nov redesign, budgets-desktop.png): a sub-nav of anchors,
  // not tabs, so nothing is hidden — the queue that blocks a build from starting first.
  const sections = [
    { id: 'budget-confirmations', label: t('admin.budgetsPage.confirmations'), count: loading ? null : items.length },
    { id: 'financial-operations', label: t('admin.finops.title'), count: null },
    { id: 'funding-releases',     label: t('admin.ledger.title'), count: null },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-5">
        <p className="text-[13px] text-brand-mid-grey">
          <Link to="/admin/finance" className="hover:text-brand-near-black hover:underline dark:hover:text-white">{t('admin.finance.title')}</Link>
          {' · '}<span className="font-semibold text-brand-near-black dark:text-white">{t('admin.budgetsTitle')}</span>
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-brand-near-black dark:text-white sm:text-[28px]">{t('admin.budgetsTitle')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-brand-mid-grey">{t('admin.budgetsPage.subtitle')}</p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <nav aria-label={t('admin.budgetsTitle')} className="flex gap-1.5 overflow-x-auto lg:sticky lg:top-4 lg:flex-col">
          {sections.map(sec => (
            <a key={sec.id} href={`#${sec.id}`}
              className="flex shrink-0 items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-brand-mid-grey transition-colors hover:bg-white hover:text-brand-near-black dark:hover:bg-[#1e1e1e] dark:hover:text-white">
              {sec.label}
              {sec.count != null && <span className="rounded-full bg-state-held/10 px-2 py-0.5 text-[11px] tabular-nums text-state-held">{sec.count}</span>}
            </a>
          ))}
        </nav>

        <div className="min-w-0 space-y-10">
          <section id="budget-confirmations" className="scroll-mt-4">
            <div className="mb-3">
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold text-brand-near-black dark:text-white">
                {t('admin.budgetsPage.confirmations')}
                {!loading && items.length > 0 && (
                  <span className="rounded-full bg-state-held/10 px-2.5 py-0.5 text-xs font-semibold text-state-held">{t('admin.budgetsPage.waiting', { n: items.length })}</span>
                )}
              </h2>
              <p className="mt-0.5 text-sm text-brand-mid-grey">{t('admin.budgetsPage.confirmationsSub')}</p>
            </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-brand-mid-grey">
          <Loader2 className="size-4 animate-spin" /> {t('admin.loadingProjects')}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-brand-border-grey bg-white py-12 text-center dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <CheckCircle2 className="size-10 text-state-complete" />
          <p className="text-sm font-medium text-brand-near-black dark:text-white">{t('admin.allCaughtUp')}</p>
          <p className="text-xs text-brand-mid-grey">{t('admin.budgetsEmpty')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-brand-border-grey bg-white dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
          <div className="hidden grid-cols-[2.5rem_minmax(0,1.4fr)_minmax(0,1fr)_8rem_7rem_7.5rem] gap-4 border-b border-brand-border-grey bg-brand-off-white px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey md:grid dark:border-[#2c2c2c]">
            <span /><span>{t('admin.projectsTable.project')}</span><span>{t('admin.budgetsPage.homeowner')}</span>
            <span>{t('admin.budgetsPage.country')}</span><span className="text-right">{t('admin.estimate')}</span><span />
          </div>
          <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
          {items.map(p => (
            <li key={p.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 md:grid-cols-[2.5rem_minmax(0,1.4fr)_minmax(0,1fr)_8rem_7rem_7.5rem]">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-off-white dark:bg-[#252525]">
                <Briefcase className="size-5 text-brand-near-black dark:text-white" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-bold text-brand-near-black dark:text-white">{p.name}</p>
                  <Link to={`/projects/${p.id}`} className="shrink-0 text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white" title={t('admin.openProject')} aria-label={`${t('admin.openProject')} ${p.name}`}>
                    <ExternalLink className="size-3.5" />
                  </Link>
                </div>
                {p.createdAt && <p className="mt-0.5 text-xs text-brand-mid-grey">{t('admin.budgetsPage.waitingSince', { date: formatDate(p.createdAt) })}</p>}
                <p className="mt-0.5 truncate text-xs text-brand-mid-grey md:hidden">{p.ownerName || p.ownerEmail} · {p.country}</p>
              </div>
              <p className="hidden truncate text-sm text-brand-near-black md:block dark:text-white">{p.ownerName || p.ownerEmail}</p>
              <p className="hidden text-sm text-brand-near-black md:block dark:text-white">{labels.country(p.country) || p.country}</p>
              <p className="hidden text-right text-sm font-bold tabular-nums text-brand-near-black md:block dark:text-white">{p.estimate > 0 ? formatUSDFull(p.estimate) : '—'}</p>
              <button
                type="button"
                onClick={() => setSelected(p)}
                className="justify-self-end rounded-xl bg-brand-green px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-green-hover"
              >
                {t('admin.budgetsPage.setBudget')}
              </button>
            </li>
          ))}
          </ul>
          <p className="border-t border-brand-border-grey bg-brand-off-white px-5 py-3 text-xs text-brand-mid-grey dark:border-[#2c2c2c]">{t('admin.budgetsPage.setBudgetNote')}</p>
        </div>
      )}
          </section>

          {/* Financial operations across every project: where the money of each build stands,
              worst first, each row opening that project's Financials tab (01 §"Payments &
              Budgets"). Groundwork's business state only — no provider anywhere. */}
          <FinancialOperations />

          {/* The ledger (090) itself: every funding and release row, newest first. */}
          <LedgerPanel />
        </div>
      </div>

      <AnimatePresence>
        {selected && (
          <ConfirmBudgetModal project={selected} onClose={() => setSelected(null)} onConfirmed={remove} />
        )}
      </AnimatePresence>
    </div>
  );
}
