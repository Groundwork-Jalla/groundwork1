import { useT } from '@/lib/i18n';
import type { HealthBand } from '@/lib/admin/health';
import { cn } from '@/lib/utils';

// =========================================================
// Project status — the fleet by health band, drawn from the bands `projectHealth()`
// already computes. Hand-rolled SVG like the client dashboard's donut: there is no chart
// library in this codebase and one card does not justify adding one.
//
// Colour is status accent only. A band with no projects is still listed, at zero — the
// reader learns "none at risk", which is information; hiding the row would not be.
// =========================================================

const ORDER: { band: HealthBand; labelKey: 'admin.healthCard.onTrack' | 'admin.healthCard.attention' | 'admin.healthCard.atRisk' | 'admin.healthCard.planning' | 'admin.healthCard.completed'; className: string; stroke: string }[] = [
  { band: 'on_track',  labelKey: 'admin.healthCard.onTrack',   className: 'bg-state-complete', stroke: 'var(--color-state-complete)' },
  { band: 'attention', labelKey: 'admin.healthCard.attention', className: 'bg-state-held',     stroke: 'var(--color-state-held)' },
  { band: 'at_risk',   labelKey: 'admin.healthCard.atRisk',    className: 'bg-state-alert',    stroke: 'var(--color-state-alert)' },
  { band: 'planning',  labelKey: 'admin.healthCard.planning',  className: 'bg-brand-muted-grey', stroke: 'var(--color-brand-muted-grey)' },
  { band: 'done',      labelKey: 'admin.healthCard.completed', className: 'bg-brand-border-grey', stroke: 'var(--color-brand-border-grey)' },
];

export function HealthDonut({ counts, total }: { counts: Record<HealthBand, number>; total: number }) {
  const t = useT();
  const r = 56, cx = 70, cy = 70, circ = 2 * Math.PI * r;
  let acc = 0;

  return (
    <div className="flex flex-col items-center gap-6 px-5 py-5 sm:flex-row sm:items-center">
      <div className="relative shrink-0">
        <svg viewBox="0 0 140 140" className="size-36" role="img"
          aria-label={ORDER.map(o => `${t(o.labelKey)} ${counts[o.band] ?? 0}`).join(', ')}>
          <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth="14" className="stroke-brand-light-grey" />
          {total > 0 && (
            <g transform={`rotate(-90, ${cx}, ${cy})`}>
              {ORDER.map(o => {
                const n = counts[o.band] ?? 0;
                if (n === 0) return null;
                const len = (n / total) * circ;
                const dash = `${Math.max(0, len - 2)} ${circ - Math.max(0, len - 2)}`;
                const el = (
                  <circle key={o.band} cx={cx} cy={cy} r={r} fill="none" strokeWidth="14"
                    stroke={o.stroke} strokeDasharray={dash} strokeDashoffset={-acc} />
                );
                acc += len;
                return el;
              })}
            </g>
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums text-brand-near-black dark:text-white">{total}</span>
          <span className="text-[10px] uppercase tracking-wide text-brand-mid-grey">{t('admin.kpi.projects')}</span>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-2">
        {ORDER.map(o => {
          const n = counts[o.band] ?? 0;
          return (
            <li key={o.band} className="flex items-center gap-2.5 text-xs">
              <span className={cn('size-2.5 shrink-0 rounded-full', o.className)} />
              <span className="flex-1 truncate text-brand-mid-grey">{t(o.labelKey)}</span>
              <span className="tabular-nums font-semibold text-brand-near-black dark:text-white">{n}</span>
              <span className="w-10 shrink-0 text-right tabular-nums text-brand-muted-grey">
                {total > 0 ? `${Math.round((n / total) * 100)}%` : '—'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
