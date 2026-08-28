import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb } from 'lucide-react';
import WizardShell from '../WizardShell';
import { useWizard } from '@/contexts/WizardContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FinishLevel, WizardFormData } from '@/types/project';
import { BASELINE_CITY, CITY_RATES, CM_CITY_CODES, hasFloorRooms } from '@/lib/budget';
import { cn } from '@/lib/utils';
import { useT, useLanguage } from '@/lib/i18n';
import { useDomainLabels } from '@/lib/domain-labels';

const FINISH_LEVELS: { value: FinishLevel; label: string; description: string }[] = [
  { value: 'standard', label: 'Standard',  description: 'Good quality, practical finishes'     },
  { value: 'premium',  label: 'Premium',   description: 'High-spec fittings and materials'     },
  { value: 'luxury',   label: 'Luxury',    description: 'Bespoke finishes, premium everything' },
];

// ── Footprint estimation ───────────────────────────────────────
//
// Room benchmark sizes (sqm). Recalibrated Aug 2026 against Vanessa Gwanvoma's review:
// the previous set (bed 14, bath 5.5, living 26, kitchen 13, circ 1.22) suggested ~95
// sqm/floor for a 5-bed 2-storey semi-detached where she puts the real figure at 120.
// They were UK-flat sizes applied to Cameroonian houses, which are built wider.
//
// Worked check for that case:
//   (5x17 + 5x6 + 2x32 + 15) x 1.30 x 0.95 / 2 = 119.8  ->  120 ✓
const SQM = { bed: 17, bath: 6, living: 32, kitchen: 15, office: 12 };
// +30% for circulation: corridors, landings, stairs, wall thickness
const CIRC = 1.30;

interface SqmEstimate {
  min: number;
  max: number;
  typical: number;
  label: string;   // human-readable building descriptor
}

/**
 * Estimates the GROUND FLOOR FOOTPRINT, not the combined area of every floor.
 *
 * This used to return the combined area while the budget engine treated the same number
 * as a footprint and then added a per-floor uplift on top — so a G+1 was counted close
 * to twice. The engine is calibrated against BQ footprints (slab volume ÷ 0.12), so
 * footprint is the figure that has to come out of here.
 */
