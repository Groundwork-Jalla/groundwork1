import WizardShell from '../WizardShell';
import StepCard from '../StepCard';
import { useWizard } from '@/contexts/WizardContext';
import type { BuildingType, ProjectType } from '@/types/project';
import { useT, type TKey } from '@/lib/i18n';

// ── SVG icons ─────────────────────────────────────────────

function SingleFamilyIcon() {
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12" fill="none" aria-hidden="true">
      {/* House body */}
      <rect x="8" y="26" width="48" height="18" rx="1" stroke="#0a0a0a" strokeWidth="1.4"/>
      {/* Roof */}
      <path d="M5 28 L32 8 L59 28" stroke="#0a0a0a" strokeWidth="1.4" strokeLinejoin="round"/>
      {/* Garage door */}
      <rect x="38" y="30" width="14" height="14" rx="0.5" stroke="#0a0a0a" strokeWidth="1.2"/>
      <line x1="38" y1="35" x2="52" y2="35" stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.4"/>
      <line x1="38" y1="40" x2="52" y2="40" stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.4"/>
      {/* Window */}
      <rect x="12" y="30" width="10" height="8" rx="0.5" stroke="#0a0a0a" strokeWidth="1.1"/>
      <line x1="17" y1="30" x2="17" y2="38" stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.4"/>
      {/* Door */}
      <rect x="25" y="34" width="8" height="10" rx="0.5" stroke="#0a0a0a" strokeWidth="1.2"/>
      <circle cx="32" cy="39" r="0.8" fill="#0a0a0a"/>
      {/* Chimney */}
      <rect x="40" y="12" width="5" height="9" stroke="#0a0a0a" strokeWidth="1.1"/>
      {/* Tree */}
      <line x1="4" y1="44" x2="4" y2="34" stroke="#0a0a0a" strokeWidth="1.1"/>
      <ellipse cx="4" cy="31" rx="4" ry="5" stroke="#0a0a0a" strokeWidth="1" strokeOpacity="0.6"/>
    </svg>
  );
}

function MultiFamilyIcon() {
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12" fill="none" aria-hidden="true">
      <rect x="12" y="8" width="40" height="36" rx="1" stroke="#0a0a0a" strokeWidth="1.4"/>
      {/* Floor separators */}
      <line x1="12" y1="20" x2="52" y2="20" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity="0.35"/>
      <line x1="12" y1="32" x2="52" y2="32" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity="0.35"/>
      {/* Balconies row 1 */}
      {[15,28,40].map(x => (
        <g key={x}>
          <rect x={x} y={9} width="9" height="10" rx="0.4" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity="0.6"/>
          <line x1={x} y1={14} x2={x+9} y2={14} stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.3"/>
        </g>
      ))}
      {/* Balconies row 2 */}
      {[15,28,40].map(x => (
        <g key={x}>
          <rect x={x} y={21} width="9" height="10" rx="0.4" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity="0.6"/>
          <line x1={x} y1={26} x2={x+9} y2={26} stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.3"/>
        </g>
      ))}
      {/* Ground floor */}
      <rect x="26" y="36" width="12" height="8" rx="0.4" stroke="#0a0a0a" strokeWidth="1.2"/>
      <rect x="15" y="36" width="8"  height="8" rx="0.4" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity="0.5"/>
      <rect x="41" y="36" width="8"  height="8" rx="0.4" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity="0.5"/>
    </svg>
  );
}

function TownhouseIcon() {
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12" fill="none" aria-hidden="true">
      {/* Three terraced units */}
      {[4,22,40].map((x, i) => (
        <g key={x}>
          <rect x={x} y={24} width="18" height="20" rx="0.5" stroke="#0a0a0a" strokeWidth={i===1?1.4:1.2} strokeOpacity={i===1?1:0.6}/>
          <path d={`M${x-2} 26 L${x+9} ${14+i*2} L${x+20} 26`} stroke="#0a0a0a" strokeWidth={i===1?1.4:1.2} strokeOpacity={i===1?1:0.6} fill="none"/>
          <rect x={x+3} y={28} width="5" height="5" rx="0.3" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity={i===1?0.7:0.45}/>
          <rect x={x+6} y={34} width="6" height="10" rx="0.3" stroke="#0a0a0a" strokeWidth={i===1?1.1:0.9} strokeOpacity={i===1?0.9:0.55}/>
        </g>
      ))}
    </svg>
  );
}

