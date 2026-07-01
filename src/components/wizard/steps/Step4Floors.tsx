import { motion } from 'framer-motion';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import { cn } from '@/lib/utils';

const FLOOR_OPTIONS = [
  { value: 1, label: '1 Floor',  sublabel: 'Single storey'    },
  { value: 2, label: '2 Floors', sublabel: 'Two storey'       },
  { value: 3, label: '3 Floors', sublabel: 'Three storey'     },
  { value: 4, label: '4 Floors', sublabel: 'Four storey'      },
  { value: 5, label: '5+',       sublabel: 'High rise / Multi'},
];

// Floor counter visual
function FloorVisual({ floors }: { floors: number }) {
  return (
    <div className="relative flex items-end justify-center gap-0.5 h-16">
      {Array.from({ length: Math.min(floors, 5) }).map((_, i) => (
        <motion.div
          key={i}
          layoutId={`floor-bar-${i}`}
          className="w-9 rounded-t-sm bg-brand-near-black"
          style={{ height: `${(i + 1) * 11}px` }}
          initial={{ scaleY: 0, originY: 1 }}
          animate={{ scaleY: 1, originY: 1 }}
          transition={{ duration: 0.22, delay: i * 0.05 }}
        />
      ))}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-brand-border-grey" />
    </div>
  );
}

export default function Step4Floors() {
  const { data, update, next } = useWizard();

  return (
    <WizardShell canContinue={data.floors >= 1} onContinue={next}>
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          How many floors?
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          Include the ground floor. This affects structural estimates and staircase planning.
        </p>

        {/* Visual */}
        <div className="mt-7 mb-6 px-4">
          <FloorVisual floors={data.floors} />
        </div>

        {/* Options grid */}
        <div className="grid grid-cols-5 gap-2">
          {FLOOR_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => update({ floors: opt.value })}
              className={cn(
                'flex flex-col items-center justify-center rounded-xl border-2 py-4 px-1 transition-all duration-150',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2',
                data.floors === opt.value
                  ? 'border-brand-near-black bg-brand-off-white'
                  : 'border-brand-border-grey hover:border-brand-dark-grey',
              )}
            >
              <span className="text-base font-bold text-brand-near-black">{opt.label}</span>
              <span className="text-[10px] text-brand-mid-grey mt-0.5 text-center leading-tight">
                {opt.sublabel}
              </span>
            </button>
          ))}
        </div>

        {/* Manual input for 5+ */}
        {data.floors >= 5 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 flex items-center gap-3"
          >
            <span className="text-sm text-brand-mid-grey">Exact number:</span>
            <input
              type="number"
              min={5}
              max={50}
              value={data.floors}
              onChange={e => update({ floors: Math.max(5, parseInt(e.target.value) || 5) })}
              className="w-20 rounded-lg border border-brand-border-grey px-3 py-1.5 text-sm text-brand-near-black focus:outline-none focus:ring-2 focus:ring-brand-near-black/30 focus:border-brand-near-black"
            />
          </motion.div>
        )}
      </div>
    </WizardShell>
  );
}
