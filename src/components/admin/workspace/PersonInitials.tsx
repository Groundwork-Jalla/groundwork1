import { cn } from '@/lib/utils';

/**
 * A person's initials in a soft circle — the workspace tabs' only avatar (18 Nov redesign).
 * No photo is invented; a missing name reads "?".
 */
export function PersonInitials({ name, tone = 'neutral', className }: {
  name: string | null | undefined;
  tone?: 'neutral' | 'green' | 'held';
  className?: string;
}) {
  const letters = (name ?? '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
  return (
    <span aria-hidden className={cn(
      'grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold',
      tone === 'green' ? 'bg-state-complete/10 text-state-complete'
        : tone === 'held' ? 'bg-state-held/10 text-state-held'
        : 'bg-brand-light-grey text-brand-mid-grey',
      className,
    )}>
      {letters}
    </span>
  );
}
