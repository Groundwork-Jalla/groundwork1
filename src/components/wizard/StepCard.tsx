import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StepCardProps {
  selected: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

export default function StepCard({
  selected,
  onClick,
  icon,
  label,
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
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2',
        selected
          ? 'border-brand-near-black bg-brand-off-white'
          : 'border-brand-border-grey bg-white hover:border-brand-dark-grey',
        disabled && 'opacity-40 cursor-not-allowed',
        className,
      )}
    >
      {/* Selected check mark */}
      {selected && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.18, ease: 'backOut' }}
          className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-brand-near-black"
        >
          <Check className="size-3 text-white" strokeWidth={3} />
        </motion.span>
      )}

      <div className="p-4 sm:p-5">
        {icon && (
          <div className="mb-3 flex items-center justify-center h-14">
            {icon}
          </div>
        )}
        <p className="font-semibold text-sm text-brand-near-black leading-tight">{label}</p>
        {description && (
          <p className="mt-1 text-xs text-brand-mid-grey leading-relaxed">{description}</p>
        )}
      </div>
    </motion.button>
  );
}
