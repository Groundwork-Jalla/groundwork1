import { motion } from 'framer-motion';
import { useWizard } from '@/contexts/WizardContext';

export default function ProgressDots() {
  const { step, totalSteps, goTo } = useWizard();

  return (
    <div className="flex items-center justify-center gap-0">
      {Array.from({ length: totalSteps }, (_, i) => {
        const n        = i + 1;
        const done     = n < step;
        const current  = n === step;
        const isLast   = n === totalSteps;

        return (
          <div key={n} className="flex items-center">
            {/* Dot */}
            <button
              type="button"
              onClick={() => done && goTo(n)}
              disabled={!done}
              aria-label={`Step ${n}`}
              className="relative flex items-center justify-center focus:outline-none"
              style={{ width: 20, height: 20 }}
            >
              {current ? (
                <motion.span
                  layoutId="wizard-dot-active"
                  className="block size-3.5 rounded-full bg-brand-near-black ring-2 ring-brand-near-black ring-offset-2"
                />
              ) : done ? (
                <span className="block size-2.5 rounded-full bg-brand-near-black opacity-70 cursor-pointer hover:opacity-100 transition-opacity" />
              ) : (
                <span className="block size-2.5 rounded-full border border-brand-border-grey" />
              )}
            </button>

            {/* Connector line */}
            {!isLast && (
              <span
                className="block h-px w-6 sm:w-8"
                style={{
                  background: done
                    ? 'var(--color-brand-near-black)'
                    : 'var(--color-brand-border-grey)',
                  opacity: done ? 0.7 : 1,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
