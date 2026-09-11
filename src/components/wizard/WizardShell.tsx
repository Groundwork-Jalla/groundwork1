import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GroundworkLogo } from '@/components/ui/GroundworkLogo';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
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
  /**
   * Intercept the header's Back button.
   *
   * Steps that run a flow of their own — step 5 walks a floor at a time — need Back to
   * retreat inside the step before it leaves the step. Without this the only way out of
   * such a flow is forwards, and a user who opened the wrong floor is stuck.
   *
   * Return nothing and the step handles it; the shell does not call `back()` as well.
   */
  onBack?: () => void;
  /**
   * Widen the content column from the default reading width.
   *
   * Every other step is a form, and `max-w-lg` is the right measure for one. Step 10
   * is a three-column comparison — at 512px each column gets about 112px of text and
   * every bullet wraps to three lines, which defeats the point of showing the plans
   * side by side.
   */
  wide?: boolean;
}

export default function WizardShell({
  children,
  canContinue = true,
  onContinue,
  continueLabel,
  isSubmitting = false,
  hideContinue = false,
  onBack,
  wide = false,
}: WizardShellProps) {
  const measure = wide ? 'max-w-3xl' : 'max-w-lg';
  const { step, totalSteps, direction, next, back, onBehalfOf } = useWizard();
  const t = useT();
  const isFirst = step === 1;

  function handleContinue() {
    if (onContinue) { onContinue(); } else { next(); }
  }

  function handleBack() {
    if (onBack) { onBack(); } else { back(); }
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
            <LanguageToggle compact />
            <ThemeToggle compact />
            {!isFirst || onBack ? (
              <button
                type="button"
                onClick={handleBack}
                disabled={isSubmitting}
                className="text-sm text-brand-mid-grey hover:text-brand-near-black transition-colors disabled:opacity-40 flex items-center gap-1"
              >
                <ArrowLeft className="size-3.5" />
                {t('common.back')}
              </button>
            ) : (
              <Link
                to="/dashboard"
                className="text-sm text-brand-mid-grey hover:text-brand-near-black transition-colors"
              >
                ← {t('common.cancel')}
              </Link>
            )}
          </div>
        </header>

        {/* Whose project this is, when it is not the person at the keyboard. Persistent
            across every step so an admin never loses sight of which client they are
            setting up — the one mistake here that is genuinely hard to undo. */}
        {onBehalfOf && (
          <div className="shrink-0 border-b border-amber-300 bg-amber-50 px-6 sm:px-10 py-2.5 text-xs text-amber-900">
            <span className="font-semibold">{t('wizard.onBehalf.creatingFor')}</span>{' '}
            <span className="font-mono">{onBehalfOf.label}</span>
            <span className="text-amber-700"> · {t('wizard.onBehalf.tier')}</span>
          </div>
        )}

        {/* Step content */}
        <main className="flex-1 overflow-y-auto px-6 sm:px-10 py-8">
          <div className={cn("w-full mx-auto", measure)}>
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
          <div className={cn("w-full mx-auto flex items-center justify-end gap-3", measure)}>
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
                    {continueLabel ?? t('common.continue')}
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
