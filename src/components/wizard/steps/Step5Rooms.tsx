import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import WizardShell from '../WizardShell';
import Stepper from '../Stepper';
import { useWizard } from '@/contexts/WizardContext';
import { cn } from '@/lib/utils';
import type { FloorRoom } from '@/types/project';

function floorLabel(index: number) {
  return index === 0 ? 'GF' : `F${index}`;
}

function floorLongLabel(index: number) {
  return index === 0 ? 'Ground Floor' : `Floor ${index}`;
}

function initFloors(count: number, existing: FloorRoom[]): FloorRoom[] {
  return Array.from({ length: count }, (_, i) =>
    existing.find(f => f.floor === i) ??
    { floor: i, bedrooms: 0, bathrooms: 0, livingRooms: 0, kitchens: 0 },
  );
}

function computeTotals(floors: FloorRoom[]) {
  return floors.reduce(
    (acc, f) => ({
      bedrooms:    acc.bedrooms    + f.bedrooms,
      bathrooms:   acc.bathrooms   + f.bathrooms,
      livingRooms: acc.livingRooms + f.livingRooms,
      kitchens:    acc.kitchens    + f.kitchens,
    }),
    { bedrooms: 0, bathrooms: 0, livingRooms: 0, kitchens: 0 },
  );
}

export default function Step5Rooms() {
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
  const totalRooms = floors.reduce((s, f) => s + f.bedrooms + f.bathrooms + f.livingRooms + f.kitchens, 0);

  return (
    <WizardShell canContinue={true} onContinue={next}>
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          Rooms per floor
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          Set the room breakdown for each floor. These shape the floor plan and materials estimate.
        </p>

        {/* Floor tabs */}
        <div className="mt-7 flex gap-1 overflow-x-auto pb-1">
          {floors.map((f, i) => (
            <button
              key={f.floor}
              type="button"
              onClick={() => handleTabChange(i)}
              className={cn(
                'shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-near-black focus-visible:ring-offset-1',
                activeTab === i
                  ? 'bg-brand-near-black text-white'
                  : 'bg-brand-off-white text-brand-mid-grey hover:text-brand-near-black',
              )}
            >
              {floorLabel(i)}
            </button>
          ))}
        </div>

        {/* Active floor label */}
        <p className="mt-3 text-xs font-medium text-brand-mid-grey">
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
              <div className="mt-2 rounded-xl border border-brand-border-grey divide-y divide-brand-border-grey overflow-hidden">
                <Stepper
                  label="Bedrooms"
                  sublabel="Including master bedroom"
                  value={current.bedrooms}
                  onChange={v => handleRoomChange(activeTab, 'bedrooms', v)}
                  min={0}
                  max={20}
                />
                <Stepper
                  label="Bathrooms"
                  sublabel="Including en-suite bathrooms"
                  value={current.bathrooms}
                  onChange={v => handleRoomChange(activeTab, 'bathrooms', v)}
                  min={0}
                  max={20}
                />
                <Stepper
                  label="Living Areas"
                  sublabel="Sitting rooms & lounges"
                  value={current.livingRooms}
                  onChange={v => handleRoomChange(activeTab, 'livingRooms', v)}
                  min={0}
                  max={5}
                />
                <Stepper
                  label="Kitchens"
                  value={current.kitchens}
                  onChange={v => handleRoomChange(activeTab, 'kitchens', v)}
                  min={0}
                  max={5}
                />
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Cross-floor totals summary */}
        {data.floors > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="text-[11px] text-brand-mid-grey self-center">Total:</span>
            {[
              { count: computeTotals(floors).bedrooms,    unit: 'bed'    },
              { count: computeTotals(floors).bathrooms,   unit: 'bath'   },
              { count: computeTotals(floors).livingRooms, unit: 'living' },
              { count: computeTotals(floors).kitchens,    unit: 'kitchen'},
            ].map(({ count, unit }) => count > 0 && (
              <span
                key={unit}
                className="inline-flex items-center gap-1 rounded-full bg-brand-off-white border border-brand-border-grey px-2.5 py-0.5 text-xs font-medium text-brand-near-black"
              >
                <span className="font-bold">{count}</span>
                <span className="text-brand-mid-grey">{count === 1 ? unit : `${unit}s`}</span>
              </span>
            ))}
            {totalRooms === 0 && (
              <span className="text-xs text-brand-mid-grey italic">No rooms added yet</span>
            )}
          </div>
        )}
      </div>
    </WizardShell>
  );
}