function SemiDetachedIcon() {
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12" fill="none" aria-hidden="true">
      {/* Left unit */}
      <rect x="4"  y="24" width="26" height="20" rx="0.5" stroke="#0a0a0a" strokeWidth="1.4"/>
      <path d="M2 26 L17 10 L32 26" stroke="#0a0a0a" strokeWidth="1.4" strokeLinejoin="round"/>
      <rect x="7"  y="28" width="7" height="6"  rx="0.4" stroke="#0a0a0a" strokeWidth="1.1"/>
      <rect x="16" y="34" width="8" height="10" rx="0.4" stroke="#0a0a0a" strokeWidth="1.2"/>
      {/* Right unit */}
      <rect x="34" y="24" width="26" height="20" rx="0.5" stroke="#0a0a0a" strokeWidth="1.4"/>
      <path d="M32 26 L47 10 L62 26" stroke="#0a0a0a" strokeWidth="1.4" strokeLinejoin="round"/>
      <rect x="50" y="28" width="7" height="6"  rx="0.4" stroke="#0a0a0a" strokeWidth="1.1"/>
      <rect x="40" y="34" width="8" height="10" rx="0.4" stroke="#0a0a0a" strokeWidth="1.2"/>
      {/* Party wall */}
      <line x1="32" y1="10" x2="32" y2="44" stroke="#0a0a0a" strokeWidth="1.6" strokeOpacity="0.7"/>
    </svg>
  );
}

function OfficeIcon() {
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12" fill="none" aria-hidden="true">
      <rect x="10" y="6" width="44" height="38" rx="1" stroke="#0a0a0a" strokeWidth="1.4"/>
      <line x1="10" y1="16" x2="54" y2="16" stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.3"/>
      <line x1="10" y1="26" x2="54" y2="26" stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.3"/>
      <line x1="10" y1="36" x2="54" y2="36" stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.3"/>
      <line x1="32" y1="6"  x2="32" y2="44" stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.3"/>
      {/* Glass curtain windows */}
      {[13,35].map(x => [8,18,28].map(y => (
        <rect key={`${x}-${y}`} x={x} y={y} width="16" height="7" rx="0.3" stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.55"/>
      )))}
      <rect x="26" y="37" width="12" height="7" rx="0.5" stroke="#0a0a0a" strokeWidth="1.2"/>
    </svg>
  );
}

function RetailIcon() {
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12" fill="none" aria-hidden="true">
      <rect x="6" y="20" width="52" height="24" rx="1" stroke="#0a0a0a" strokeWidth="1.4"/>
      {/* Awning */}
      <path d="M4 20 L60 20 L56 12 L8 12 Z" stroke="#0a0a0a" strokeWidth="1.3" fill="none"/>
      <line x1="16" y1="12" x2="14" y2="20" stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.4"/>
      <line x1="32" y1="12" x2="32" y2="20" stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.4"/>
      <line x1="48" y1="12" x2="50" y2="20" stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.4"/>
      {/* Shopfront windows */}
      <rect x="9"  y="24" width="14" height="12" rx="0.4" stroke="#0a0a0a" strokeWidth="1.1" strokeOpacity="0.65"/>
      <rect x="41" y="24" width="14" height="12" rx="0.4" stroke="#0a0a0a" strokeWidth="1.1" strokeOpacity="0.65"/>
      <rect x="26" y="24" width="12" height="20" rx="0.5" stroke="#0a0a0a" strokeWidth="1.2"/>
      {/* Signage area */}
      <rect x="9" y="8" width="46" height="4" rx="0.5" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity="0.4"/>
    </svg>
  );
}

