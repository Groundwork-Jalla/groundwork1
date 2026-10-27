import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StepCardProps {
  selected: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  badge?: string;
  /** Pill straddling the top edge, centred — same treatment as the country picker. */
  floatingBadge?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

export default function StepCard({
  selected,
  onClick,
  icon,
  label,
  badge,
  floatingBadge,
  description,
  disabled = false,
  className,
}: StepCardProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'relative w-full rounded-xl border-2 text-left transition-all duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black dark:focus-visible:ring-white focus-visible:ring-offset-2',
        selected
          ? 'border-brand-near-black dark:border-white bg-brand-off-white dark:bg-brand-dark-grey'
          : 'border-brand-border-grey dark:border-[#2c2c2c] bg-white dark:bg-[#1c1c1c] hover:border-brand-dark-grey dark:hover:border-[#555]',
        disabled && 'opacity-40 cursor-not-allowed',
        className,
      )}
    >
      {floatingBadge && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-brand-near-black text-white dark:bg-white dark:text-brand-near-black text-[9px] font-semibold px-2 py-px rounded-full whitespace-nowrap tracking-wide">
          {floatingBadge}
        </span>
      )}

      {/* Selected check mark */}
      {selected && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.18, ease: 'backOut' }}
          className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-brand-near-black dark:bg-white"
        >
          <Check className="size-3 text-white dark:text-brand-near-black" strokeWidth={3} />
        </motion.span>
      )}

      <div className="p-4 sm:p-5">
        {icon && (
          <div className="mb-3 flex items-center justify-center h-14">
            {icon}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-sm text-brand-near-black dark:text-white leading-tight">{label}</p>
          {badge && (
            <span className="rounded-full bg-brand-near-black px-2 py-0.5 text-[9px] font-bold text-white dark:bg-white dark:text-brand-near-black">
              {badge}
            </span>
          )}
        </div>
        {description && (
          <p className="mt-1 text-xs text-brand-mid-grey leading-relaxed">{description}</p>
        )}
      </div>
    </motion.button>
  );
}
