import { Link } from 'react-router';
import type { DistributionSlice, FunnelStep, OpenTicket } from '@/lib/supabase/admin-overview';
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
 * Contractors by trade — the enum each contractor chose on the application form, shown
 * through that form's own dictionary, so `land_lawyer` reads "Land Lawyer".
 *
 * TRADE, NOT LOCATION (Favour, 14 Sep 2026). "Distribution" briefly shipped with a
 * Trade/Location toggle while the wording was open; it is settled — this is the workforce
 * by discipline, and where the work is happening is Map View's job. The toggle is gone
 * because an Overview card should be readable at a glance, not operated.
 */
export function ContractorDistribution({ slices }: { slices: DistributionSlice[] }) {
  const t = useT();
  const total = slices.reduce((a, s) => a + s.count, 0);
  const label = (raw: string) => {
    const key = `contractorApply.form.role.${raw}` as TKey;
    const hit = t(key);
    return hit === key ? raw : hit;
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
