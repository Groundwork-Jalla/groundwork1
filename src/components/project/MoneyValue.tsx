import { useMoney, useProjectMoneyContext } from '@/lib/budget/project-money-context';
import { cn } from '@/lib/utils';

/** Native amount first, with its saved USD equivalent. Never fetches another FX rate. */
export function MoneyValue({ usd, amount, className, secondaryClassName }: {
  usd: number | null | undefined; amount?: number | null; className?: string; secondaryClassName?: string;
}) {
  const money = useMoney();
  const currency = useProjectMoneyContext();
  const pair = currency?.pair(usd, amount);
  return <span className={cn('inline-flex flex-col font-mono tabular-nums', className)}>
    <span>{usd == null && amount == null ? '—' : money(usd, amount)}</span>
    {pair?.usd && <span className={cn('mt-0.5 text-xs font-normal text-brand-mid-grey', secondaryClassName)}>≈ {pair.usd}</span>}
  </span>;
}