function WarehouseIcon() {
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12" fill="none" aria-hidden="true">
      <rect x="4" y="20" width="56" height="24" rx="1" stroke="#0a0a0a" strokeWidth="1.4"/>
      {/* Barrel roof */}
      <path d="M4 20 Q32 8 60 20" stroke="#0a0a0a" strokeWidth="1.4" fill="none"/>
      {/* Bay doors */}
      {[6,22,38].map(x => (
        <g key={x}>
          <rect x={x} y={24} width="14" height="20" rx="0.4" stroke="#0a0a0a" strokeWidth="1.1" strokeOpacity="0.7"/>
          <line x1={x} y1={30} x2={x+14} y2={30} stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.35"/>
          <line x1={x} y1={36} x2={x+14} y2={36} stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.35"/>
          <line x1={x+7} y1={24} x2={x+7} y2={44} stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.35"/>
        </g>
      ))}
    </svg>
  );
}

function HotelIcon() {
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12" fill="none" aria-hidden="true">
      <rect x="16" y="4" width="32" height="40" rx="1" stroke="#0a0a0a" strokeWidth="1.4"/>
      {/* Side wings */}
      <rect x="4"  y="22" width="12" height="22" rx="0.5" stroke="#0a0a0a" strokeWidth="1.1" strokeOpacity="0.6"/>
      <rect x="48" y="22" width="12" height="22" rx="0.5" stroke="#0a0a0a" strokeWidth="1.1" strokeOpacity="0.6"/>
      {/* Floors */}
      {[12,20,28,36].map(y => (
        <line key={y} x1="16" y1={y} x2="48" y2={y} stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.3"/>
      ))}
      {/* Room windows */}
      {[19,27,35].map(y => [19,29,39].map(x => (
        <rect key={`${x}-${y}`} x={x} y={y} width="6" height="6" rx="0.3" stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.55"/>
      )))}
      {/* Entrance canopy */}
      <rect x="24" y="38" width="16" height="6" rx="0.4" stroke="#0a0a0a" strokeWidth="1.2"/>
      <path d="M22 38 L42 38" stroke="#0a0a0a" strokeWidth="1" strokeOpacity="0.5"/>
      {/* Flag */}
      <line x1="32" y1="4" x2="32" y2="0" stroke="#0a0a0a" strokeWidth="1.2"/>
      <path d="M32 0 L38 2 L32 4" stroke="#0a0a0a" strokeWidth="0.9" fill="none"/>
    </svg>
  );
}

function FactoryIcon() {
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12" fill="none" aria-hidden="true">
      <rect x="4" y="24" width="56" height="20" rx="1" stroke="#0a0a0a" strokeWidth="1.4"/>
      {/* Roof saw-tooth */}
      <path d="M4 24 L14 14 L14 24 L28 14 L28 24 L42 14 L42 24 L56 14 L56 24" stroke="#0a0a0a" strokeWidth="1.2" fill="none"/>
      {/* Skylights */}
      {[14,28,42].map(x => (
        <rect key={x} x={x-5} y={14} width="8" height="10" rx="0.3" stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.45"/>
      ))}
      {/* Chimneys */}
      <rect x="8"  y="14" width="4" height="8" stroke="#0a0a0a" strokeWidth="1.1"/>
      <rect x="20" y="10" width="4" height="12" stroke="#0a0a0a" strokeWidth="1.1"/>
      <line x1="8"  y1="13" x2="12" y2="11" stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.5"/>
      <line x1="20" y1="9"  x2="24" y2="7"  stroke="#0a0a0a" strokeWidth="0.8" strokeOpacity="0.5"/>
      {/* Bay door */}
      <rect x="24" y="30" width="18" height="14" rx="0.5" stroke="#0a0a0a" strokeWidth="1.2"/>
    </svg>
  );
}

function DistributionIcon() {
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12" fill="none" aria-hidden="true">
      <rect x="2" y="18" width="60" height="26" rx="1" stroke="#0a0a0a" strokeWidth="1.4"/>
      {/* Flat roof extension */}
      <rect x="2" y="14" width="60" height="4" rx="0.5" stroke="#0a0a0a" strokeWidth="1" strokeOpacity="0.5"/>
      {/* Loading bays */}
      {[5,19,33,47].map(x => (
        <g key={x}>
          <rect x={x} y={26} width="12" height="18" rx="0.4" stroke="#0a0a0a" strokeWidth="1.1" strokeOpacity="0.65"/>
          <line x1={x}    y1={31} x2={x+12} y2={31} stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.35"/>
          <line x1={x}    y1={36} x2={x+12} y2={36} stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.35"/>
          <line x1={x+6}  y1={26} x2={x+6}  y2={44} stroke="#0a0a0a" strokeWidth="0.7" strokeOpacity="0.35"/>
        </g>
      ))}
    </svg>
  );
}

