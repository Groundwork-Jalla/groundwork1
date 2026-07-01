import WizardShell from '../WizardShell';
import Stepper from '../Stepper';
import { useWizard } from '@/contexts/WizardContext';

export default function Step5Rooms() {
  const { data, update, next } = useWizard();

  return (
    <WizardShell canContinue={true} onContinue={next}>
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          How many rooms?
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          Your room count shapes the floor plan layout and materials estimate.
        </p>

        <div className="mt-8 rounded-xl border border-brand-border-grey divide-y divide-brand-border-grey overflow-hidden">
          <Stepper
            label="Bedrooms"
            sublabel="Including master bedroom"
            value={data.bedrooms}
            onChange={v => update({ bedrooms: v })}
            min={0}
            max={20}
          />
          <Stepper
            label="Bathrooms"
            sublabel="Including en-suite bathrooms"
            value={data.bathrooms}
            onChange={v => update({ bathrooms: v })}
            min={0}
            max={20}
          />
          <Stepper
            label="Living Areas"
            sublabel="Sitting rooms & lounges"
            value={data.livingRooms}
            onChange={v => update({ livingRooms: v })}
            min={0}
            max={5}
          />
          <Stepper
            label="Kitchens"
            value={data.kitchens}
            onChange={v => update({ kitchens: v })}
            min={1}
            max={5}
          />
        </div>

        {/* Summary pill */}
        <div className="mt-5 flex flex-wrap gap-2">
          {[
            { count: data.bedrooms,   unit: 'bed'    },
            { count: data.bathrooms,  unit: 'bath'   },
            { count: data.livingRooms,unit: 'living' },
            { count: data.kitchens,   unit: 'kitchen'},
          ].map(({ count, unit }) => (
            <span
              key={unit}
              className="inline-flex items-center gap-1 rounded-full bg-brand-off-white border border-brand-border-grey px-3 py-1 text-xs font-medium text-brand-near-black"
            >
              <span className="font-bold">{count}</span>
              <span className="text-brand-mid-grey">{count === 1 ? unit : `${unit}s`}</span>
            </span>
          ))}
        </div>
      </div>
    </WizardShell>
  );
}
