import { Link } from 'react-router';
import { MapPin } from 'lucide-react';
import type { DistributionSlice, FunnelStep, LocationCount, OpenTicket } from '@/lib/supabase/admin-overview';
import { findCountry } from '@/lib/countries';
import { formatRelative } from '@/lib/format';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// The Overview's body and rail blocks.
//
// Every list here shows at most five rows and ends at its real module — the Overview is
// a preview of each module, never a replacement for it (rule of 13 Sep 2026). The
// slicing happens on the projection, not in the query: the module behind "See all" still
// needs the full set.
// =========================================================

/** The one place the five-row rule is applied, so it cannot drift per block. */
export const OVERVIEW_ROWS = 5;

/**
 * Where the projects are.
 *
 * OPTION B of the two the reviewer allowed (14 Sep 2026). A true Map View needs country
 * geometry; `projects` records a country code and a city and no coordinates, and this
 * codebase carries no boundary data, so a drawn map would either need fabricated
 * geometry or a new geodata dependency. Neither is a decision to make inside a dashboard
 * card, so this stays a geographic summary and says so in its own subtitle.
 *
 * What it is NOT allowed to become: a world map with pins dropped at guessed points.
 * The upgrade path is real — store coordinates on the project, or add Natural Earth
 * country geometry — and the data this reads (country, city, count) is already the input
 * a choropleth would take.
 */
export function LocationList({ locations }: { locations: LocationCount[] }) {
  const t = useT();
  const total = locations.reduce((a, l) => a + l.count, 0);
  const byCountry = new Map<string, number>();
  for (const l of locations) byCountry.set(l.country, (byCountry.get(l.country) ?? 0) + l.count);
  const ranked = [...byCountry].sort((a, b) => b[1] - a[1]);

  return (
    <div className="px-5 py-4">
      <ul className="space-y-3">
        {ranked.slice(0, OVERVIEW_ROWS).map(([country, count]) => {
          const share = total > 0 ? Math.round((count / total) * 100) : 0;
          // The country's real name where we know the code; the code itself otherwise —
          // never a name guessed from an unrecognised code.
          const name = findCountry(country)?.name ?? country;
          return (
            <li key={country}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 rounded border border-brand-border-grey px-1.5 py-px text-[10px] font-semibold tabular-nums tracking-wide text-brand-mid-grey dark:border-[#2c2c2c]">
                    {country}
                  </span>
                  <span className="truncate text-xs font-medium text-brand-near-black dark:text-white">{name}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-brand-mid-grey">
                  {count}<span className="ml-1.5 text-brand-muted-grey">{share}%</span>
                </span>
              </div>
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-brand-light-grey">
                <span className="block h-full rounded-full bg-brand-near-black dark:bg-white" style={{ width: `${share}%` }} />
              </span>
              <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                {locations.filter(l => l.country === country).slice(0, 4).map(l => (
                  <li key={`${l.country}|${l.city ?? ''}`} className="flex items-center gap-1 text-[11px] text-brand-mid-grey">
                    <MapPin className="size-2.5 shrink-0 text-brand-muted-grey" />
                    {l.city ?? t('admin.map.noCity')} <span className="tabular-nums">{l.count}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      {ranked.length > OVERVIEW_ROWS && (
        <p className="mt-3 text-[11px] text-brand-muted-grey">
          {t('admin.map.moreCountries', { shown: OVERVIEW_ROWS, total: ranked.length })}
        </p>
      )}
    </div>
  );
}

/** The contractor funnel: real counts at each real stage, each step opening its own module. */
export function ApplicationsFunnel({ steps }: { steps: FunnelStep[] }) {
  const t = useT();
  const max = Math.max(1, ...steps.map(s => s.count));
  return (
    <ul className="space-y-2.5 px-5 py-4">
      {steps.map(step => (
        <li key={step.key}>
          <Link to={step.to} className="group block">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-brand-mid-grey transition-colors group-hover:text-brand-near-black dark:group-hover:text-white">
                {t(`admin.funnel.step.${step.key}` as TKey)}
              </span>
              <span className="tabular-nums font-semibold text-brand-near-black dark:text-white">{step.count}</span>
            </div>
            <span className="mt-1 block h-2 overflow-hidden rounded-full bg-brand-light-grey">
              <span className="block h-full rounded-full bg-brand-near-black transition-[width] dark:bg-white"
                style={{ width: `${Math.round((step.count / max) * 100)}%` }} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export type DistributionDimension = 'trade' | 'location';

/**
 * Contractors, grouped by one of the directory's own columns.
 *
 * "Distribution" has two readings and the data supports both, so the card carries both
 * and the admin picks: `trade` is the enum the contractor chose on the application form,
 * shown through that form's own dictionary (so `land_lawyer` reads "Land Lawyer");
 * `location` is the free text they typed, shown exactly as stored — normalising
 * "Douala" and "douala, CM" into one bar would be inventing a fact about where they are.
 */
export function ContractorDistribution({ slices, dimension, onDimension }: {
  slices: DistributionSlice[];
  dimension: DistributionDimension;
  onDimension: (d: DistributionDimension) => void;
}) {
  const t = useT();
  const total = slices.reduce((a, s) => a + s.count, 0);
  const label = (raw: string) => {
    if (dimension === 'location') return raw;
    const key = `contractorApply.form.role.${raw}` as TKey;
    const hit = t(key);
    return hit === key ? raw : hit;
  };

  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex gap-1" role="group" aria-label={t('admin.distribution.dimension')}>
        {(['trade', 'location'] as const).map(d => (
          <button
            key={d}
            type="button"
            onClick={() => onDimension(d)}
            aria-pressed={dimension === d}
            className={cn(
              'rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors',
              dimension === d
                ? 'bg-[#0a0a0a] text-white dark:bg-white dark:text-[#0a0a0a]'
                : 'text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white',
            )}
          >
            {t(d === 'trade' ? 'admin.distribution.byTrade' : 'admin.distribution.byLocation')}
          </button>
        ))}
      </div>

      <ul className="space-y-2.5">
        {slices.slice(0, OVERVIEW_ROWS).map(s => (
          <li key={s.label}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-brand-near-black dark:text-white">{label(s.label)}</span>
              <span className="shrink-0 tabular-nums text-brand-mid-grey">
                {s.count}{total > 0 && <span className="ml-1.5 text-brand-muted-grey">{Math.round((s.count / total) * 100)}%</span>}
              </span>
            </div>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-brand-light-grey">
              <span className="block h-full rounded-full bg-brand-near-black dark:bg-white"
                style={{ width: `${total > 0 ? Math.round((s.count / total) * 100) : 0}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Open and in-progress support cases — never conversations, never project issues. */
export function TicketList({ tickets }: { tickets: OpenTicket[] }) {
  const t = useT();
  return (
    <ul className="divide-y divide-brand-border-grey dark:divide-[#2c2c2c]">
      {tickets.slice(0, OVERVIEW_ROWS).map(ticket => (
        <li key={ticket.id} className="px-5 py-2.5">
          <p className="truncate text-sm font-medium text-brand-near-black dark:text-white">{ticket.subject}</p>
          <p className="mt-0.5 flex items-center justify-between gap-3 text-[11px] text-brand-mid-grey">
            <span className="truncate">{ticket.who}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className={cn('size-1.5 rounded-full', ticket.status === 'open' ? 'bg-state-held' : 'bg-state-active')} />
              {t(`admin.supportCard.status.${ticket.status}` as TKey)} · {formatRelative(ticket.createdAt)}
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}
