import { motion, AnimatePresence } from 'framer-motion';
import WizardShell from '../WizardShell';
import Stepper from '../Stepper';
import { useWizard } from '@/contexts/WizardContext';
import { cn } from '@/lib/utils';

export default function Step6BoysQuarters() {
  const { data, update, next } = useWizard();

  return (
    <WizardShell canContinue={true} onContinue={next}>
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          Will there be a boys' quarters?
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          A boys' quarters (BQ) is a separate staff or servant accommodation attached to the main building.
        </p>

        {/* Pill toggle */}
        <div className="mt-8 inline-flex rounded-xl border border-brand-border-grey overflow-hidden">
          <button
            type="button"
            onClick={() => update({ hasBoysQuarters: true })}
            className={cn(
              'px-8 py-3 text-sm font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-inset',
              data.hasBoysQuarters
                ? 'bg-brand-near-black text-white'
                : 'bg-white text-brand-mid-grey hover:text-brand-near-black',
            )}
          >
            Yes
          </button>
          <div className="w-px bg-brand-border-grey" />
          <button
            type="button"
            onClick={() => update({ hasBoysQuarters: false, bqRooms: 1 })}
            className={cn(
              'px-8 py-3 text-sm font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-inset',
              !data.hasBoysQuarters
                ? 'bg-brand-near-black text-white'
                : 'bg-white text-brand-mid-grey hover:text-brand-near-black',
            )}
          >
            No
          </button>
        </div>

        {/* BQ room count — shown only when Yes */}
        <AnimatePresence>
          {data.hasBoysQuarters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-6 rounded-xl border border-brand-border-grey">
                <Stepper
                  label="Number of BQ rooms"
                  sublabel="Each room includes a bathroom"
                  value={data.bqRooms}
                  onChange={v => update({ bqRooms: v })}
                  min={1}
                  max={6}
                />
              </div>
              <p className="mt-2 text-xs text-brand-mid-grey">
                Adds ~$8,000 per room to the budget estimate
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </WizardShell>
  );
}
