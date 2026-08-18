import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import WizardShell from '../WizardShell';
import StepCard from '../StepCard';
import { useWizard } from '@/contexts/WizardContext';
import { ROOF_FORMS, roofOption, roofsOfForm, type RoofForm } from '@/lib/budget';
import { cn } from '@/lib/utils';
import type { RoofType } from '@/types/project';
import { useT } from '@/lib/i18n';

// ── SVG roof profile icons ────────────────────────────────

function LongSpanIcon() {
  return (
    <svg viewBox="0 0 64 40" className="w-16 h-10 text-brand-near-black dark:text-white" fill="none" aria-hidden="true">
      {/* Pitched corrugated profile */}
      <path d="M4 30 L32 10 L60 30" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
      {/* Corrugation lines */}
      {[-6,-3,0,3,6,9,12,15,18,21,24,27].map(offset => (
        <line key={offset}
          x1={32 + offset * 0.85} y1={10 + Math.abs(offset) * 0.7}
          x2={32 + (offset + 1.5) * 0.85} y2={10 + Math.abs(offset + 1.5) * 0.7}
          stroke="currentColor" strokeWidth="0.7" strokeOpacity="0.4"
        />
      ))}
      <rect x="4"  y="30" width="56" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.5"/>
      <line x1="32" y1="10" x2="32" y2="6" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="29" y1="6"  x2="35" y2="6" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  );
}

function ClayTilesIcon() {
  return (
    <svg viewBox="0 0 64 40" className="w-16 h-10 text-brand-near-black dark:text-white" fill="none" aria-hidden="true">
      <path d="M4 30 L32 8 L60 30" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
      {/* Tile grid — left slope */}
      {[0,1,2,3].map(row =>
        [0,1,2,3].map(col => {
          const x1 = 4  + col * 7 + row * 3.5;
          const y1 = 30 - col * 5.5 - row * 0.5;
          const x2 = x1 + 6;
          const y2 = y1 - 5.5;
          return (
            <path key={`l-${row}-${col}`}
              d={`M${x1} ${y1} Q${(x1+x2)/2} ${y1-3} ${x2} ${y2}`}
              stroke="currentColor" strokeWidth="0.7" strokeOpacity="0.45" fill="none"
            />
          );
        })
      )}
      {/* Tile grid — right slope */}
      {[0,1,2,3].map(row =>
        [0,1,2,3].map(col => {
          const x1 = 32 + col * 7 + row * 3.5;
          const y1 = 8  + col * 5.5 + row * 0.5;
          const x2 = x1 + 6;
          const y2 = y1 + 5.5;
          return (
            <path key={`r-${row}-${col}`}
              d={`M${x1} ${y1} Q${(x1+x2)/2} ${y1+3} ${x2} ${y2}`}
              stroke="currentColor" strokeWidth="0.7" strokeOpacity="0.45" fill="none"
            />
          );
        })
      )}
      <rect x="4" y="30" width="56" height="3" rx="0.4" stroke="currentColor" strokeWidth="1.1" strokeOpacity="0.5"/>
    </svg>
  );
}

function ConcreteFlatIcon() {
  return (
    <svg viewBox="0 0 64 40" className="w-16 h-10 text-brand-near-black dark:text-white" fill="none" aria-hidden="true">
      {/* Flat slab */}
      <rect x="4" y="16" width="56" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.6"/>
      {/* Parapet walls */}
      <rect x="4"  y="10" width="6" height="6" rx="0.3" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="54" y="10" width="6" height="6" rx="0.3" stroke="currentColor" strokeWidth="1.2"/>
      {/* Rebar indication */}
      {[14,22,30,38,46].map(x => (
        <line key={x} x1={x} y1={16} x2={x} y2={22} stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.35"/>
      ))}
      {/* Waterproof membrane lines */}
      <line x1="10" y1="14" x2="54" y2="14" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.35" strokeDasharray="4 3"/>
      {/* Drain */}
      <circle cx="32" cy="12" r="3" stroke="currentColor" strokeWidth="0.9" strokeOpacity="0.5"/>
      <line x1="32" y1="9" x2="32" y2="16" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.4"/>
      <rect x="4" y="22" width="56" height="14" rx="0.5" stroke="currentColor" strokeWidth="1.1" strokeOpacity="0.35"/>
    </svg>
  );
}

