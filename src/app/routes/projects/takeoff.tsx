import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowLeft, FileSpreadsheet, Loader2, Plus, Lock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchProject } from '@/lib/supabase/projects';
import { getConstructionRate } from '@/lib/supabase/construction-rates';
import { createTakeoff, fetchTakeoffs, priceTakeoff, type ProjectTakeoffRow } from '@/lib/supabase/takeoffs';
import { formatLocalCurrency, formatUSDFull, projectBudget } from '@/lib/budget';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import type { ConstructionRate, ProjectRow } from '@/types/project';

// =========================================================
// Take-off list for one project.
//
// Lives under the signed-in shell rather than as a tab on projects/detail: that page is
// already 7 tabs at max-w-5xl and a 30-row editable grid does not fit in it. A deep link
// also matters here, because "here's my BQ" is a URL a contractor sends.
// =========================================================

function StatusPill({ status }: { status: ProjectTakeoffRow['status'] }) {
  const t = useT();
  const map = {
    draft:      'border-brand-border-grey text-brand-mid-grey',
    submitted:  'border-state-active/30 text-state-active',
    accepted:   'border-state-complete/30 text-state-complete',
    superseded: 'border-brand-border-grey text-brand-mid-grey line-through',
  } as const;
  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', map[status])}>
      {t(`takeoff.status.${status}`)}
    </span>
  );
}

export default function TakeoffList() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const t = useT();
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [rate, setRate]       = useState<ConstructionRate | null>(null);
  const [rows, setRows]       = useState<ProjectTakeoffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const p = await fetchProject(id);
      setProject(p);
      if (p) {
        const [r, list] = await Promise.all([
          getConstructionRate(p.country).catch(() => null),
          fetchTakeoffs(id),
        ]);
        setRate(r);
        setRows(list);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('takeoff.errLoad'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate() {
    if (!id || !user || !project) return;
    setCreating(true);
    setError(null);
    try {
      // Seeded from the project's own brief so the contractor starts from the client's
      // stated building, not from nothing. They can correct any of it.
      const row = await createTakeoff(id, user.id, {
        country: project.country,
        city: project.city ?? undefined,
        sqm: Number(project.sqm),
        floors: project.num_floors,
        buildingType: project.building_type,
        roofType: project.roof_type,
        finishLevel: project.finish_level,
        bedrooms: project.bedrooms,
        bathrooms: project.bathrooms,
        livingRooms: project.living_rooms,
        kitchens: project.kitchens,
        offices: project.offices ?? 0,
      }, null);
      navigate(`/projects/${id}/takeoff/${row.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('takeoff.errCreate'));
      setCreating(false);
    }
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="size-5 animate-spin text-brand-mid-grey" /></div>;
  }
  if (!project) {
    return <p className="py-20 text-center text-sm text-brand-mid-grey">{t('takeoff.notFound')}</p>;
  }

  const budget = projectBudget(project);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mx-auto flex max-w-4xl flex-col gap-5"
    >
      <Link to={`/projects/${project.id}`} className="inline-flex w-fit items-center gap-1.5 text-xs text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white">
        <ArrowLeft className="size-3.5" /> {project.name}
      </Link>

      <div>
        <h1 className="text-xl font-bold text-brand-near-black dark:text-white">{t('takeoff.title')}</h1>
        <p className="mt-1 text-sm leading-relaxed text-brand-mid-grey">{t('takeoff.subtitle')}</p>
      </div>

      <div className="rounded-xl border border-brand-border-grey bg-brand-off-white px-4 py-3 dark:border-[#2c2c2c] dark:bg-[#1a1a1a]">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-mid-grey">{t('takeoff.clientBudget')}</p>
        <p className="mt-0.5 text-lg font-bold tabular-nums text-brand-near-black dark:text-white">
          {formatUSDFull(budget.construction)}
        </p>
        <p className="mt-0.5 text-[11px] text-brand-mid-grey">{t('takeoff.clientBudgetNote')}</p>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-state-alert/30 px-4 py-2.5 text-sm text-state-alert">{error}</p>
      )}

      <div className="flex flex-col divide-y divide-brand-off-white rounded-xl border border-brand-border-grey dark:divide-[#242424] dark:border-[#2c2c2c]">
        {rows.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-brand-mid-grey">{t('takeoff.empty')}</p>
        )}
        {rows.map(row => {
          const priced = rate ? priceTakeoff(row, rate) : null;
          return (
            <Link
              key={row.id}
              to={`/projects/${project.id}/takeoff/${row.id}`}
              className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-brand-off-white dark:hover:bg-[#1e1e1e]"
            >
              <FileSpreadsheet className="size-4 shrink-0 text-brand-mid-grey" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <StatusPill status={row.status} />
                  {priced?.frozen && <Lock className="size-3 text-brand-mid-grey" />}
                </div>
                <p className="mt-1 truncate text-[11px] text-brand-mid-grey">
                  {new Date(row.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {row.note ? ` · ${row.note}` : ''}
                </p>
              </div>
              {priced && (
                <span className="shrink-0 text-sm font-semibold tabular-nums text-brand-near-black dark:text-white">
                  {formatLocalCurrency(Math.round(priced.totalLocal), priced.cityRate.currency_code)}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleCreate}
        disabled={creating}
        className="inline-flex w-fit items-center gap-2 rounded-xl bg-brand-near-black px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-brand-near-black"
      >
        {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        {t('takeoff.newTakeoff')}
      </button>
    </motion.div>
  );
}
