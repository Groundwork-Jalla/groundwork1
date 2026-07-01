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
    <div className={cn('flex items-center justify-between py-3.5 border-b border-brand-border-grey last:border-0', className)}>
      <div>
        <p className="text-sm font-medium text-brand-near-black">{label}</p>
        {sublabel && (
          <p className="text-xs text-brand-mid-grey mt-0.5">{sublabel}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={decrement}
          disabled={value <= min}
          className="flex size-8 items-center justify-center rounded-full border border-brand-border-grey text-brand-near-black hover:border-brand-near-black disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          aria-label={`Decrease ${label}`}
        >
          <Minus className="size-3.5" strokeWidth={2.5} />
        </button>

        <span className="w-5 text-center font-semibold text-brand-near-black tabular-nums select-none">
          {value}
        </span>

        <button
          type="button"
          onClick={increment}
          disabled={value >= max}
          className="flex size-8 items-center justify-center rounded-full border border-brand-border-grey text-brand-near-black hover:border-brand-near-black disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          aria-label={`Increase ${label}`}
        >
          <Plus className="size-3.5" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
