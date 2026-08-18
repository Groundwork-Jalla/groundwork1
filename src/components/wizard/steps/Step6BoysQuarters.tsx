import { motion, AnimatePresence } from 'framer-motion';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

export default function Step6BoysQuarters() {
  const t = useT();
  const { data, update, next } = useWizard();

  return (
    <WizardShell canContinue={true} onContinue={next}>
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          {t('wizard.s6Title')}
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          {t('wizard.s6Sub')}
        </p>

        {/* Pill toggle */}
        <div className="mt-8 inline-flex rounded-xl border border-brand-border-grey overflow-hidden">
          <button
            type="button"
            onClick={() => update({ hasBoysQuarters: true })}
            className={cn(
              'px-8 py-3 text-sm font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-inset',
              data.hasBoysQuarters
                ? 'bg-brand-near-black text-white dark:bg-white dark:text-brand-near-black'
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
                ? 'bg-brand-near-black text-white dark:bg-white dark:text-brand-near-black'
                : 'bg-white text-brand-mid-grey hover:text-brand-near-black',
            )}
          >
            No
          </button>
        </div>

        {/*
          A room-count stepper used to live here, priced at $8,000/room. That figure had
          no Bill of Quantity behind it, so both it and the stepper are gone: the answer
          is recorded for the build brief, and the note below says plainly that it is not
          in the price rather than letting someone assume it is.
        */}
        <AnimatePresence>
          {data.hasBoysQuarters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <p className="mt-6 rounded-xl bg-brand-off-white px-4 py-3 text-xs leading-relaxed text-brand-mid-grey">
                {t('wizard.bqCost')}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </WizardShell>
  );
}
