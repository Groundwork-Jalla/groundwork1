import { motion, AnimatePresence } from 'framer-motion';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import { useT, type TKey } from '@/lib/i18n';

/**
 * French uses the R+N convention (R+1 = ground plus one), which is what Cameroonian
 * drawings and BQs use — a literal "deux étages" would be ambiguous about the ground
 * floor. Hence keys rather than a number-to-word map.
 */
function useFloorLabel() {
  const t = useT();
  return (n: number) =>
    n >= 1 && n <= 8 ? t(`wizard.floors${n}` as TKey) : t('wizard.floorsN', { n });
}

// Stacked floor bars visual (compact version for the step panel)
function FloorStack({ floors }: { floors: number }) {
  const count = Math.min(floors, 8);
  return (
    <div className="flex items-end justify-center gap-0.5 h-20 mt-4">
      {Array.from({ length: count }, (_, i) => (
        <AnimatePresence key={i} mode="wait">
          <motion.div
            key={`bar-${i}-${count}`}
            // globals.css flips `.bg-white` and `.text-brand-near-black` in dark mode but
            // not `.bg-brand-near-black`, so a solid near-black block stays black on a
            // black ground. The bars have to invert explicitly.
            className="w-8 rounded-t-sm bg-brand-near-black dark:bg-white"
            style={{ height: `${(i + 1) * 9}%` }}
            initial={{ scaleY: 0, originY: 1 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: 0.2, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
          />
        </AnimatePresence>
      ))}
      <div className="absolute bottom-0 left-0 right-0" />
    </div>
  );
}

export default function Step4Floors() {
  const t = useT();
  const floorLabel = useFloorLabel();
  const { data, update, next } = useWizard();

  function setFloors(n: number) {
    const clamped = Math.max(1, Math.min(20, n));
    // Reset floorRooms so Step5 re-initialises tabs for the new count
    update({ floors: clamped, floorRooms: [] });
  }

  return (
    <WizardShell canContinue={data.floors >= 1} onContinue={next}>
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          {t('wizard.s4Title')}
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          {t('wizard.s4Sub')}
        </p>

        {/* Floor stack visual */}
        <div className="relative mt-10 mb-2 px-4">
          <FloorStack floors={data.floors} />
          <div className="h-px w-full bg-brand-border-grey dark:bg-[#3d3d3d] mt-1" />
        </div>

        {/* +/– Stepper */}
        <div className="mt-12 flex items-center justify-center gap-5">
          <button
            type="button"
            onClick={() => setFloors(data.floors - 1)}
            disabled={data.floors <= 1}
            className="flex items-center justify-center size-16 rounded-2xl border-2 border-brand-border-grey text-brand-near-black text-3xl font-light transition-all hover:border-brand-dark-grey hover:bg-brand-off-white disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2 dark:text-white dark:border-[#3d3d3d] dark:hover:bg-[#282828]"
            aria-label={t('wizard.decreaseFloors')}
          >
            −
          </button>

          <div className="flex flex-col items-center justify-center rounded-2xl bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black min-w-36 h-20 px-6">
            <AnimatePresence mode="wait">
              <motion.span
                key={data.floors}
                initial={{ y: -12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 12, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="text-4xl font-black tabular-nums leading-none"
              >
                {data.floors}
              </motion.span>
            </AnimatePresence>
            <span className="text-xs opacity-60 mt-1.5 font-medium">
              {data.floors === 1 ? 'floor' : 'floors'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setFloors(data.floors + 1)}
            disabled={data.floors >= 20}
            className="flex items-center justify-center size-16 rounded-2xl border-2 border-brand-border-grey text-brand-near-black text-3xl font-light transition-all hover:border-brand-dark-grey hover:bg-brand-off-white disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2 dark:text-white dark:border-[#3d3d3d] dark:hover:bg-[#282828]"
            aria-label={t('wizard.increaseFloors')}
          >
            +
          </button>
        </div>

        <p className="mt-5 text-center text-sm font-medium text-brand-mid-grey">
          {floorLabel(data.floors)}
        </p>
      </div>
    </WizardShell>
  );
}
