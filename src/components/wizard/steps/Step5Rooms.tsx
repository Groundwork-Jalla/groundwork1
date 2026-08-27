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

function floorLongLabel(index: number) {
  return index === 0 ? 'Ground Floor' : `Floor ${index}`;
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

export default function Step5Rooms() {
  const { t, tPlural } = useLanguage();
  const { data, update, next } = useWizard();
  const [floors, setFloors] = useState<FloorRoom[]>(() =>
    initFloors(data.floors, data.floorRooms),
  );
  const [activeTab, setActiveTab] = useState(0);

  // Re-initialise when floor count changes (e.g. user went back to Step 4)
  useEffect(() => {
    const next = initFloors(data.floors, floors);
    setFloors(next);
    setActiveTab(prev => Math.min(prev, data.floors - 1));
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

  function handleTabChange(i: number) {
    setActiveTab(i);
    update({ previewActiveFloor: i });
  }

  const current = floors[activeTab] ?? floors[0];
  const totals = computeTotals(floors);
  const totalRooms = Object.values(totals).reduce((s, n) => s + n, 0);
  // From the engine, not recomputed here — one definition of what a door count is.
  const openings   = countOpenings({ ...data, floorRooms: floors });

  /** Rooms on one floor — drives the per-tab badge and the empty-floor notice. */
  const roomsOn = (f: FloorRoom) =>
    ROOM_TYPES.reduce((sum, rt) => sum + (f[rt.field] ?? 0), 0);
  const emptyFloors = floors.filter(f => roomsOn(f) === 0);

  // A building with no rooms prices as an empty shell: room counts drive doors, windows,
  // sanitary ware, wall tiling and internal partitions. The same omission in the public
  // estimator was measured at a 34% shortfall (see routes/tools/budget.tsx), and this
  // step used to pass `canContinue={true}` unconditionally.
  return (
    <WizardShell canContinue={totalRooms > 0} onContinue={next}>
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          {t('wizard.s5Title')}
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          {t('wizard.s5Sub')}
        </p>

        {/* Floor tabs */}
        <div className="mt-8 flex gap-2 overflow-x-auto pb-1">
          {floors.map((f, i) => (
            <button
              key={f.floor}
              type="button"
              onClick={() => handleTabChange(i)}
              className={cn(
                'shrink-0 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-1',
                activeTab === i
                  ? 'bg-brand-near-black dark:bg-white text-white dark:text-brand-near-black'
                  : 'bg-brand-off-white dark:bg-[#282828] text-brand-mid-grey hover:text-brand-near-black dark:hover:text-white',
              )}
            >
              {floorLabel(i)}
              {/* The count is the point of the tab strip: without it you have to open
                  every floor to find the one you have not filled in yet. */}
              <span className={cn(
                'ml-1.5 tabular-nums',
                roomsOn(f) === 0
                  ? 'text-state-alert'
                  : activeTab === i ? 'opacity-60' : 'text-brand-mid-grey',
              )}>
                {roomsOn(f)}
              </span>
            </button>
          ))}
        </div>

        {/* Active floor label */}
        <p className="mt-4 text-sm font-semibold text-brand-near-black dark:text-white">
          {floorLongLabel(activeTab)}
        </p>

        {/* Room steppers for active floor */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18 }}
          >
            {current && (
              <div className="mt-3 rounded-xl border border-brand-border-grey dark:border-[#2c2c2c] divide-y divide-brand-border-grey dark:divide-[#2c2c2c] overflow-hidden">
                {ROOM_TYPES.map(rt => (
                  <Stepper
                    key={rt.field}
                    label={t(rt.labelKey)}
                    sublabel={t(rt.subKey)}
                    value={current[rt.field] ?? 0}
                    onChange={v => handleRoomChange(activeTab, rt.field, v)}
                    min={0}
                    max={rt.max}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Cross-floor totals summary */}
        {data.floors > 1 && (
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

        {/* Why the Continue button is off, and which floor to go to. Shown against the
            floor count from step 4, because an empty floor usually means that count is
            wrong rather than that the floor is genuinely empty. */}
        {totalRooms === 0 ? (
          <p className="mt-4 text-xs text-state-alert">{t('wizard.rooms.needOne')}</p>
        ) : emptyFloors.length > 0 && (
          <p className="mt-4 text-xs text-brand-mid-grey">
            {tPlural('wizard.rooms.emptyFloors', emptyFloors.length, {
              floors: emptyFloors.map(f => floorLabel(f.floor)).join(', '),
            })}
          </p>
        )}
      </div>
    </WizardShell>
  );
}