function ShingleIcon() {
  return (
    <svg viewBox="0 0 64 40" className="w-16 h-10 text-brand-near-black dark:text-white" fill="none" aria-hidden="true">
      <path d="M4 30 L32 10 L60 30" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
      {/* Shingle rows — left slope */}
      {[0,1,2,3,4].map(row => {
        const y1 = 30 - row * 4.5;
        const x1 = 4  + row * 3.5;
        const x2 = 32 - row * 0.1;
        return (
          <line key={`sl-${row}`}
            x1={x1} y1={y1} x2={x2} y2={10 + row * 4.3}
            stroke="currentColor" strokeWidth="0.7" strokeOpacity="0.5"
          />
        );
      })}
      {/* Shingle rows — right slope */}
      {[0,1,2,3,4].map(row => {
        const y1 = 30 - row * 4.5;
        const x1 = 60 - row * 3.5;
        const x2 = 32;
        return (
          <line key={`sr-${row}`}
            x1={x1} y1={y1} x2={x2} y2={10 + row * 4.3}
            stroke="currentColor" strokeWidth="0.7" strokeOpacity="0.5"
          />
        );
      })}
      <rect x="4" y="30" width="56" height="3" rx="0.4" stroke="currentColor" strokeWidth="1.1" strokeOpacity="0.5"/>
    </svg>
  );
}

function AluminiumDeckIcon() {
  return (
    <svg viewBox="0 0 64 40" className="w-16 h-10 text-brand-near-black dark:text-white" fill="none" aria-hidden="true">
      {/* Flat deck on a shallow fall, sheeted rather than cast */}
      <path d="M4 15 L60 18" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
      <path d="M4 19 L60 22" stroke="currentColor" strokeWidth="1.1" strokeOpacity="0.5"/>
      {/* Sheet ribs running down the fall */}
      {[10, 18, 26, 34, 42, 52].map(x => (
        <line key={x} x1={x} y1={15 + (x - 4) * 0.054} x2={x} y2={19 + (x - 4) * 0.054}
              stroke="currentColor" strokeWidth="0.7" strokeOpacity="0.4"/>
      ))}
      {/* Upstand at the high edge, gutter at the low */}
      <rect x="4" y="9" width="4" height="6" rx="0.3" stroke="currentColor" strokeWidth="1.1"/>
      <path d="M56 22 L60 22 L60 25 L56 25" stroke="currentColor" strokeWidth="1" strokeOpacity="0.55"/>
      <rect x="4" y="22" width="56" height="14" rx="0.5" stroke="currentColor" strokeWidth="1.1" strokeOpacity="0.35"/>
    </svg>
  );
}

// ── Form icons ────────────────────────────────────────────

function PitchedFormIcon() {
  return (
    <svg viewBox="0 0 64 40" className="w-16 h-10 text-brand-near-black dark:text-white" fill="none" aria-hidden="true">
      <path d="M4 30 L32 10 L60 30" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
      <rect x="4" y="30" width="56" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.5"/>
      <path d="M32 10 L32 30" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.3" strokeDasharray="3 3"/>
    </svg>
  );
}

function FlatFormIcon() {
  return (
    <svg viewBox="0 0 64 40" className="w-16 h-10 text-brand-near-black dark:text-white" fill="none" aria-hidden="true">
      <rect x="4" y="14" width="56" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.8"/>
      <rect x="4"  y="8" width="5" height="6" rx="0.3" stroke="currentColor" strokeWidth="1.1"/>
      <rect x="55" y="8" width="5" height="6" rx="0.3" stroke="currentColor" strokeWidth="1.1"/>
      <rect x="4" y="20" width="56" height="16" rx="0.5" stroke="currentColor" strokeWidth="1.1" strokeOpacity="0.35"/>
    </svg>
  );
}

