import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import WizardShell from '../WizardShell';
import { countOpenings } from '@/lib/budget';
import Stepper from '../Stepper';
import { useWizard } from '@/contexts/WizardContext';
import { cn } from '@/lib/utils';
import type { FloorRoom } from '@/types/project';
import { useLanguage, type TKey } from '@/lib/i18n';

function floorLabel(index: number) {
  return index === 0 ? 'GF' : `F${index}`;
}

/**
 * The room types a floor is composed of, in the order they are asked for.
 *
 * Declared once and iterated rather than written out five times: the steppers, the
 * cross-floor totals and `computeTotals` all derive from this list, so adding a sixth
 * type is one entry rather than four edits that can disagree.
 *
 * `offices` was added Aug 2026 and is absent from FloorRoom rows written before then —
 * hence the `?? 0` at every read.
 */
const ROOM_TYPES = [
  { field: 'bedrooms',    labelKey: 'wizardFields.bedrooms',    subKey: 'wizard.rooms.bedroomsSub',    unitKey: 'wizard.rooms.unitBed',     max: 20 },
  { field: 'bathrooms',   labelKey: 'wizardFields.bathrooms',   subKey: 'wizard.rooms.bathroomsSub',   unitKey: 'wizard.rooms.unitBath',    max: 20 },
  { field: 'livingRooms', labelKey: 'wizardFields.livingAreas', subKey: 'wizard.rooms.livingSub',      unitKey: 'wizard.rooms.unitLiving',  max: 5  },
  { field: 'kitchens',    labelKey: 'wizardFields.kitchens',    subKey: 'wizard.rooms.kitchensSub',    unitKey: 'wizard.rooms.unitKitchen', max: 5  },
  { field: 'offices',     labelKey: 'wizardFields.offices',     subKey: 'wizard.rooms.officesSub',     unitKey: 'wizard.rooms.unitOffice',  max: 10 },
] as const satisfies readonly {
  field: keyof Omit<FloorRoom, 'floor'>;
  labelKey: TKey; subKey: TKey; unitKey: TKey; max: number;
}[];

const EMPTY_FLOOR = (i: number): FloorRoom =>
  ({ floor: i, bedrooms: 0, bathrooms: 0, livingRooms: 0, kitchens: 0, offices: 0 });

function initFloors(count: number, existing: FloorRoom[]): FloorRoom[] {
  return Array.from({ length: count }, (_, i) => {
    const found = existing.find(f => f.floor === i);
    // Spread over the empty floor so a row saved before `offices` existed gains it as 0
    // rather than undefined, which would render the stepper blank and NaN the totals.
    return found ? { ...EMPTY_FLOOR(i), ...found } : EMPTY_FLOOR(i);
  });
}

function computeTotals(floors: FloorRoom[]) {
  return floors.reduce(
    (acc, f) => ({
      bedrooms:    acc.bedrooms    + f.bedrooms,
      bathrooms:   acc.bathrooms   + f.bathrooms,
      livingRooms: acc.livingRooms + f.livingRooms,
      kitchens:    acc.kitchens    + f.kitchens,
      offices:     acc.offices     + (f.offices ?? 0),
    }),
    { bedrooms: 0, bathrooms: 0, livingRooms: 0, kitchens: 0, offices: 0 },
  );
}

/** Rooms on one floor. Drives the gate, the segment state and the empty-floor notice. */
const roomsOn = (f: FloorRoom) =>
  ROOM_TYPES.reduce((sum, rt) => sum + (f[rt.field] ?? 0), 0);

/**
 * How far into the building a returning draft may jump.
 *
 * A fresh project starts locked to the ground floor and earns each floor by filling the
 * one before it. A draft that already has rooms on F2 has plainly been past F2 before,
 * so re-walking it from the ground floor would be a punishment for coming back.
 */
function lastFilled(floors: FloorRoom[]): number {
  let last = 0;
  floors.forEach((f, i) => { if (roomsOn(f) > 0) last = i; });
  return last;
}

/**
 * The floor flow.
 *
 * Was a tab strip: every floor visible at once, `canContinue` gated on the WHOLE building
 * having a room. Fill the ground floor and Continue lit up, so testers filled GF, saw the
 * button go live and left F1 and F2 empty — the building priced as though its upper floors
 * had no doors, windows, sanitary ware or partitions.
 *
 * It is a flow now. One floor at a time, Continue advances a floor rather than the step,
 * and it stays disabled until THIS floor has a room. Skipping is not blocked by a
 * validation message; it is simply not a path through the screen.
 *
 * Floors already reached stay clickable, so this is a progress bar you can rewind, not a
 * corridor. What you cannot do is jump ahead of yourself.
 */
