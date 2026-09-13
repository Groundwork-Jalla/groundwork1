import { Link } from 'react-router';
import type { DistributionSlice, FunnelStep, LocationCount, OpenTicket } from '@/lib/supabase/admin-overview';
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
 * Where the projects are. A table by country and city, not a map: `projects` records a
 * country and a city, never coordinates, and a pin placed at a guessed point would be a
 * fabricated fact. A real map arrives with real coordinates.
 */
export function LocationList({ locations }: { locations: LocationCount[] }) {
  const t = useT();
  const total = locations.reduce((a, l) => a + l.count, 0);
  const byCountry = new Map<string, number>();
  for (const l of locations) byCountry.set(l.country, (byCountry.get(l.country) ?? 0) + l.count);

  return (
    <div className="px-5 py-4">
      <ul className="space-y-2.5">
        {[...byCountry].sort((a, b) => b[1] - a[1]).slice(0, OVERVIEW_ROWS).map(([country, count]) => (
          <li key={country}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-brand-near-black dark:text-white">{country}</span>
              <span className="tabular-nums text-brand-mid-grey">{count}</span>
            </div>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-brand-light-grey">
              <span className="block h-full rounded-full bg-brand-near-black dark:bg-white"
                style={{ width: `${total > 0 ? Math.round((count / total) * 100) : 0}%` }} />
            </span>
            <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
              {locations.filter(l => l.country === country).slice(0, 4).map(l => (
                <li key={`${l.country}|${l.city ?? ''}`} className="text-[11px] text-brand-mid-grey">
                  {l.city ?? t('admin.map.noCity')} <span className="tabular-nums">{l.count}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
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

/**
 * Contractors grouped by the directory's own `trade` column. The stored value is the
 * application form's own enum (`land_lawyer`), so it is shown through that form's
 * dictionary — the same words the contractor picked — and falls back to the raw value
 * for a trade the dictionary does not carry rather than hiding the row.
 */
export function ContractorDistribution({ slices }: { slices: DistributionSlice[] }) {
  const t = useT();
  const total = slices.reduce((a, s) => a + s.count, 0);
  const label = (trade: string) => {
    const key = `contractorApply.form.role.${trade}` as TKey;
    const hit = t(key);
    return hit === key ? trade : hit;
  };
  return (
    <ul className="space-y-2.5 px-5 py-4">
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