const FORM_ICONS: Record<RoofForm, React.ReactNode> = {
  pitched: <PitchedFormIcon />,
  flat:    <FlatFormIcon />,
};

const MATERIAL_ICONS: Record<RoofType, React.ReactNode> = {
  long_span_aluminum: <LongSpanIcon />,
  clay_tiles:         <ClayTilesIcon />,
  shingle:            <ShingleIcon />,
  concrete_flat:      <ConcreteFlatIcon />,
  aluminium_deck:     <AluminiumDeckIcon />,
};

// ── Component ─────────────────────────────────────────────
//
// Two steps, not one grid of four. Vanessa's point: a builder settles pitched-or-flat
// before they settle what covers it, and asking both at once made people pick a material
// without registering that they had also chosen a roof form.
//
// `RoofType` is still what gets persisted — the split is presentation only, so existing
// rows and every cost multiplier are untouched.

export default function Step7RoofType() {
  const t = useT();
  const { data, update, next } = useWizard();

  // Derived, not stored: re-entering the step with a roof already chosen reopens on its
  // form rather than resetting to the fork.
  const [form, setForm] = useState<RoofForm | null>(() => roofOption(data.roofType)?.form ?? null);

  function chooseForm(f: RoofForm) {
    setForm(f);
    // Changing form invalidates the material — a pitched choice is not a flat one.
    if (roofOption(data.roofType)?.form !== f) update({ roofType: null });
  }

  const materials = form ? roofsOfForm(form) : [];

  return (
    <WizardShell canContinue={!!data.roofType} onContinue={next}>
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          {t('wizard.s7Title')}
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          {t('wizard.s7Sub')}
        </p>

        {/* Step A — form */}
        <p className="mt-7 text-xs font-semibold uppercase tracking-wide text-brand-mid-grey">
          {t('wizard.roof.stepForm')}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {ROOF_FORMS.map(f => (
            <StepCard
              key={f.form}
              selected={form === f.form}
              onClick={() => chooseForm(f.form)}
              icon={FORM_ICONS[f.form]}
              label={t(f.labelKey)}
              description={t(f.descKey)}
            />
          ))}
        </div>

        {/* Step B — material, revealed once a form is chosen */}
        <AnimatePresence>
          {form && (
            <motion.div
              key={form}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <p className="mt-7 text-xs font-semibold uppercase tracking-wide text-brand-mid-grey">
                {t('wizard.roof.stepMaterial')}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {materials.map(opt => (
                  <div key={opt.value} className="relative">
                    <StepCard
                      selected={data.roofType === opt.value}
                      onClick={() => update({ roofType: opt.value })}
                      icon={MATERIAL_ICONS[opt.value]}
                      label={t(opt.labelKey)}
                      description={t(opt.descKey)}
                    />
                    {/*
                      Derived from roof.ts, never typed out here. These badges used to be
                      hardcoded and disagreed with both rate cards — a client saw "+5%"
                      for clay tiles and was charged +10%.
                    */}
                    <span className={cn(
                      'absolute top-2 right-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-tight',
                      opt.provisional
                        ? 'border border-dashed border-brand-border-grey text-brand-mid-grey'
                        : 'bg-brand-light-grey text-brand-mid-grey',
                    )}>
                      {opt.provisional
                        ? t('wizard.roof.provisional')
                        : opt.costDeltaPct === 0
                          ? t('wizard.roof.baseCost')
                          // "+10% roof", not "+10%". The uplift is on the roof section,
                          // not on the build — an unqualified badge next to a six-figure
                          // total reads as the latter and overstates it eightfold.
                          : t('wizard.roof.upliftBadge', { pct: opt.costDeltaPct })}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </WizardShell>
  );
}
