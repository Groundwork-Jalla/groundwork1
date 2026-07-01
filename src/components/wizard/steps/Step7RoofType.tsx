import WizardShell from '../WizardShell';
import StepCard from '../StepCard';
import { useWizard } from '@/contexts/WizardContext';
import type { RoofType } from '@/types/project';

// ── SVG roof profile icons ────────────────────────────────

function LongSpanIcon() {
  return (
    <svg viewBox="0 0 64 40" className="w-16 h-10" fill="none" aria-hidden="true">
      {/* Pitched corrugated profile */}
      <path d="M4 30 L32 10 L60 30" stroke="#0a0a0a" strokeWidth="1.6" strokeLinejoin="round"/>
      {/* Corrugation lines */}
      {[-6,-3,0,3,6,9,12,15,18,21,24,27].map(offset => (
        <line key={offset}
          x1={32 + offset * 0.85} y1={10 + Math.abs(offset) * 0.7}
          x2={32 + (offset + 1.5) * 0.85} y2={10 + Math.abs(offset + 1.5) * 0.7}
          stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.4"
        />
      ))}
      <rect x="4"  y="30" width="56" height="4" rx="0.5" stroke="#0a0a0a" strokeWidth="1.2" strokeOpacity="0.5"/>
      <line x1="32" y1="10" x2="32" y2="6" stroke="#0a0a0a" strokeWidth="1.2"/>
      <line x1="29" y1="6"  x2="35" y2="6" stroke="#0a0a0a" strokeWidth="1.2"/>
    </svg>
  );
}

function ClayTilesIcon() {
  return (
    <svg viewBox="0 0 64 40" className="w-16 h-10" fill="none" aria-hidden="true">
      <path d="M4 30 L32 8 L60 30" stroke="#0a0a0a" strokeWidth="1.6" strokeLinejoin="round"/>
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
              stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.45" fill="none"
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
              stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.45" fill="none"
            />
          );
        })
      )}
      <rect x="4" y="30" width="56" height="3" rx="0.4" stroke="#0a0a0a" strokeWidth="1.1" strokeOpacity="0.5"/>
    </svg>
  );
}

function ConcreteFlatIcon() {
  return (
    <svg viewBox="0 0 64 40" className="w-16 h-10" fill="none" aria-hidden="true">
      {/* Flat slab */}
      <rect x="4" y="16" width="56" height="6" rx="0.5" stroke="#0a0a0a" strokeWidth="1.6"/>
      {/* Parapet walls */}
      <rect x="4"  y="10" width="6" height="6" rx="0.3" stroke="#0a0a0a" strokeWidth="1.2"/>
      <rect x="54" y="10" width="6" height="6" rx="0.3" stroke="#0a0a0a" strokeWidth="1.2"/>
      {/* Rebar indication */}
      {[14,22,30,38,46].map(x => (
        <line key={x} x1={x} y1={16} x2={x} y2={22} stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.35"/>
      ))}
      {/* Waterproof membrane lines */}
      <line x1="10" y1="14" x2="54" y2="14" stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.35" strokeDasharray="4 3"/>
      {/* Drain */}
      <circle cx="32" cy="12" r="3" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity="0.5"/>
      <line x1="32" y1="9" x2="32" y2="16" stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.4"/>
      <rect x="4" y="22" width="56" height="14" rx="0.5" stroke="#0a0a0a" strokeWidth="1.1" strokeOpacity="0.35"/>
    </svg>
  );
}

function ShingleIcon() {
  return (
    <svg viewBox="0 0 64 40" className="w-16 h-10" fill="none" aria-hidden="true">
      <path d="M4 30 L32 10 L60 30" stroke="#0a0a0a" strokeWidth="1.6" strokeLinejoin="round"/>
      {/* Shingle rows — left slope */}
      {[0,1,2,3,4].map(row => {
        const y1 = 30 - row * 4.5;
        const x1 = 4  + row * 3.5;
        const x2 = 32 - row * 0.1;
        return (
          <line key={`sl-${row}`}
            x1={x1} y1={y1} x2={x2} y2={10 + row * 4.3}
            stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.5"
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
            stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.5"
          />
        );
      })}
      <rect x="4" y="30" width="56" height="3" rx="0.4" stroke="#0a0a0a" strokeWidth="1.1" strokeOpacity="0.5"/>
    </svg>
  );
}

// ── Options ───────────────────────────────────────────────

const OPTIONS: {
  value: RoofType;
  label: string;
  description: string;
  icon: React.ReactNode;
  note: string;
}[] = [
  {
    value:       'long_span_aluminum',
    label:       'Long Span Aluminum',
    description: 'Corrugated metal sheet roofing — most common in West Africa',
    icon:        <LongSpanIcon />,
    note:        'Base cost',
  },
  {
    value:       'clay_tiles',
    label:       'Clay Tiles',
    description: 'Traditional fired clay roofing tiles — durable and elegant',
    icon:        <ClayTilesIcon />,
    note:        '+5% cost',
  },
  {
    value:       'concrete_flat',
    label:       'Concrete / Flat Roof',
    description: 'Reinforced concrete slab — ideal for rooftop terraces',
    icon:        <ConcreteFlatIcon />,
    note:        '+3% cost',
  },
  {
    value:       'shingle',
    label:       'Shingle',
    description: 'Asphalt or composite shingles — popular in diaspora markets',
    icon:        <ShingleIcon />,
    note:        '+4% cost',
  },
];

// ── Component ─────────────────────────────────────────────

export default function Step7RoofType() {
  const { data, update, next } = useWizard();

  return (
    <WizardShell canContinue={!!data.roofType} onContinue={next}>
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          What roof type do you prefer?
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          Your roof type affects material costs and structural requirements.
        </p>

        <div className="mt-7 grid grid-cols-2 gap-3">
          {OPTIONS.map(opt => (
            <div key={opt.value} className="relative">
              <StepCard
                selected={data.roofType === opt.value}
                onClick={() => update({ roofType: opt.value })}
                icon={opt.icon}
                label={opt.label}
                description={opt.description}
              />
              <span className="absolute top-2 right-2 text-[10px] font-medium text-brand-mid-grey bg-brand-light-grey rounded-full px-1.5 py-0.5 leading-tight">
                {opt.note}
              </span>
            </div>
          ))}
        </div>
      </div>
    </WizardShell>
  );
}
