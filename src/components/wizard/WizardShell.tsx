import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ProgressDots from './ProgressDots';
import { useWizard } from '@/contexts/WizardContext';

// =========================================================
// Step transition variants
// =========================================================
const variants = {
  enter: (direction: 'forward' | 'back') => ({
    x:       direction === 'forward' ? 32 : -32,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit:  (direction: 'forward' | 'back') => ({
    x:       direction === 'forward' ? -32 : 32,
    opacity: 0,
  }),
};

// =========================================================
// Props
// =========================================================
interface WizardShellProps {
  children: React.ReactNode;
  canContinue?: boolean;
  onContinue?: () => void;
  continueLabel?: string;
  isSubmitting?: boolean;
  hideContinue?: boolean;
}

export default function WizardShell({
  children,
  canContinue = true,
  onContinue,
  continueLabel = 'Continue',
  isSubmitting = false,
  hideContinue = false,
}: WizardShellProps) {
  const { step, totalSteps, direction, next, back } = useWizard();
  const isFirst = step === 1;

  function handleContinue() {
    if (onContinue) { onContinue(); } else { next(); }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* ─── Header ────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 sm:px-10 py-5 border-b border-brand-border-grey shrink-0">
        <Link to="/dashboard" className="flex items-baseline gap-1.5">
          <span className="font-sans text-base font-semibold text-brand-near-black">Groundwork</span>
          <span className="text-[11px] text-brand-mid-grey">by Jalla</span>
        </Link>

        <span className="text-xs font-medium text-brand-mid-grey tabular-nums">
          Step {step} of {totalSteps}
        </span>
      </header>

      {/* ─── Progress ──────────────────────────────────────── */}
      <div className="flex justify-center pt-7 pb-4 px-6 shrink-0">
        <ProgressDots />
      </div>

      {/* ─── Step content ──────────────────────────────────── */}
      <main className="flex-1 flex flex-col justify-center px-6 sm:px-10 pb-8">
        <div className="w-full max-w-lg mx-auto">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* ─── Navigation ────────────────────────────────────── */}
      <footer className="shrink-0 px-6 sm:px-10 py-5 border-t border-brand-border-grey">
        <div className="w-full max-w-lg mx-auto flex items-center justify-between gap-3">
          {!isFirst ? (
            <Button
              type="button"
              variant="outline"
              onClick={back}
              disabled={isSubmitting}
              className="gap-1.5 text-brand-mid-grey border-brand-border-grey hover:text-brand-near-black"
            >
              <ArrowLeft className="size-3.5" />
              Back
            </Button>
          ) : (
            <Link
              to="/dashboard"
              className="text-sm text-brand-mid-grey hover:text-brand-near-black transition-colors"
            >
              ← Cancel
            </Link>
          )}

          {!hideContinue && (
            <Button
              type="button"
              onClick={handleContinue}
              disabled={!canContinue || isSubmitting}
              className="bg-brand-near-black text-white hover:bg-brand-rich-black gap-1.5 min-w-28"
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  {continueLabel}
                  <ArrowRight className="size-3.5" />
                </>
              )}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
