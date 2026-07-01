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
          A boys' quarters (BQ) is a separate servant or staff accommodation attached to the main building.
        </p>

        {/* Yes / No cards */}
        <div className="mt-7 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => update({ hasBoysQuarters: true })}
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-xl border-2 py-8 transition-all duration-150',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2',
              data.hasBoysQuarters
                ? 'border-brand-near-black bg-brand-off-white'
                : 'border-brand-border-grey hover:border-brand-dark-grey',
            )}
          >
            {/* Small house + annex icon */}
            <svg viewBox="0 0 40 32" className="w-10 h-8" fill="none" aria-hidden="true">
              <rect x="2" y="16" width="22" height="14" rx="1" stroke="#0a0a0a" strokeWidth="1.3"/>
              <path d="M0 18 L13 6 L26 18" stroke="#0a0a0a" strokeWidth="1.3" strokeLinejoin="round"/>
              <rect x="6" y="20" width="5" height="5" rx="0.4" stroke="#0a0a0a" strokeWidth="1"/>
              <rect x="14" y="22" width="5" height="8" rx="0.4" stroke="#0a0a0a" strokeWidth="1.1"/>
              {/* BQ annex */}
              <rect x="26" y="20" width="12" height="10" rx="0.5" stroke="#0a0a0a" strokeWidth="1" strokeOpacity="0.65"/>
              <path d="M25 22 L32 14 L39 22" stroke="#0a0a0a" strokeWidth="1" strokeOpacity="0.65" fill="none"/>
              <line x1="24" y1="22" x2="40" y2="22" stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.4"/>
            </svg>
            <span className="text-sm font-semibold text-brand-near-black">Yes</span>
            <span className="text-xs text-brand-mid-grey text-center px-3">Include a staff annex</span>
          </button>

          <button
            type="button"
            onClick={() => update({ hasBoysQuarters: false, bqRooms: 1 })}
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-xl border-2 py-8 transition-all duration-150',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2',
              !data.hasBoysQuarters
                ? 'border-brand-near-black bg-brand-off-white'
                : 'border-brand-border-grey hover:border-brand-dark-grey',
            )}
          >
            {/* Single house icon */}
            <svg viewBox="0 0 40 32" className="w-10 h-8" fill="none" aria-hidden="true">
              <rect x="6" y="14" width="28" height="16" rx="1" stroke="#0a0a0a" strokeWidth="1.3"/>
              <path d="M4 16 L20 4 L36 16" stroke="#0a0a0a" strokeWidth="1.3" strokeLinejoin="round"/>
              <rect x="9"  y="18" width="7" height="6" rx="0.4" stroke="#0a0a0a" strokeWidth="1"/>
              <rect x="24" y="18" width="7" height="6" rx="0.4" stroke="#0a0a0a" strokeWidth="1"/>
              <rect x="16" y="22" width="8" height="8" rx="0.4" stroke="#0a0a0a" strokeWidth="1.1"/>
            </svg>
            <span className="text-sm font-semibold text-brand-near-black">No</span>
            <span className="text-xs text-brand-mid-grey text-center px-3">Main building only</span>
          </button>
        </div>

        {/* Room count — shown only when Yes is selected */}
        <AnimatePresence>
          {data.hasBoysQuarters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-5 rounded-xl border border-brand-border-grey">
                <Stepper
                  label="Number of BQ rooms"
                  sublabel="Each room includes a bathroom"
                  value={data.bqRooms}
                  onChange={v => update({ bqRooms: v })}
                  min={1}
                  max={6}
                />
              </div>
              <p className="mt-2 text-xs text-brand-mid-grey text-center">
                Adds ~$8,000 per room to the budget estimate
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </WizardShell>
  );
}
