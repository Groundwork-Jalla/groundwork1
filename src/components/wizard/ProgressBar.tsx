import { motion } from 'framer-motion';
import { useWizard } from '@/contexts/WizardContext';
import { useT, type TKey } from '@/lib/i18n';

/**
 * One key per wizard step, in order. This list had nine entries against eleven steps —
 * "Summary" was never listed and the new "Confirm budget" step was added later — so the
 * last two rendered the bare fallback "Step 10" / "Step 11".
 */
const STEP_KEYS: TKey[] = [
  'wizard.stepLocation',
  'wizard.stepProjectType',
  'wizard.stepBuilding',
  'wizard.stepFloors',
  'wizard.stepRooms',
  'wizard.stepQuarters',
  'wizard.stepRoof',
  'wizard.stepDetails',
  'wizard.stepSummary',
  'wizard.stepPlan',
  'wizard.stepConfirm',
];

export default function ProgressBar() {
  const t = useT();
  const { step, totalSteps, goTo } = useWizard();
  const pct = ((step - 1) / (totalSteps - 1)) * 100;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium text-brand-mid-grey">
          {STEP_KEYS[step - 1] ? t(STEP_KEYS[step - 1]) : t('wizard.stepN', { n: step })}
        </span>
        <span className="text-[11px] font-medium text-brand-mid-grey tabular-nums">
          {step} / {totalSteps}
        </span>
      </div>

      {/* Track */}
      <div className="relative h-1.5 w-full rounded-full bg-brand-border-grey overflow-visible">
        {/* Fill */}
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-brand-near-black"
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        />

        {/* Building icon at the fill edge */}
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10"
          animate={{ left: `${pct}%` }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          <svg viewBox="0 0 16 20" className="w-4 h-5 drop-shadow-sm" fill="none" aria-hidden="true">
            <rect x="2" y="8" width="12" height="11" rx="0.8" fill="#0a0a0a" />
            <rect x="4" y="10.5" width="2.5" height="2" rx="0.3" fill="white" fillOpacity="0.7" />
            <rect x="9.5" y="10.5" width="2.5" height="2" rx="0.3" fill="white" fillOpacity="0.7" />
            <rect x="4" y="14" width="2.5" height="2" rx="0.3" fill="white" fillOpacity="0.7" />
            <rect x="9.5" y="14" width="2.5" height="2" rx="0.3" fill="white" fillOpacity="0.7" />
            <rect x="6" y="15" width="4" height="4" rx="0.3" fill="white" fillOpacity="0.5" />
            <path d="M1 9 L8 2 L15 9" fill="#0a0a0a" />
          </svg>
        </motion.div>
      </div>

      {/* Clickable step dots below the bar */}
      <div className="flex justify-between mt-2.5 px-0">
        {Array.from({ length: totalSteps }, (_, i) => {
          const n = i + 1;
          const done = n < step;
          return (
            <button
              key={n}
              type="button"
              disabled={!done}
              onClick={() => done && goTo(n)}
              aria-label={t('wizard.goToStep', { n, label: STEP_KEYS[i] ? t(STEP_KEYS[i]) : String(n) })}
              className="w-1 h-1 rounded-full transition-colors disabled:cursor-default focus:outline-none"
              style={{
                background: n <= step ? '#0a0a0a' : '#e5e5e5',
                opacity: n < step ? 0.7 : n === step ? 1 : 0.4,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
