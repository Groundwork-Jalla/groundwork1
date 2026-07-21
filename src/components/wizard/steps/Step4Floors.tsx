import { motion, AnimatePresence } from 'framer-motion';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';

const FLOOR_LABELS: Record<number, string> = {
  1: 'Single storey',
  2: 'Two storeys',
  3: 'Three storeys',
  4: 'Four storeys',
  5: 'Five storeys',
  6: 'Six storeys',
  7: 'Seven storeys',
  8: 'Eight storeys',
};

function getLabel(n: number) {
  return FLOOR_LABELS[n] ?? `${n} storeys`;
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
            className="w-8 rounded-t-sm bg-brand-near-black"
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
          How many floors?
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          Include the ground floor. This affects structural estimates and staircase planning.
        </p>

        {/* Floor stack visual */}
        <div className="relative mt-10 mb-2 px-4">
          <FloorStack floors={data.floors} />
          <div className="h-px w-full bg-brand-border-grey mt-1" />
        </div>

        {/* +/– Stepper */}
        <div className="mt-12 flex items-center justify-center gap-5">
          <button
            type="button"
            onClick={() => setFloors(data.floors - 1)}
            disabled={data.floors <= 1}
            className="flex items-center justify-center size-16 rounded-2xl border-2 border-brand-border-grey text-brand-near-black text-3xl font-light transition-all hover:border-brand-dark-grey hover:bg-brand-off-white disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2 dark:text-white dark:border-[#3d3d3d] dark:hover:bg-[#282828]"
            aria-label="Decrease floors"
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
            aria-label="Increase floors"
          >
            +
          </button>
        </div>

        <p className="mt-5 text-center text-sm font-medium text-brand-mid-grey">
          {getLabel(data.floors)}
        </p>
      </div>
    </WizardShell>
  );
}
