import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StepperProps {
  label: string;
  sublabel?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  className?: string;
}

export default function Stepper({
  label,
  sublabel,
  value,
  onChange,
  min = 0,
  max = 20,
  className,
}: StepperProps) {
  const decrement = () => onChange(Math.max(min, value - 1));
  const increment = () => onChange(Math.min(max, value + 1));

  return (
    <div className={cn('flex items-center justify-between px-5 py-5 border-b border-brand-border-grey last:border-0', className)}>
      <div>
        <p className="text-sm font-semibold text-brand-near-black dark:text-white">{label}</p>
        {sublabel && (
          <p className="text-xs text-brand-mid-grey mt-1">{sublabel}</p>
        )}
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <button
          type="button"
          onClick={decrement}
          disabled={value <= min}
          className="flex size-10 items-center justify-center rounded-full border-2 border-brand-border-grey dark:border-[#3d3d3d] text-brand-near-black dark:text-white hover:border-brand-near-black dark:hover:border-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          aria-label={`Decrease ${label}`}
        >
          <Minus className="size-4" strokeWidth={2.5} />
        </button>

        <span className="w-8 text-center text-lg font-bold text-brand-near-black dark:text-white tabular-nums select-none">
          {value}
        </span>

        <button
          type="button"
          onClick={increment}
          disabled={value >= max}
          className="flex size-10 items-center justify-center rounded-full border-2 border-brand-border-grey dark:border-[#3d3d3d] text-brand-near-black dark:text-white hover:border-brand-near-black dark:hover:border-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          aria-label={`Increase ${label}`}
        >
          <Plus className="size-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
