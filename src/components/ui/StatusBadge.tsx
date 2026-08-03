import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  MONEY_BUCKET_META, STATE_META, type MoneyBucket, type State,
} from '@/lib/status';

/**
 * The Foundations badge: a 6px dot and a word.
 *
 * No tinted pill. Foundations is explicit about why — "a table of ten stages reads as a
 * ledger instead of a paint chart". The previous badges used `bg-green-50 text-green-700`
 * style pastel fills, which made a ten-row stage table look like a colour swatch page and
 * gave four different visual weights to what is one dimension of information.
 *
 * State comes from `@/lib/status`, which is the only place that maps a stored DB value
 * onto a word the user sees.
 */
export function StatusBadge({
  state,
  className,
  size = 'default',
}: {
  state: State;
  className?: string;
  size?: 'default' | 'small';
}) {
  const t = useT();
  const meta = STATE_META[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium whitespace-nowrap',
        size === 'small' ? 'text-[11px]' : 'text-xs',
        meta.text,
        className,
      )}
    >
      <StatusDot state={state} />
      {t(meta.labelKey)}
    </span>
  );
}

/** The dot on its own — for dense rows, tracker nodes and legends. */
export function StatusDot({ state, className }: { state: State; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('size-1.5 shrink-0 rounded-full', STATE_META[state].dot, className)}
    />
  );
}

/**
 * The money equivalent. A bucket says where the money sits; a state says where the work
 * sits, and they are not the same list — a stage can be complete while its milestone is
 * still in transit.
 */
export function MoneyBadge({
  bucket,
  className,
  size = 'default',
}: {
  bucket: MoneyBucket;
  className?: string;
  size?: 'default' | 'small';
}) {
  const t = useT();
  const meta = MONEY_BUCKET_META[bucket];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium whitespace-nowrap',
        size === 'small' ? 'text-[11px]' : 'text-xs',
        meta.text,
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', meta.dot)} />
      {t(meta.labelKey)}
    </span>
  );
}

/**
 * A money figure in the Foundations treatment: mono, tabular, cents always, and coloured
 * by its bucket. Pass an already-formatted string — `useFormat().money()` produces it.
 */
export function Figure({
  children,
  bucket,
  className,
}: {
  children: React.ReactNode;
  bucket?: MoneyBucket;
  className?: string;
}) {
  return (
    <span className={cn('figure', bucket && MONEY_BUCKET_META[bucket].text, className)}>
      {children}
    </span>
  );
}
