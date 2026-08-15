import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, FileSpreadsheet } from 'lucide-react';
import { getConstructionRate } from '@/lib/supabase/construction-rates';
import { fetchTakeoffs, priceTakeoff, type ProjectTakeoffRow } from '@/lib/supabase/takeoffs';
import { SECTION_KEYS, formatUSDFull, projectBudget, sectionsFromLines, calculateBudgetDetail } from '@/lib/budget';
import { cn } from '@/lib/utils';
import { useT, type TKey } from '@/lib/i18n';
import type { ConstructionRate, ProjectRow } from '@/types/project';

// =========================================================
// What a contractor quoted, against what Groundwork estimated.
//
// This comparison is the point of the take-off feature. Everything else — the grid, the
// overrides, the geometry — exists so that this card can show a real number beside ours
// and say where the difference sits.
//
// Only SUBMITTED take-offs appear. RLS enforces that too (039), but the query says so as
// well: a draft is the contractor's working document, and the owner seeing it change
// under them would be worse than not seeing it at all.
// =========================================================

export function TakeoffComparison({ project }: { project: ProjectRow }) {
  const t = useT();
  const [rows, setRows] = useState<ProjectTakeoffRow[]>([]);
  const [rate, setRate] = useState<ConstructionRate | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [list, r] = await Promise.all([
        fetchTakeoffs(project.id).catch(() => []),
        getConstructionRate(project.country).catch(() => null),
      ]);
      if (!live) return;
      setRows(list.filter(x => x.status !== 'draft'));
      setRate(r);
    })();
    return () => { live = false; };
  }, [project.id, project.country]);

  if (rows.length === 0 || !rate) return null;

  // Compared against the CONSTRUCTION fee, not the client total: a contractor prices the
  // build, and design, permit and professional fees are not theirs to quote.
  const budget = projectBudget(project).construction;
  const ours   = calculateBudgetDetail({
    country: project.country, city: project.city ?? undefined,
    sqm: Number(project.sqm), floors: project.num_floors,
    buildingType: project.building_type, roofType: project.roof_type,
    finishLevel: project.finish_level,
    bedrooms: project.bedrooms, bathrooms: project.bathrooms,
    livingRooms: project.living_rooms, kitchens: project.kitchens,
  }, rate);

  const oursBySection = new Map(ours.sections.map(s => [s.key, s.amountUSD]));

  return (
    <div className="rounded-2xl border border-brand-border-grey bg-white p-5 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-brand-near-black dark:text-white">{t('takeoff.compareTitle')}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-brand-mid-grey">{t('takeoff.compareSub')}</p>
        </div>
        <Link
          to={`/projects/${project.id}/takeoff`}
          className="inline-flex shrink-0 items-center gap-1 text-xs text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white"
        >
          {t('takeoff.viewAll')} <ArrowRight className="size-3" />
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        {rows.map(row => {
          const priced = priceTakeoff(row, rate);
          if (!priced) return null;
          const fx  = row.fx_rate ?? rate.approx_fx_rate;
          const usd = priced.totalLocal / fx;
          const diff = usd - budget;
          const pct  = budget > 0 ? (diff / budget) * 100 : 0;
          const theirs = sectionsFromLines(priced.lines, SECTION_KEYS);

          return (
            <Link
              key={row.id}
              to={`/projects/${project.id}/takeoff/${row.id}`}
              className="rounded-xl border border-brand-border-grey p-4 transition-colors hover:bg-brand-off-white dark:border-[#2c2c2c] dark:hover:bg-[#252525]"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-xs text-brand-mid-grey">
                  <FileSpreadsheet className="size-3.5" />
                  {new Date(row.submitted_at ?? row.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <span className="text-right">
                  <span className="block text-base font-bold tabular-nums text-brand-near-black dark:text-white">
                    {formatUSDFull(usd)}
                  </span>
                  <span className={cn(
                    'block text-[11px] font-semibold tabular-nums',
                    Math.abs(pct) < 1 ? 'text-brand-mid-grey' : pct > 0 ? 'text-state-held' : 'text-state-complete',
                  )}>
                    {diff > 0 ? '+' : ''}{formatUSDFull(diff)} ({pct > 0 ? '+' : ''}{pct.toFixed(1)}%)
                  </span>
                </span>
              </div>

              {/* Per-section deltas — where the difference actually sits. */}
              <div className="mt-3 flex flex-col gap-1">
                {SECTION_KEYS.map(key => {
                  const mine  = oursBySection.get(key) ?? 0;
                  const yours = (theirs[key] ?? 0) / fx;
                  if (mine === 0 && yours === 0) return null;
                  const d = yours - mine;
                  return (
                    <div key={key} className="flex items-baseline justify-between gap-3 text-[11px]">
                      <span className="truncate text-brand-mid-grey">{t(`takeoff.section.${key}` as TKey)}</span>
                      <span className={cn(
                        'shrink-0 tabular-nums',
                        Math.abs(d) < 1 ? 'text-brand-mid-grey'
                          : d > 0 ? 'text-state-held' : 'text-state-complete',
                      )}>
                        {d > 0 ? '+' : ''}{formatUSDFull(d)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
