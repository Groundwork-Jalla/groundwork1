import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useT, type TKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =========================================================
// The Overview's two primitives, so every block on the page is the same object in two
// themes rather than two designs. Composition follows the light concept; the treatment
// follows the dark one (docs/admin, 13 Sep 2026).
//
// Rules that hold everywhere here: monochrome icons, colour only as a status accent, no
// emoji, no number without a query behind it. A card with nothing to show renders its
// empty sentence — it is never filled with an example.
// =========================================================

export function Card({ titleKey, subtitleKey, viewAllTo, className, children }: {
  titleKey: TKey;
  subtitleKey?: TKey;
  /** Renders the "View all" link in the header when the destination exists. */
  viewAllTo?: string;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <section className={cn(
      'flex min-w-0 flex-col rounded-2xl border bg-white',
      'border-brand-border-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]',
      className,
    )}>
      <header className="flex items-start justify-between gap-3 border-b border-brand-border-grey px-5 py-4 dark:border-[#2c2c2c]">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-brand-near-black dark:text-white">{t(titleKey)}</h2>
          {subtitleKey && <p className="mt-0.5 text-xs text-brand-mid-grey">{t(subtitleKey)}</p>}
        </div>
        {viewAllTo && (
          <Link
            to={viewAllTo}
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand-mid-grey transition-colors hover:text-brand-near-black dark:hover:text-white"
          >
            {t('common.viewAll')}
            <ArrowRight className="size-3.5" />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

/** The sentence a card shows when the query came back with nothing. */
export function CardEmpty({ messageKey }: { messageKey: TKey }) {
  const t = useT();
  return <p className="px-5 py-8 text-center text-xs text-brand-mid-grey">{t(messageKey)}</p>;
}

/**
 * One KPI. `value` is `null` when the source is not available yet (a migration not
 * pasted, a function that failed) — shown as "not available", never as 0, because a
 * zero that means "we could not look" is a lie.
 */
export function Kpi({ labelKey, value, subtitle, to, accent }: {
  labelKey: TKey;
  value: number | null;
  subtitle?: string;
  to?: string;
  /** Status accent, used only when the number means something is wrong. */
  accent?: 'held' | 'alert';
}) {
  const t = useT();
  const body = (
    <>
      <p className="text-xs font-medium text-brand-mid-grey">{t(labelKey)}</p>
      <p className={cn(
        'mt-2 text-3xl font-bold tabular-nums tracking-tight',
        value === null ? 'text-brand-muted-grey'
          : accent === 'alert' && value > 0 ? 'text-state-alert'
          : accent === 'held' && value > 0 ? 'text-state-held'
          : 'text-brand-near-black dark:text-white',
      )}>
        {value === null ? '—' : value}
      </p>
      <p className="mt-1.5 text-[11px] leading-snug text-brand-mid-grey">
        {value === null ? t('admin.kpi.unavailable') : subtitle}
      </p>
    </>
  );
  const shell = 'flex min-w-0 flex-col rounded-2xl border border-brand-border-grey bg-white px-5 py-4 dark:border-[#2c2c2c] dark:bg-[#1e1e1e]';
  return to
    ? <Link to={to} className={cn(shell, 'transition-colors hover:border-brand-near-black dark:hover:border-white/40')}>{body}</Link>
    : <div className={shell}>{body}</div>;
}
