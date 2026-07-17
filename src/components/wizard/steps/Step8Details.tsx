import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb } from 'lucide-react';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FinishLevel, WizardFormData } from '@/types/project';
import { cn } from '@/lib/utils';

const FINISH_LEVELS: { value: FinishLevel; label: string; description: string }[] = [
  { value: 'standard', label: 'Standard',  description: 'Good quality, practical finishes'     },
  { value: 'premium',  label: 'Premium',   description: 'High-spec fittings and materials'     },
  { value: 'luxury',   label: 'Luxury',    description: 'Bespoke finishes, premium everything' },
];

// ── Sqm estimation ─────────────────────────────────────────────
// Room benchmark sizes (sqm) — based on common African/UK residential standards
const SQM = { bed: 14, bath: 5.5, living: 26, kitchen: 13 };
// +22% for circulation: corridors, landings, stairs, wall thickness
const CIRC = 1.22;

interface SqmEstimate {
  min: number;
  max: number;
  typical: number;
  label: string;   // human-readable building descriptor
}

function estimateSqm(data: WizardFormData): SqmEstimate | null {
  // Aggregate room counts across all floors
  const hasFR = data.floorRooms.length > 0 &&
    data.floorRooms.some(f => f.bedrooms + f.livingRooms + f.kitchens > 0);

  const beds    = hasFR ? data.floorRooms.reduce((s, f) => s + f.bedrooms,    0) : data.bedrooms;
  const baths   = hasFR ? data.floorRooms.reduce((s, f) => s + f.bathrooms,   0) : data.bathrooms;
  const livings = hasFR ? data.floorRooms.reduce((s, f) => s + f.livingRooms, 0) : data.livingRooms;
  const kitch   = hasFR ? data.floorRooms.reduce((s, f) => s + f.kitchens,    0) : data.kitchens;

  if (beds === 0 && livings === 0) return null;

  // Type-based multiplier
  const mult =
    data.buildingType === 'multi_family'     ? 0.88 :
    data.buildingType === 'townhouse'        ? 0.92 :
    data.buildingType === 'semi_detached'    ? 0.95 :
    data.buildingType === 'office'           ? 1.40 :
    data.buildingType === 'retail'           ? 1.20 : 1.00;

  const raw     = beds * SQM.bed + baths * SQM.bath + livings * SQM.living + kitch * SQM.kitchen;
  const typical = Math.round((raw * CIRC * mult) / 5) * 5;
  const min     = Math.round((typical * 0.80) / 5) * 5;
  const max     = Math.round((typical * 1.30) / 5) * 5;

  // Build a descriptive label
  const fl    = data.floors;
  const story = fl === 1 ? 'bungalow' : fl === 2 ? '2-storey' : `${fl}-storey`;
  const bText = beds === 1 ? '1 bedroom' : `${beds}-bedroom`;
  const typeLabel =
    data.buildingType === 'townhouse'   ? 'townhouse' :
    data.buildingType === 'semi_detached' ? 'semi-detached' :
    data.buildingType === 'multi_family' ? 'multi-family block' :
    data.buildingType === 'office'      ? 'office building' :
    'house';

  return { min, max, typical, label: `${bText} ${story} ${typeLabel}` };
}

export default function Step8Details() {
  const { data, update, next } = useWizard();
  const [sqmStr, setSqmStr] = useState(data.sqm > 0 ? String(data.sqm) : '');

  const canContinue =
    data.projectName.trim().length >= 2 &&
    data.city.trim().length >= 2;

  const estimate = estimateSqm(data);

  function handleSqmChange(val: string) {
    setSqmStr(val);
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0) update({ sqm: n });
  }

  function applyEstimate() {
    if (!estimate) return;
    setSqmStr(String(estimate.typical));
    update({ sqm: estimate.typical });
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
              Total floor area{' '}
              <span className="font-normal text-brand-mid-grey">(optional)</span>
            </Label>
            <div className="relative">
              <Input
                id="sqm"
                type="number"
                min={10}
                max={50000}
                placeholder={estimate ? `e.g. ${estimate.typical}` : 'e.g. 250'}
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

            {/* Smart estimate hint */}
            <AnimatePresence>
              {estimate && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="rounded-xl border border-brand-border-grey bg-brand-off-white p-3.5"
                >
                  <div className="flex items-start gap-2.5">
                    <Lightbulb className="size-4 shrink-0 mt-0.5 text-brand-near-black opacity-60" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-brand-near-black leading-snug">
                        Typical size for a {estimate.label}
                      </p>
                      <p className="mt-0.5 text-xs text-brand-mid-grey leading-relaxed">
                        Based on your room layout, expect somewhere between{' '}
                        <span className="font-semibold text-brand-near-black">
                          {estimate.min}–{estimate.max} sqm
                        </span>
                        . Most similar projects land around{' '}
                        <span className="font-semibold text-brand-near-black">
                          {estimate.typical} sqm
                        </span>
                        .
                      </p>
                      {/* Range bar */}
                      <div className="mt-2.5 relative h-1.5 rounded-full bg-brand-border-grey overflow-hidden">
                        <div className="absolute inset-y-0 left-0 right-0 flex items-center">
                          {/* Typical marker */}
                          <div
                            className="absolute h-3 w-0.5 bg-brand-near-black rounded-full -translate-y-px"
                            style={{ left: `${((estimate.typical - estimate.min) / (estimate.max - estimate.min)) * 100}%` }}
                          />
                          {/* Range fill */}
                          <div className="absolute inset-y-0 rounded-full bg-brand-near-black opacity-15" style={{ left: 0, right: 0 }} />
                        </div>
                        {/* Current value indicator */}
                        {data.sqm > 0 && data.sqm >= estimate.min && data.sqm <= estimate.max && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="absolute inset-y-0 rounded-full bg-brand-near-black"
                            style={{
                              left: 0,
                              width: `${Math.min(100, ((data.sqm - estimate.min) / (estimate.max - estimate.min)) * 100)}%`,
                              opacity: 0.45,
                            }}
                          />
                        )}
                      </div>
                      <div className="mt-1 flex justify-between text-[9px] text-brand-mid-grey">
                        <span>{estimate.min} sqm</span>
                        <span>{estimate.max} sqm</span>
                      </div>

                      {/* Apply button */}
                      {!sqmStr && (
                        <button
                          type="button"
                          onClick={applyEstimate}
                          className="mt-2 text-[11px] font-semibold text-brand-near-black underline underline-offset-2 hover:opacity-70 transition-opacity"
                        >
                          Use {estimate.typical} sqm as my estimate
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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