function MixedResCommIcon() {
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12" fill="none" aria-hidden="true">
      <rect x="18" y="6" width="28" height="38" rx="1" stroke="#0a0a0a" strokeWidth="1.4"/>
      {/* Upper residential floors */}
      {[8,16,24].map(y => [21,33].map(x => (
        <rect key={`${x}-${y}`} x={x} y={y} width="8" height="7" rx="0.3" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity="0.6"/>
      )))}
      {/* Retail podium */}
      <rect x="4"  y="32" width="14" height="12" rx="0.5" stroke="#0a0a0a" strokeWidth="1.2" strokeOpacity="0.75"/>
      <rect x="46" y="32" width="14" height="12" rx="0.5" stroke="#0a0a0a" strokeWidth="1.2" strokeOpacity="0.75"/>
      <rect x="9"  y="36" width="6"  height="5"  rx="0.3" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity="0.5"/>
      <rect x="49" y="36" width="6"  height="5"  rx="0.3" stroke="#0a0a0a" strokeWidth="0.9" strokeOpacity="0.5"/>
      <rect x="23" y="35" width="18" height="9"  rx="0.5" stroke="#0a0a0a" strokeWidth="1.2"/>
    </svg>
  );
}

// ── Option lists per project type ────────────────────────

type BuildingOption = {
  value: BuildingType;
  icon: React.ReactNode;
};

const BUILDING_OPTIONS: Record<ProjectType, BuildingOption[]> = {
  residential: [
    { value: 'single_family', icon: <SingleFamilyIcon /> },
    { value: 'multi_family', icon: <MultiFamilyIcon /> },
    { value: 'townhouse', icon: <TownhouseIcon /> },
    { value: 'semi_detached', icon: <SemiDetachedIcon /> },
  ],
  commercial: [
    { value: 'office', icon: <OfficeIcon /> },
    { value: 'retail', icon: <RetailIcon /> },
    { value: 'warehouse_commercial', icon: <WarehouseIcon /> },
    { value: 'hotel', icon: <HotelIcon /> },
  ],
  industrial: [
    { value: 'factory', icon: <FactoryIcon /> },
    { value: 'warehouse_industrial', icon: <WarehouseIcon /> },
    { value: 'industrial_complex', icon: <FactoryIcon /> },
    { value: 'distribution_centre', icon: <DistributionIcon /> },
  ],
  mixed_use: [
    { value: 'mixed_residential_commercial', icon: <MixedResCommIcon /> },
    { value: 'live_work', icon: <SingleFamilyIcon /> },
    { value: 'mixed_retail_residential', icon: <RetailIcon /> },
    { value: 'transit_oriented', icon: <MixedResCommIcon /> },
  ],
};

// ── Component ─────────────────────────────────────────────

export default function Step3BuildingType() {
  const t = useT();
  const { data, update, next } = useWizard();

  const options = data.projectType ? BUILDING_OPTIONS[data.projectType] : [];

  const heading = data.projectType
    ? t(`wizardTypes.heading.${data.projectType}` as TKey)
    : t('wizardTypes.heading.fallback');

  return (
    <WizardShell canContinue={!!data.buildingType} onContinue={next}>
      <div className="pt-2">
        <h1 className="font-sans text-2xl sm:text-3xl font-bold text-brand-near-black leading-tight">
          {heading}
        </h1>
        <p className="mt-2 text-sm text-brand-mid-grey leading-relaxed">
          {t('wizard.s3Sub')}
        </p>

        <div className="mt-7 grid grid-cols-2 gap-3">
          {options.map(opt => (
            <StepCard
              key={opt.value}
              selected={data.buildingType === opt.value}
              onClick={() => update({ buildingType: opt.value })}
              icon={opt.icon}
              label={t(`wizardTypes.building.${opt.value}.label` as TKey)}
              description={t(`wizardTypes.building.${opt.value}.desc` as TKey)}
            />
          ))}
        </div>
      </div>
    </WizardShell>
  );
}
