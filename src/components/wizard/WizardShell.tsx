import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GroundworkLogo } from '@/components/ui/GroundworkLogo';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import ProgressBar from './ProgressBar';
import { BuildingPreview } from './BuildingPreview';
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
    <div className="h-screen bg-white flex overflow-hidden">
      {/* ─── Left panel (form) ─────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 h-screen">
        {/* Header */}
        <header className="shrink-0 flex items-center justify-between px-6 sm:px-10 py-4 border-b border-brand-border-grey">
          <GroundworkLogo linkTo="/dashboard" />
          {/* Mobile progress bar */}
          <div className="flex-1 mx-6 md:hidden">
            <ProgressBar />
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle compact />
            {!isFirst ? (
              <button
                type="button"
                onClick={back}
                disabled={isSubmitting}
                className="text-sm text-brand-mid-grey hover:text-brand-near-black transition-colors disabled:opacity-40 flex items-center gap-1"
              >
                <ArrowLeft className="size-3.5" />
                Back
              </button>
            ) : (
              <Link
                to="/dashboard"
                className="text-sm text-brand-mid-grey hover:text-brand-near-black transition-colors"
              >
                ← Cancel
              </Link>
            )}
          </div>
        </header>

        {/* Step content */}
        <main className="flex-1 overflow-y-auto px-6 sm:px-10 py-8">
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

        {/* Footer */}
        <footer className="shrink-0 px-6 sm:px-10 py-4 border-t border-brand-border-grey">
          <div className="w-full max-w-lg mx-auto flex items-center justify-end gap-3">
            {!hideContinue && (
              <Button
                type="button"
                onClick={handleContinue}
                disabled={!canContinue || isSubmitting}
                className="bg-brand-near-black text-white hover:bg-brand-rich-black gap-1.5 min-w-32"
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

      {/* ─── Right panel (preview) ─────────────────────────── */}
      <aside className="hidden md:flex flex-col w-1/2 shrink-0 border-l border-brand-border-grey dark:border-[#2c2c2c] bg-brand-off-white dark:bg-[#111] h-screen">
        {/* Progress bar */}
        <div className="shrink-0 px-8 pt-6 pb-4 border-b border-brand-border-grey">
          <ProgressBar />
        </div>
        {/* Building preview — fills remaining height */}
        <div className="flex-1 overflow-hidden">
          <BuildingPreview />
        </div>
      </aside>
    </div>
  );
}