function FloorProgress({
  floors, active, reached, onSelect, labelFor, goToLabel,
}: {
  floors: FloorRoom[];
  active: number;
  reached: number;
  onSelect: (i: number) => void;
  labelFor: (i: number) => string;
  goToLabel: (floor: string) => string;
}) {
  // Past eight floors the segments are too narrow to letter. The heading above already
  // names the floor you are on, so the labels go rather than overlap.
  const showLabels = floors.length <= 8;

  return (
    <div className="mt-8">
      <div className="flex items-baseline justify-between mb-2 gap-3">
        <span className="text-sm font-semibold text-brand-near-black dark:text-white">
          {labelFor(active)}
        </span>
        <span className="text-[11px] font-medium text-brand-mid-grey tabular-nums shrink-0">
          {active + 1} / {floors.length}
        </span>
      </div>

      <div className="flex gap-1.5">
        {floors.map((f, i) => {
          const filled   = roomsOn(f) > 0;
          const unlocked = i <= reached;
          return (
            <button
              key={f.floor}
              type="button"
              disabled={!unlocked}
              onClick={() => onSelect(i)}
              aria-label={goToLabel(labelFor(i))}
              aria-current={i === active ? 'step' : undefined}
              className="group flex-1 min-w-0 text-left disabled:cursor-default rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-2"
            >
              <span
                className={cn(
                  'block h-1.5 rounded-full transition-colors duration-200',
                  i === active
                    ? 'bg-brand-near-black dark:bg-white'
                    : filled
                      ? 'bg-brand-near-black/30 dark:bg-white/35'
                      : 'bg-brand-border-grey dark:bg-[#2c2c2c]',
                )}
              />
              {showLabels && (
                <span
                  className={cn(
                    'mt-1.5 flex items-baseline gap-1 text-[11px] font-medium tabular-nums transition-colors',
                    i === active
                      ? 'text-brand-near-black dark:text-white'
                      : unlocked
                        ? 'text-brand-mid-grey group-hover:text-brand-near-black dark:group-hover:text-white'
                        : 'text-brand-border-grey dark:text-[#3a3a3a]',
                  )}
                >
                  {floorLabel(i)}
                  {/* The count is why this is worth reading: it says which floors are
                      done without opening each one. Absent on floors not yet reached,
                      where a "0" would read as a fault rather than as untouched. */}
                  {unlocked && filled && <span className="opacity-60">{roomsOn(f)}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Step5Rooms() {
  const { t, tPlural } = useLanguage();
  const { data, update, next, back } = useWizard();
  const [floors, setFloors] = useState<FloorRoom[]>(() =>
    initFloors(data.floors, data.floorRooms),
  );
  const [activeFloor, setActiveFloor] = useState(0);
  const [reached, setReached] = useState(() =>
    lastFilled(initFloors(data.floors, data.floorRooms)),
  );

  const floorLongLabel = (i: number) =>
    i === 0 ? t('wizard.rooms.groundFloor') : t('wizard.rooms.floorN', { n: i });

  // Re-initialise when floor count changes (e.g. user went back to Step 4). Both cursors
  // clamp: a building that went from five floors to two must not leave the flow parked
  // on a floor that no longer exists.
  useEffect(() => {
    const nextFloors = initFloors(data.floors, floors);
    const top        = data.floors - 1;
    setFloors(nextFloors);
    setActiveFloor(prev => Math.min(prev, top));
    setReached(prev => Math.min(Math.max(prev, lastFilled(nextFloors)), top));
    update({ previewActiveFloor: Math.min(activeFloor, top) });
  // Only re-run when data.floors changes, not floors itself
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.floors]);

  function handleRoomChange(floorIndex: number, field: keyof Omit<FloorRoom, 'floor'>, value: number) {
    const updated = floors.map(f =>
      f.floor === floorIndex ? { ...f, [field]: value } : f,
    );
    setFloors(updated);
    update({ floorRooms: updated, ...computeTotals(updated) });
  }

  /** Move the flow, and the preview on the right, to one floor. */
  function goToFloor(i: number) {
    const clamped = Math.max(0, Math.min(i, floors.length - 1));
    setActiveFloor(clamped);
    setReached(prev => Math.max(prev, clamped));
    update({ previewActiveFloor: clamped });
  }

  const current      = floors[activeFloor] ?? floors[0];
  const totals       = computeTotals(floors);
  const totalRooms   = Object.values(totals).reduce((s, n) => s + n, 0);
  // From the engine, not recomputed here — one definition of what a door count is.
  const openings     = countOpenings({ ...data, floorRooms: floors });
  const isLastFloor  = activeFloor >= floors.length - 1;
  const currentFilled = current ? roomsOn(current) > 0 : false;

  // Floors already passed that were left empty. Unreachable on a normal walk through the
  // flow — you cannot advance off an empty floor — so this only ever fires for a draft
  // saved under the old tab strip, which is exactly the case that needs telling.
  const skippedBehind = floors.filter((f, i) => i < activeFloor && roomsOn(f) === 0);

  // Continue advances a FLOOR until the last one, and only then the step. That is the
  // whole fix: the button cannot carry you out of the building with a floor unfilled,
  // because the button does not go there.
  function handleContinue() {
    if (!isLastFloor) { goToFloor(activeFloor + 1); return; }
    next();
  }

  function handleBack() {
    if (activeFloor > 0) { goToFloor(activeFloor - 1); return; }
    back();
  }

  return (
    <WizardShell
      canContinue={currentFilled}
      onContinue={handleContinue}
      onBack={handleBack}
      continueLabel={isLastFloor ? undefined : t('wizard.rooms.continueTo', { floor: floorLabel(activeFloor + 1) })}
    >
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          {t('wizard.s5Title')}
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          {floors.length > 1 ? t('wizard.s5SubFlow') : t('wizard.s5Sub')}
        </p>

        {/* One floor at a time. Single-storey builds get no progress bar — there is no
            flow to show, and a one-segment bar reads as a broken control. */}
        {floors.length > 1 && (
          <FloorProgress
            floors={floors}
            active={activeFloor}
            reached={reached}
            onSelect={goToFloor}
            labelFor={floorLongLabel}
            goToLabel={floor => t('wizard.rooms.goToFloor', { floor })}
          />
        )}

        {/* Room steppers for the floor being filled */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeFloor}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18 }}
          >
            {current && (
              <div className="mt-5 rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] divide-y divide-brand-border-grey dark:divide-[#2c2c2c] overflow-hidden">
                {ROOM_TYPES.map(rt => (
                  <Stepper
                    key={rt.field}
                    label={t(rt.labelKey)}
                    sublabel={t(rt.subKey)}
                    value={current[rt.field] ?? 0}
                    onChange={v => handleRoomChange(activeFloor, rt.field, v)}
                    min={0}
                    max={rt.max}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Cross-floor totals summary */}
        {floors.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="text-[11px] text-brand-mid-grey self-center">{t('wizard.totalLabel')}</span>
            {ROOM_TYPES.map(rt => totals[rt.field] > 0 && (
              <span
                key={rt.field}
                className="inline-flex items-center gap-1 rounded-full bg-brand-off-white border border-brand-border-grey px-2.5 py-0.5 text-xs font-medium text-brand-near-black"
              >
                <span className="font-bold">{totals[rt.field]}</span>
                {/* Pluralised by the dictionary — English adds -s, French does not always. */}
                <span className="text-brand-mid-grey">{tPlural(rt.unitKey, totals[rt.field])}</span>
              </span>
            ))}
            {totalRooms === 0 && (
              <span className="text-xs text-brand-mid-grey italic">{t('wizard.noRooms')}</span>
            )}
          </div>
        )}

        {/* Doors and windows are DERIVED, never asked. The beta test script tells testers
            to choose a number of windows and no such control exists — they were always
            priced (BQ items 601 and 605), just never shown, so the figure read as
            missing rather than worked out. Same treatment as the footprint. */}
        {totalRooms > 0 && (
          <p className="mt-4 text-[11px] leading-relaxed text-brand-mid-grey">
            {t('wizard.rooms.openings', {
              doors:   openings.doors,
              windows: openings.windows,
            })}
          </p>
        )}

        {/* Why Continue is off. Names the floor, because in a flow the answer is always
            "this one" and a message that does not say so reads as a page-level error. */}
        {!currentFilled && (
          <p className="mt-4 text-xs text-state-alert">
            {floors.length > 1
              ? t('wizard.rooms.needOneOnFloor')
              : t('wizard.rooms.needOne')}
          </p>
        )}

        {skippedBehind.length > 0 && (
          <p className="mt-3 text-xs text-brand-mid-grey">
            {tPlural('wizard.rooms.emptyFloors', skippedBehind.length, {
              floors: skippedBehind.map(f => floorLabel(f.floor)).join(', '),
            })}
          </p>
        )}
      </div>
    </WizardShell>
  );
}
