import WizardShell from '../WizardShell';
import StepCard from '../StepCard';
import { useWizard } from '@/contexts/WizardContext';
import type { ProjectType } from '@/types/project';

// ── Inline SVG icons ──────────────────────────────────────

function ResidentialIcon() {
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12" fill="none" aria-hidden="true">
      <rect x="10" y="24" width="44" height="20" rx="1" stroke="#0a0a0a" strokeWidth="1.4" />
      <path d="M8 26 L32 8 L56 26" stroke="#0a0a0a" strokeWidth="1.4" strokeLinejoin="round" />
      <rect x="20" y="30" width="8" height="8" rx="0.5" stroke="#0a0a0a" strokeWidth="1.2" />
      <rect x="36" y="30" width="8" height="8" rx="0.5" stroke="#0a0a0a" strokeWidth="1.2" />
      <rect x="27" y="34" width="10" height="10" rx="0.5" stroke="#0a0a0a" strokeWidth="1.2" />
      <line x1="30" y1="8" x2="30" y2="4" stroke="#0a0a0a" strokeWidth="1.2" />
      <line x1="28" y1="4" x2="34" y2="4" stroke="#0a0a0a" strokeWidth="1.2" />
    </svg>
  );
}

function CommercialIcon() {
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12" fill="none" aria-hidden="true">
      <rect x="14" y="10" width="36" height="34" rx="1" stroke="#0a0a0a" strokeWidth="1.4" />
      <line x1="14" y1="18" x2="50" y2="18" stroke="#0a0a0a" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="14" y1="26" x2="50" y2="26" stroke="#0a0a0a" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="14" y1="34" x2="50" y2="34" stroke="#0a0a0a" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="32" y1="10" x2="32" y2="44" stroke="#0a0a0a" strokeWidth="1" strokeOpacity="0.4" />
      {[[18,12],[36,12],[18,20],[36,20],[18,28],[36,28]].map(([x,y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="10" height="5" rx="0.5" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity="0.6" />
      ))}
      <rect x="26" y="36" width="12" height="8" rx="0.5" stroke="#0a0a0a" strokeWidth="1.2" />
      <rect x="8" y="5" width="8" height="39" rx="0.5" stroke="#0a0a0a" strokeWidth="1.2" strokeOpacity="0.35" />
    </svg>
  );
}

function IndustrialIcon() {
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12" fill="none" aria-hidden="true">
      <rect x="6"  y="22" width="52" height="22" rx="1" stroke="#0a0a0a" strokeWidth="1.4" />
      <rect x="6"  y="28" width="24" height="16" rx="1" stroke="#0a0a0a" strokeWidth="1" strokeOpacity="0.5" />
      <path d="M8 22 L8 14 L20 14 L20 22" stroke="#0a0a0a" strokeWidth="1.2" fill="none" />
      <path d="M22 22 L22 16 L34 16 L34 22" stroke="#0a0a0a" strokeWidth="1.2" fill="none" />
      <rect x="36" y="28" width="16" height="16" rx="0.5" stroke="#0a0a0a" strokeWidth="1" strokeOpacity="0.5" />
      <line x1="36" y1="36" x2="52" y2="36" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity="0.4" />
      <rect x="42" y="28" width="4" height="4" stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.5" />
      <line x1="14" y1="12" x2="14" y2="6"  stroke="#0a0a0a" strokeWidth="1.2" />
      <line x1="28" y1="14" x2="28" y2="8"  stroke="#0a0a0a" strokeWidth="1.2" />
    </svg>
  );
}

function MixedUseIcon() {
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12" fill="none" aria-hidden="true">
      {/* Tower */}
      <rect x="20" y="6" width="24" height="38" rx="1" stroke="#0a0a0a" strokeWidth="1.4" />
      {[[23,10],[34,10],[23,18],[34,18],[23,26],[34,26]].map(([x,y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="8" height="6" rx="0.3" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity="0.55" />
      ))}
      {/* Podium */}
      <rect x="8"  y="32" width="16" height="12" rx="0.5" stroke="#0a0a0a" strokeWidth="1.2" strokeOpacity="0.7" />
      <rect x="40" y="32" width="16" height="12" rx="0.5" stroke="#0a0a0a" strokeWidth="1.2" strokeOpacity="0.7" />
      {/* Ground retail windows */}
      <rect x="11" y="36" width="5" height="5" rx="0.3" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity="0.5" />
      <rect x="43" y="36" width="5" height="5" rx="0.3" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity="0.5" />
      {/* Door */}
      <rect x="27" y="36" width="10" height="8" rx="0.5" stroke="#0a0a0a" strokeWidth="1.2" />
    </svg>
  );
}

// ── Options ───────────────────────────────────────────────

const OPTIONS: {
  value: ProjectType;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    value:       'residential',
    label:       'Residential',
    description: 'Homes, apartments, and private dwellings',
    icon:        <ResidentialIcon />,
  },
  {
    value:       'commercial',
    label:       'Commercial',
    description: 'Offices, retail, hotels, and hospitality',
    icon:        <CommercialIcon />,
  },
  {
    value:       'industrial',
    label:       'Industrial',
    description: 'Factories, warehouses, and logistics hubs',
    icon:        <IndustrialIcon />,
  },
  {
    value:       'mixed_use',
    label:       'Mixed Use',
    description: 'Combined residential and commercial spaces',
    icon:        <MixedUseIcon />,
  },
];

// ── Component ─────────────────────────────────────────────

export default function Step2ProjectType() {
  const { data, update, next } = useWizard();

  function select(value: ProjectType) {
    // Reset building type when project type changes
    const reset = data.projectType !== value ? { buildingType: null } : {};
    update({ projectType: value, ...reset });
  }

  return (
    <WizardShell canContinue={!!data.projectType} onContinue={next}>
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          What are you building?
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          Select the primary use of your project.
        </p>

        <div className="mt-7 grid grid-cols-2 gap-3">
          {OPTIONS.map(opt => (
            <StepCard
              key={opt.value}
              selected={data.projectType === opt.value}
              onClick={() => select(opt.value)}
              icon={opt.icon}
              label={opt.label}
              description={opt.description}
            />
          ))}
        </div>
      </div>
    </WizardShell>
  );
}
