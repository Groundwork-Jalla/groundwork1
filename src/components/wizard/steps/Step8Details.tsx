import { useState } from 'react';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FinishLevel } from '@/types/project';
import { cn } from '@/lib/utils';

const FINISH_LEVELS: { value: FinishLevel; label: string; description: string }[] = [
  { value: 'standard', label: 'Standard',  description: 'Good quality, practical finishes'     },
  { value: 'premium',  label: 'Premium',   description: 'High-spec fittings and materials'     },
  { value: 'luxury',   label: 'Luxury',    description: 'Bespoke finishes, premium everything' },
];

export default function Step8Details() {
  const { data, update, next } = useWizard();
  const [sqmStr, setSqmStr] = useState(data.sqm > 0 ? String(data.sqm) : '');

  const canContinue =
    data.projectName.trim().length >= 2 &&
    data.city.trim().length >= 2 &&
    data.sqm > 0;

  function handleSqmChange(val: string) {
    setSqmStr(val);
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0) update({ sqm: n });
  }

  return (
    <WizardShell canContinue={canContinue} onContinue={next}>
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          Tell us about your project
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          These details anchor your project in the Groundwork dashboard.
        </p>

        <div className="mt-8 space-y-5">
          {/* Project name */}
          <div className="space-y-1.5">
            <Label htmlFor="project-name" className="text-sm font-medium text-brand-near-black">
              Project name
            </Label>
            <Input
              id="project-name"
              type="text"
              placeholder="e.g. Lekki Duplex Phase 2"
              value={data.projectName}
              onChange={e => update({ projectName: e.target.value })}
              autoComplete="off"
            />
          </div>

          {/* City / location */}
          <div className="space-y-1.5">
            <Label htmlFor="city" className="text-sm font-medium text-brand-near-black">
              City / location
            </Label>
            <Input
              id="city"
              type="text"
              placeholder={`e.g. Lagos, ${data.countryName || 'Nigeria'}`}
              value={data.city}
              onChange={e => update({ city: e.target.value })}
            />
          </div>

          {/* Floor area */}
          <div className="space-y-1.5">
            <Label htmlFor="sqm" className="text-sm font-medium text-brand-near-black">
              Total floor area
            </Label>
            <div className="relative">
              <Input
                id="sqm"
                type="number"
                min={10}
                max={50000}
                placeholder="e.g. 250"
                value={sqmStr}
                onChange={e => handleSqmChange(e.target.value)}
                className="pr-14"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-brand-mid-grey select-none pointer-events-none">
                sqm
              </span>
            </div>
            <p className="text-xs text-brand-mid-grey">
              Combined area of all floors, excluding the boys' quarters
            </p>
          </div>

          {/* Finish level */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-brand-near-black">
              Finish level
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {FINISH_LEVELS.map(fl => (
                <button
                  key={fl.value}
                  type="button"
                  onClick={() => update({ finishLevel: fl.value })}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-xl border-2 py-3 px-2 transition-all duration-150',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2',
                    data.finishLevel === fl.value
                      ? 'border-brand-near-black bg-brand-off-white'
                      : 'border-brand-border-grey hover:border-brand-dark-grey',
                  )}
                >
                  <span className="text-sm font-semibold text-brand-near-black">{fl.label}</span>
                  <span className="text-[10px] text-brand-mid-grey text-center leading-tight">{fl.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Target start date — optional */}
          <div className="space-y-1.5">
            <Label htmlFor="start-date" className="text-sm font-medium text-brand-near-black">
              Target start date{' '}
              <span className="font-normal text-brand-soft-grey">(optional)</span>
            </Label>
            <Input
              id="start-date"
              type="date"
              value={data.targetStartDate}
              onChange={e => update({ targetStartDate: e.target.value })}
            />
          </div>
        </div>
      </div>
    </WizardShell>
  );
}