export function estimateSqm(data: WizardFormData): SqmEstimate | null {
  // Aggregate room counts across all floors.
  // `hasFloorRooms` is shared with geometry.ts — this file used to write its own version
  // that omitted bathrooms, so a floor holding only bathrooms counted in one place and
  // not the other.
  const hasFR = hasFloorRooms(data);

  const beds    = hasFR ? data.floorRooms.reduce((s, f) => s + f.bedrooms,        0) : data.bedrooms;
  const baths   = hasFR ? data.floorRooms.reduce((s, f) => s + f.bathrooms,       0) : data.bathrooms;
  const livings = hasFR ? data.floorRooms.reduce((s, f) => s + f.livingRooms,     0) : data.livingRooms;
  const kitch   = hasFR ? data.floorRooms.reduce((s, f) => s + f.kitchens,        0) : data.kitchens;
  const offices = hasFR ? data.floorRooms.reduce((s, f) => s + (f.offices ?? 0),  0) : (data.offices ?? 0);

  if (beds === 0 && livings === 0) return null;

  // Type-based multiplier
  const mult =
    data.buildingType === 'multi_family'     ? 0.88 :
    data.buildingType === 'townhouse'        ? 0.92 :
    data.buildingType === 'semi_detached'    ? 0.95 :
    data.buildingType === 'office'           ? 1.40 :
    data.buildingType === 'retail'           ? 1.20 : 1.00;

  const floors  = Math.max(1, data.floors);
  const raw     = beds * SQM.bed + baths * SQM.bath + livings * SQM.living
                + kitch * SQM.kitchen + offices * SQM.office;
  // Those rooms are spread over every storey; the footprint is one storey's worth.
  const typical = Math.round((raw * CIRC * mult / floors) / 5) * 5;
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

const isKnownCity = (city: string) =>
  CM_CITY_CODES.some(code => CITY_RATES[code].city_name === city);

export default function Step8Details() {
  const t = useT();
  const { tPlural } = useLanguage();
  // Whichever city the rate book is currently based on.
  const baselineCityName = CITY_RATES[BASELINE_CITY]?.city_name ?? BASELINE_CITY;
  const { country } = useDomainLabels();
  const { data, update, next } = useWizard();
  const [sqmStr, setSqmStr] = useState(data.sqm > 0 ? String(data.sqm) : '');

  // Only Cameroon has a real city rate book so far. Everywhere else keeps free text.
  const showCityPicker = data.country === 'CM';
  const [cityOther, setCityOther] = useState(
    () => showCityPicker && data.city.length > 0 && !isKnownCity(data.city),
  );

  // Footprint is required, not optional. It was labelled "(optional)" and not gated,
  // so someone could continue without it and reach a budget computed from a zero-sized
  // building — Favour: "you need to pick the square meter for the budget to be
  // calculated". Nothing downstream can price a build without an area.
  const canContinue =
    data.projectName.trim().length >= 2 &&
    data.city.trim().length >= 2 &&
    (data.sqm ?? 0) > 0;

  const estimate = estimateSqm(data);

  // The footprint is derived from what they told us they are building — Favour: "the sqm
  // is calculated based on what the client is building". So it is filled in from the room
  // schedule rather than asked for, and re-derived if they go back and change the rooms.
  //
  // Still editable, and an edit is final: `chosen` latches the moment they type, so a
  // later trip through the room steps cannot overwrite a figure they set deliberately.
  // It starts latched for a project that already has one.
  const chosen = useRef((data.sqm ?? 0) > 0);

  useEffect(() => {
    if (chosen.current || !estimate) return;
    if (data.sqm === estimate.typical) return;
    setSqmStr(String(estimate.typical));
    update({ sqm: estimate.typical });
  }, [estimate?.typical, data.sqm, update, estimate]);

  function handleSqmChange(val: string) {
    chosen.current = true;
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
          {t('wizard.s8Title')}
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          {t('wizard.s8Sub')}
        </p>

        <div className="mt-8 space-y-5">
          {/* Project name */}
          <div className="space-y-1.5">
            <Label htmlFor="project-name" className="text-sm font-medium text-brand-near-black">
              {t('wizard.projectName')}
            </Label>
            <Input
              id="project-name"
              type="text"
              placeholder={t('wizardFields.projectNamePlaceholder')}
              value={data.projectName}
              onChange={e => update({ projectName: e.target.value })}
              autoComplete="off"
            />
          </div>

          {/* City / location */}
          <div className="space-y-1.5">
            <Label htmlFor="city" className="text-sm font-medium text-brand-near-black">
              {t('wizard.cityLocation')}
            </Label>
            {showCityPicker ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {CM_CITY_CODES.map(code => {
                    const c = CITY_RATES[code];
                    const active = !cityOther && data.city === c.city_name;
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => { setCityOther(false); update({ city: c.city_name }); }}
                        className={cn(
                          'flex flex-col items-start rounded-xl border-2 px-3 py-2 transition-all duration-150',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2',
                          active
                            ? 'border-brand-near-black bg-brand-off-white'
                            : 'border-brand-border-grey hover:border-brand-dark-grey',
                        )}
                      >
                        <span className="text-sm font-semibold text-brand-near-black">{c.city_name}</span>
                        {/*
                          `cost_delta_pct`, not `index_vs_baseline`. The index only
                          scales non-concrete trades, so it is not what the build
                          actually costs here — showing it told a Limbe client "+6%
                          materials" for a city that is 3% cheaper overall. The delta is
                          Vanessa's stated whole-building figure and is what they pay.
                        */}
                        <span className="text-[10px] text-brand-mid-grey tabular-nums">
                          {c.cost_delta_pct == null
                            ? ''
                            : c.cost_delta_pct === 0
                              ? t('wizard.city.baseline')
                              : t('wizard.city.delta', {
                                  sign: c.cost_delta_pct > 0 ? '+' : '−',
                                  pct:  Math.abs(c.cost_delta_pct),
                                })}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => { setCityOther(true); update({ city: '' }); }}
                    className={cn(
                      'flex flex-col items-start rounded-xl border-2 px-3 py-2 transition-all duration-150',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2',
                      cityOther
                        ? 'border-brand-near-black bg-brand-off-white'
                        : 'border-brand-border-grey hover:border-brand-dark-grey',
                    )}
                  >
                    <span className="text-sm font-semibold text-brand-near-black">{t('wizard.otherCity')}</span>
                    {/* Named from BASELINE_CITY, not written into the copy. This said
                        "Douala rates" until migration 045 moved the Cameroon baseline to
                        Yaoundé and left the label behind — visible on screen, quietly
                        wrong, and the kind of thing a contractor notices. */}
                    <span className="text-[10px] text-brand-mid-grey">
                      {t('wizard.baselineRates', { city: baselineCityName })}
                    </span>
                  </button>
                </div>
                {cityOther && (
                  <Input
                    id="city"
                    type="text"
                    autoFocus
                    placeholder={t('wizardFields.cityPlaceholder')}
                    value={isKnownCity(data.city) ? '' : data.city}
                    onChange={e => update({ city: e.target.value })}
                  />
                )}
                <p className="text-xs text-brand-mid-grey">{t('wizard.cityVariance')}</p>
              </>
            ) : (
              <Input
                id="city"
                type="text"
                placeholder={t('wizard.cityPlaceholder', { country: country(data.country || 'CM') })}
                value={data.city}
                onChange={e => update({ city: e.target.value })}
              />
            )}
          </div>

          {/* Ground floor footprint */}
          <div className="space-y-1.5">
            <Label htmlFor="sqm" className="text-sm font-medium text-brand-near-black">
              {t('wizard.footprintLabel')}
              <span className="text-state-alert">*</span>
            </Label>
            <div className="relative">
              <Input
                id="sqm"
                type="number"
                min={10}
                max={50000}
                placeholder={estimate ? `e.g. ${estimate.typical}` : 'e.g. 125'}
                value={sqmStr}
                onChange={e => handleSqmChange(e.target.value)}
                className="pr-14"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-brand-mid-grey select-none pointer-events-none">
                sqm
              </span>
            </div>
            <p className="text-xs text-brand-mid-grey">
              {/* Say where the number came from. A field that fills itself and does not
                  explain why reads as a bug, and this one is editable. */}
              {!chosen.current && (data.sqm ?? 0) > 0
                ? t('wizard.footprintDerived')
                : t('wizard.footprintHint')}
            </p>
            {/* Shown only while empty. A required field with a known good answer beside
                it should let someone take that answer in one tap rather than retype the
                number from the hint card below. */}
            {!((data.sqm ?? 0) > 0) && (
              <div className="flex items-center gap-2">
                <p className="text-xs text-state-alert">{t('wizard.footprintRequired')}</p>
                {estimate && (
                  <button
                    type="button"
                    onClick={applyEstimate}
                    className="shrink-0 rounded-lg border border-brand-border-grey px-2 py-1 text-[11px] font-semibold text-brand-near-black transition-colors hover:border-brand-near-black"
                  >
                    {t('wizard.footprintUse', { sqm: estimate.typical })}
                  </button>
                )}
              </div>
            )}

            {/* Derived total built area — read-only, so the two figures can't drift */}
            {data.sqm > 0 && (
              <div className="flex items-center justify-between rounded-lg bg-brand-off-white px-3 py-2">
                <span className="text-xs text-brand-mid-grey">
                  {tPlural('wizard.builtAreaAcross', data.floors, { count: data.floors })}
                </span>
                <span className="text-xs font-semibold text-brand-near-black tabular-nums">
                  {(data.sqm * Math.max(1, data.floors)).toLocaleString()} sqm
                </span>
              </div>
            )}

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
                        Typical footprint for a {estimate.label}
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
              {t('wizard.finishLevel')}
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
