import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/** One progress vocabulary in both participant views. */
export function StageMarker({ position, number, selected = false, size = 'sm' }: {
  position: 'done' | 'current' | 'future'; number: number; selected?: boolean; size?: 'sm' | 'md' | 'lg';
}) {
  return <span className={cn(
    'relative z-[1] mx-auto flex shrink-0 items-center justify-center rounded-full border-2 font-mono font-semibold tabular-nums',
    size === 'lg' ? 'size-8 text-[11px]' : size === 'md' ? 'size-5 text-[10px]' : 'size-[18px] text-[9px]',
    position === 'done' && 'border-state-complete bg-state-complete text-white',
    position === 'current' && 'border-state-complete bg-white text-state-complete ring-[3px] ring-state-complete/15 dark:bg-[#1e1e1e]',
    position === 'future' && 'border-brand-border-grey bg-white text-brand-mid-grey dark:border-[#2c2c2c] dark:bg-[#1e1e1e]',
    selected && 'outline outline-2 outline-offset-4 outline-state-complete',
  )}>{position === 'done' ? <Check className={size === 'lg' ? 'size-3.5 stroke-[3]' : 'size-2.5 stroke-[3]'} aria-hidden /> : number}</span>;
}
