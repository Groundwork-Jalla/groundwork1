import { useRef, useEffect } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { Building2, Layers, Ruler, Home, Wrench, CheckCircle2, DollarSign, MapPin } from 'lucide-react';
import { useWizard } from '@/contexts/WizardContext';
import { calculateBudget, formatUSD } from '@/lib/budget';
import { CountryMap, MapEmptyState } from './CountryMap';
import type { FloorRoom } from '@/types/project';

// ── Photo image map (step 2 / 3 / 7) ──────────────────────────
const BUILDING_IMAGES: Record<string, string> = {
  residential: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=900&q=80',
  commercial:  'https://images.unsplash.com/photo-1486325212027-8081e485255e?auto=format&fit=crop&w=900&q=80',
  industrial:  'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=900&q=80',
  mixed_use:   'https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?auto=format&fit=crop&w=900&q=80',
  single_family:        'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=900&q=80',
  bungalow:             'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?auto=format&fit=crop&w=900&q=80',
  villa:                'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=900&q=80',
  apartment:            'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=900&q=80',
  duplex:               'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=900&q=80',
  townhouse:            'https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=900&q=80',
  semi_detached:        'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=900&q=80',
  multi_family:         'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=900&q=80',
  guest_house:          'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?auto=format&fit=crop&w=900&q=80',
  office:               'https://images.unsplash.com/photo-1486325212027-8081e485255e?auto=format&fit=crop&w=900&q=80',
  retail:               'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&w=900&q=80',
  hotel:                'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80',
  warehouse_commercial: 'https://images.unsplash.com/photo-1565183997392-2f6f122e5912?auto=format&fit=crop&w=900&q=80',
  factory:              'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=900&q=80',
  warehouse_industrial: 'https://images.unsplash.com/photo-1565183997392-2f6f122e5912?auto=format&fit=crop&w=900&q=80',
  industrial_complex:   'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=900&q=80',
  distribution_centre:  'https://images.unsplash.com/photo-1565183997392-2f6f122e5912?auto=format&fit=crop&w=900&q=80',
  mixed_residential_commercial: 'https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?auto=format&fit=crop&w=900&q=80',
  live_work:            'https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?auto=format&fit=crop&w=900&q=80',
  mixed_retail_residential: 'https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?auto=format&fit=crop&w=900&q=80',
  transit_oriented:     'https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?auto=format&fit=crop&w=900&q=80',
  long_span_aluminum:   'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=900&q=80',
  clay_tiles:           'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?auto=format&fit=crop&w=900&q=80',
  concrete_flat:        'https://images.unsplash.com/photo-1487958449943-2429e8be8625?auto=format&fit=crop&w=900&q=80',
  shingle:              'https://images.unsplash.com/photo-1592595896551-12b371d546d5?auto=format&fit=crop&w=900&q=80',
};

const IMAGE_LABELS: Record<string, { title: string; sub: string }> = {
  residential:  { title: 'Residential Build',            sub: 'Project type' },
  commercial:   { title: 'Commercial Development',       sub: 'Project type' },
  industrial:   { title: 'Industrial Facility',          sub: 'Project type' },
  mixed_use:    { title: 'Mixed-Use Development',        sub: 'Project type' },
  single_family:{ title: 'Single Family Home',           sub: 'Building type' },
  bungalow:     { title: 'Bungalow',                     sub: 'Building type' },
  villa:        { title: 'Villa',                        sub: 'Building type' },
  apartment:    { title: 'Apartment Block',              sub: 'Building type' },
  duplex:       { title: 'Duplex',                       sub: 'Building type' },
  townhouse:    { title: 'Townhouse',                    sub: 'Building type' },
  semi_detached:{ title: 'Semi-Detached',                sub: 'Building type' },
  multi_family: { title: 'Multi-Family',                 sub: 'Building type' },
  guest_house:  { title: 'Guest House',                  sub: 'Building type' },
  office:       { title: 'Office Building',              sub: 'Building type' },
  retail:       { title: 'Retail Space',                 sub: 'Building type' },
  hotel:        { title: 'Hotel',                        sub: 'Building type' },
  warehouse_commercial: { title: 'Warehouse',            sub: 'Building type' },
  factory:      { title: 'Factory / Plant',              sub: 'Building type' },
  warehouse_industrial: { title: 'Industrial Warehouse', sub: 'Building type' },
  industrial_complex:   { title: 'Industrial Complex',   sub: 'Building type' },
  distribution_centre:  { title: 'Distribution Centre',  sub: 'Building type' },
  mixed_residential_commercial: { title: 'Residential + Commercial', sub: 'Building type' },
  live_work:    { title: 'Live / Work Space',            sub: 'Building type' },
  mixed_retail_residential: { title: 'Retail + Residential', sub: 'Building type' },
  transit_oriented: { title: 'Transit-Oriented',        sub: 'Building type' },
  long_span_aluminum: { title: 'Metal Sheet Roofing',   sub: 'Roof type' },
  clay_tiles:   { title: 'Clay Tile Roof',               sub: 'Roof type' },
  concrete_flat:{ title: 'Concrete Flat Roof',           sub: 'Roof type' },
  shingle:      { title: 'Shingle Roof',                 sub: 'Roof type' },
};

// ── Image panel (steps 2, 3, 7) ────────────────────────────────

function ImagePanel({ imageKey }: { imageKey: string | null }) {
  const meta = imageKey ? IMAGE_LABELS[imageKey] : null;
  const src  = imageKey ? BUILDING_IMAGES[imageKey] : null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={imageKey ?? 'empty'}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="absolute inset-0 overflow-hidden"
      >
        {src ? (
          /* Ken Burns — slow continuous zoom + drift */
          <motion.img
            src={src}
            alt={meta?.title ?? 'Building'}
            className="absolute inset-0 w-full h-full object-cover origin-center"
            style={{ willChange: 'transform' }}
            animate={{ scale: [1.05, 1.12, 1.05], x: [-6, 6, -6] }}
            transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
            onError={e => {
              (e.target as HTMLImageElement).src =
                `https://picsum.photos/seed/${imageKey ?? 'building'}/900/700`;
            }}
          />
        ) : (
          <div className="absolute inset-0 bg-[#111]" />
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/20 to-black/10" />

        {/* Floating pill — top right */}
        <AnimatePresence mode="wait">
          {meta && (
            <motion.div
              key={`pill-${imageKey}`}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35, delay: 0.25 }}
              className="absolute top-5 right-5 z-20"
            >
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                className="flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white px-3 py-1.5 text-[11px] font-medium"
              >
                <span className="size-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
                {meta.sub}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom label */}
        <AnimatePresence mode="wait">
          {meta && (
            <motion.div
              key={imageKey}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35, delay: 0.1 }}
              className="absolute bottom-0 left-0 right-0 p-7"
            >
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50 mb-1">{meta.sub}</p>
              <p className="text-2xl font-black text-white leading-tight">{meta.title}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {!imageKey && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-white/30 font-medium">Select an option to preview</p>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

// ── Constants ─────────────────────────────────────────────────
const D     = '#0a0a0a';
const CX    = 188;          // building centre X
const GY    = 418;          // ground Y
const BW    = 206;          // building width
const FH    = 56;           // floor height
const ease  = [0.22, 1, 0.36, 1] as const;
const BL    = CX - BW / 2; // building left = 85

function clampFloors(f: number) { return Math.max(1, Math.min(f, 7)); }
function buildingTop(floors: number) { return GY - clampFloors(floors) * FH; }

// ── Animated badge ─────────────────────────────────────────────
function Badge({
  icon,
  label,
  sub,
  pos,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  pos: 'tl' | 'tr' | 'bl' | 'br';
}) {
  const posClass = {
    tl: 'top-4 left-4',
    tr: 'top-4 right-4',
    bl: 'bottom-6 left-4',
    br: 'bottom-6 right-4',
  }[pos];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85, y: -8 }}
      transition={{ duration: 0.35, ease }}
      className={`absolute ${posClass} z-20`}
    >
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        className="flex items-center gap-2 rounded-full bg-brand-near-black text-white shadow-[0_4px_20px_rgba(0,0,0,0.22)] px-3 py-2 text-xs font-semibold whitespace-nowrap"
      >
        {icon}
        <span>{label}</span>
        {sub && <span className="opacity-60 font-normal">· {sub}</span>}
      </motion.div>
    </motion.div>
  );
}

function InfoBadge({ children, pos, delay = 0 }: { children: React.ReactNode; pos: 'tl' | 'tr' | 'bl' | 'br'; delay?: number }) {
  const posClass = {
    tl: 'top-4 left-4',
    tr: 'top-4 right-4',
    bl: 'bottom-6 left-4',
    br: 'bottom-6 right-4',
  }[pos];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ delay, duration: 0.4, ease }}
      className={`absolute ${posClass} z-20`}
    >
      <motion.div
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 3.5 + delay, repeat: Infinity, ease: 'easeInOut', delay }}
        className="rounded-2xl border border-brand-border-grey bg-white/90 backdrop-blur-sm shadow-[0_4px_24px_rgba(0,0,0,0.08)] px-3 py-2.5 text-[11px] text-brand-near-black font-medium"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

// ── SVG building layers ───────────────────────────────────────

function BlueprintGrid() {
  return (
    <defs>
      <pattern id="bp-grid" width="28" height="28" patternUnits="userSpaceOnUse">
        <circle cx="0" cy="0" r="1" fill={D} fillOpacity="0.12" />
        <circle cx="28" cy="0" r="1" fill={D} fillOpacity="0.12" />
        <circle cx="0" cy="28" r="1" fill={D} fillOpacity="0.12" />
        <circle cx="28" cy="28" r="1" fill={D} fillOpacity="0.12" />
      </pattern>
    </defs>
  );
}

function Ground() {
  return (
    <>
      <line x1="10" y1={GY} x2="370" y2={GY} stroke={D} strokeWidth="2" strokeOpacity="0.25" />
      <ellipse cx={CX} cy={GY + 14} rx="110" ry="10" fill={D} fillOpacity="0.04" />
    </>
  );
}

function Crane({ visible, step }: { visible: boolean; step: number }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.g
          key="crane"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.5 } }}
          transition={{ duration: 0.5 }}
        >
          {/* Mast */}
          <line x1="316" y1={GY} x2="316" y2="80" stroke={D} strokeWidth="2.5" strokeOpacity="0.35" />
          {/* Mast cross-braces */}
          {[340, 300, 260, 220, 180, 140].map((y, i) => (
            <line key={i} x1="310" y1={y} x2="322" y2={y - 20} stroke={D} strokeWidth="1" strokeOpacity="0.2" />
          ))}
          {/* Counter jib */}
          <line x1="316" y1="80" x2="356" y2="88" stroke={D} strokeWidth="2" strokeOpacity="0.3" />
          {/* Main jib */}
          <motion.g
            animate={{ rotate: [0, -8, 0, 8, 0] }}
            transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
            style={{ originX: '316px', originY: '80px' }}
          >
            <line x1="316" y1="80" x2="220" y2="88" stroke={D} strokeWidth="2.5" strokeOpacity="0.4" />
            {/* Trolley */}
            <rect x="248" y="84" width="12" height="8" rx="1" fill={D} fillOpacity="0.3" stroke={D} strokeWidth="1" strokeOpacity="0.4" />
            {/* Hook cable */}
            <motion.line
              x1="254" y1="92"
              x2="254" y2={130}
              animate={{ y2: [130, 110, 140, 120, 130] }}
              transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
              stroke={D} strokeWidth="1" strokeOpacity="0.25"
            />
            {/* Hook */}
            <motion.path
              animate={{ y: [0, -18, 10, -10, 0] }}
              transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
              d="M250 130 Q250 138 254 138 Q258 138 258 130"
              fill="none" stroke={D} strokeWidth="1.5" strokeOpacity="0.3"
            />
          </motion.g>
          {/* Cab */}
          <rect x="310" y="74" width="12" height="10" rx="1" fill={D} fillOpacity="0.2" stroke={D} strokeWidth="1" strokeOpacity="0.4" />
        </motion.g>
      )}
    </AnimatePresence>
  );
}

function Foundation({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.g
          key="foundation"
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          exit={{ opacity: 0 }}
          style={{ transformOrigin: `${CX}px ${GY}px` }}
          transition={{ duration: 0.45, ease }}
        >
          <rect x={BL - 10} y={GY} width={BW + 20} height={14} rx="1" fill={D} fillOpacity="0.06" stroke={D} strokeWidth="1.5" strokeOpacity="0.35" />
          {Array.from({ length: 11 }, (_, i) => (
            <line key={i}
              x1={BL - 4 + i * 24} y1={GY}
              x2={BL - 12 + i * 24} y2={GY + 14}
              stroke={D} strokeWidth="0.8" strokeOpacity="0.15"
            />
          ))}
          {/* Dimension line */}
          <g opacity="0.45">
            <line x1={BL} y1={GY + 22} x2={BL + BW} y2={GY + 22} stroke={D} strokeWidth="1" />
            <line x1={BL} y1={GY + 18} x2={BL} y2={GY + 26} stroke={D} strokeWidth="1" />
            <line x1={BL + BW} y1={GY + 18} x2={BL + BW} y2={GY + 26} stroke={D} strokeWidth="1" />
            <text x={CX} y={GY + 35} textAnchor="middle" fontSize="9" fill={D} fontFamily="'Plus Jakarta Sans', sans-serif">
              {BW / 10}m width
            </text>
          </g>
        </motion.g>
      )}
    </AnimatePresence>
  );
}

function BuildingBody({ visible, floors, buildingType }: { visible: boolean; floors: number; buildingType: string | null }) {
  if (!visible) return null;
  const fl = clampFloors(floors);
  const h  = fl * FH;
  const top = GY - h;

  return (
    <motion.g
      key={`body-${fl}`}
      initial={{ scaleY: 0, opacity: 0 }}
      animate={{ scaleY: 1, opacity: 1 }}
      style={{ transformOrigin: `${CX}px ${GY}px` }}
      transition={{ duration: 0.5, ease }}
    >
      {/* Scaffolding behind */}
      {[BL - 16, BL + BW + 4].map((sx, si) => (
        <g key={si} opacity="0.2">
          <line x1={sx + 6} y1={top - 20} x2={sx + 6} y2={GY} stroke={D} strokeWidth="2" strokeDasharray="5 4" />
          {Array.from({ length: fl + 2 }, (_, i) => (
            <line key={i} x1={sx} y1={top - 10 + i * FH} x2={sx + 12} y2={top - 10 + i * FH} stroke={D} strokeWidth="1.5" />
          ))}
        </g>
      ))}

      {/* Body fill */}
      <rect x={BL} y={top} width={BW} height={h} fill={D} fillOpacity="0.03" />
      {/* Body outline */}
      <rect x={BL} y={top} width={BW} height={h} rx="1" stroke={D} strokeWidth="2" strokeOpacity="0.7" fill="none" />

      {/* Floor dividers */}
      {Array.from({ length: fl - 1 }, (_, i) => (
        <line key={i}
          x1={BL} y1={top + (i + 1) * FH}
          x2={BL + BW} y2={top + (i + 1) * FH}
          stroke={D} strokeWidth="0.8" strokeOpacity="0.18"
        />
      ))}

      {/* Height dimension */}
      <g opacity="0.4">
        <line x1={BL - 28} y1={top} x2={BL - 28} y2={GY} stroke={D} strokeWidth="1" />
        <line x1={BL - 32} y1={top} x2={BL - 24} y2={top} stroke={D} strokeWidth="1" />
        <line x1={BL - 32} y1={GY} x2={BL - 24} y2={GY} stroke={D} strokeWidth="1" />
        <text
          x={BL - 38} y={(top + GY) / 2}
          textAnchor="middle"
          fontSize="9"
          fill={D}
          fontFamily="'Plus Jakarta Sans', sans-serif"
          transform={`rotate(-90 ${BL - 38} ${(top + GY) / 2})`}
        >
          {fl * 3}m
        </text>
      </g>
    </motion.g>
  );
}

// ── Room-type window cell ──────────────────────────────────────
//
// Layout rule: bed+bath pairs → "suite" (one cell, bath circle inside)
// Extra baths → separate small cell, living → wide cell, kitchen → separate cell
// GF = BOTTOM visual row, higher floors stack above it.

type CellType = 'suite' | 'bed' | 'bath' | 'living' | 'kitchen';
interface Cell { type: CellType; id: string }

function buildCells(fd: FloorRoom, fi: number): Cell[] {
  const suites    = Math.min(fd.bedrooms, fd.bathrooms);
  const solobeds  = Math.max(0, fd.bedrooms  - fd.bathrooms);
  const extrabath = Math.max(0, fd.bathrooms - fd.bedrooms);
  return [
    ...Array.from({ length: suites },    (_, i) => ({ type: 'suite'   as CellType, id: `f${fi}-s${i}` })),
    ...Array.from({ length: solobeds },  (_, i) => ({ type: 'bed'     as CellType, id: `f${fi}-b${i}` })),
    ...Array.from({ length: extrabath }, (_, i) => ({ type: 'bath'    as CellType, id: `f${fi}-ba${i}` })),
    ...Array.from({ length: fd.livingRooms }, (_, i) => ({ type: 'living'  as CellType, id: `f${fi}-l${i}` })),
    ...Array.from({ length: fd.kitchens },    (_, i) => ({ type: 'kitchen' as CellType, id: `f${fi}-k${i}` })),
  ];
}

function WindowCell({
  wx, wy, wW, wH, type, delay,
}: {
  wx: number; wy: number; wW: number; wH: number;
  type: CellType; delay: number;
}) {
  const fo = type === 'suite' ? 0.14 : type === 'living' ? 0.11 : 0.08;
  const sw = type === 'living' ? 2.2 : 2.0;

  return (
    <motion.g
      initial={{ opacity: 0, scaleY: 0 }}
      animate={{ opacity: 1, scaleY: 1 }}
      exit={{ opacity: 0, scaleY: 0 }}
      style={{ transformOrigin: `${wx + wW / 2}px ${wy + wH}px` }}
      transition={{ type: 'spring', stiffness: 500, damping: 30, delay }}
    >
      {/* Window body */}
      <rect x={wx} y={wy} width={wW} height={wH} rx="2"
        fill={D} fillOpacity={fo} stroke={D} strokeWidth={sw} strokeOpacity={0.8} />

      {/* Horizontal sill (mid-rail) */}
      <line x1={wx + 1} y1={wy + wH * 0.5}
            x2={wx + wW - 1} y2={wy + wH * 0.5}
            stroke={D} strokeWidth="0.8" strokeOpacity="0.4" />

      {/* Vertical mullion */}
      <line x1={wx + wW / 2} y1={wy + 1}
            x2={wx + wW / 2} y2={wy + wH - 1}
            stroke={D} strokeWidth="0.8" strokeOpacity="0.4" />

      {/* Suite: small arc in lower-right quadrant = en-suite bath */}
      {type === 'suite' && (
        <path
          d={`M${wx + wW * 0.6} ${wy + wH * 0.55} A${wW * 0.28} ${wH * 0.3} 0 0 0 ${wx + wW - 2} ${wy + wH * 0.88}`}
          fill="none" stroke={D} strokeWidth="1" strokeOpacity="0.45"
        />
      )}

      {/* Kitchen: 2×2 hob grid dots */}
      {type === 'kitchen' && (() => {
        const cx1 = wx + wW * 0.3, cx2 = wx + wW * 0.7;
        const cy1 = wy + wH * 0.3, cy2 = wy + wH * 0.72;
        return (
          <>
            <circle cx={cx1} cy={cy1} r={2} fill={D} fillOpacity="0.35" />
            <circle cx={cx2} cy={cy1} r={2} fill={D} fillOpacity="0.35" />
            <circle cx={cx1} cy={cy2} r={2} fill={D} fillOpacity="0.35" />
            <circle cx={cx2} cy={cy2} r={2} fill={D} fillOpacity="0.35" />
          </>
        );
      })()}

      {/* Living: extra horizontal divider = wide window feel */}
      {type === 'living' && (
        <line x1={wx + 1} y1={wy + wH * 0.75}
              x2={wx + wW - 1} y2={wy + wH * 0.75}
              stroke={D} strokeWidth="0.7" strokeOpacity="0.3" />
      )}
    </motion.g>
  );
}

function Windows({
  visible, floors, floorRooms, activeFloor,
}: {
  visible: boolean; floors: number;
  floorRooms: FloorRoom[]; activeFloor: number;
}) {
  if (!visible) return null;
  const fl  = clampFloors(floors);
  const top = GY - fl * FH;
  const wH  = FH - 14;
  const PAD = 10;
  const GAP = 5;
  const MAX = 5;

  return (
    <g>
      {Array.from({ length: fl }, (_, row) => {
        // GF = bottom (row fl-1), higher floors stack above
        const floorIndex = fl - 1 - row;               // ← GF at bottom
        const fd = floorRooms[floorIndex] ?? {
          floor: floorIndex, bedrooms: 0, bathrooms: 0, livingRooms: 0, kitchens: 0,
        };
        const cells = buildCells(fd, floorIndex);
        const visible5 = cells.slice(0, MAX);
        const cols = Math.max(visible5.length, 3);
        const wW  = Math.max(16, (BW - PAD * 2 - GAP * (cols - 1)) / cols);

        // Visual row 0 = top floor, row fl-1 = ground floor
        const floorY = top + row * FH;
        // The active floor is `activeFloor` (0=GF). Its visual row = fl-1-activeFloor
        const isActive = row === (fl - 1 - activeFloor);

        return (
          <g key={`floor-row-${row}`}>
            {/* Active floor highlight — pulsing */}
            <AnimatePresence>
              {isActive && (
                <motion.rect key="hl"
                  x={BL + 1} y={floorY + 1}
                  width={BW - 2} height={FH - 2}
                  rx="1" fill={D} fillOpacity={0.05}
                  stroke={D} strokeWidth={2}
                  initial={{ strokeOpacity: 0 }}
                  animate={{ strokeOpacity: [0.5, 0.9, 0.5] }}
                  exit={{ strokeOpacity: 0 }}
                  style={{ transformOrigin: `${CX}px ${floorY + FH / 2}px` }}
                  transition={{ strokeOpacity: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } }}
                />
              )}
            </AnimatePresence>

            {/* Placeholder dashes when empty */}
            {visible5.length === 0 && Array.from({ length: 3 }, (_, c) => {
              const pw = (BW - PAD * 2 - GAP * 2) / 3;
              return (
                <rect key={c}
                  x={BL + PAD + c * (pw + GAP)} y={floorY + 7}
                  width={pw} height={wH} rx="1" fill="none"
                  stroke={D} strokeWidth="1"
                  strokeOpacity={isActive ? 0.28 : 0.12}
                  strokeDasharray="4 3"
                />
              );
            })}

            {/* Room windows */}
            <AnimatePresence mode="sync">
              {visible5.map((cell, col) => (
                <WindowCell
                  key={cell.id}
                  wx={BL + PAD + col * (wW + GAP)}
                  wy={floorY + 7}
                  wW={wW} wH={wH}
                  type={cell.type}
                  delay={col * 0.07}
                />
              ))}
            </AnimatePresence>

            {cells.length > MAX && (
              <text x={BL + BW - 4} y={floorY + FH / 2 + 4}
                textAnchor="end" fontSize="8" fill={D} fillOpacity="0.45"
                fontFamily="'Plus Jakarta Sans', sans-serif" fontWeight="700">
                +{cells.length - MAX}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function BQAnnex({ visible, floors }: { visible: boolean; floors: number }) {
  const fl    = clampFloors(floors);
  const mainH = fl * FH;
  const bqH   = Math.min(mainH * 0.55, 80);
  const bqTop = GY - bqH;

  return (
    <AnimatePresence>
      {visible && (
        <motion.g
          key="bq"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.45, ease }}
        >
          {/* Connector */}
          <line x1={BL + BW} y1={GY - 24} x2={BL + BW + 16} y2={GY - 24} stroke={D} strokeWidth="1" strokeOpacity="0.3" strokeDasharray="4 3" />
          {/* BQ body */}
          <rect x={BL + BW + 16} y={bqTop} width="58" height={bqH} rx="1" fill={D} fillOpacity="0.03" stroke={D} strokeWidth="1.5" strokeOpacity="0.5" />
          {/* BQ windows */}
          {[0, 1].map(i => (
            <rect key={i} x={BL + BW + 24} y={bqTop + 8 + i * 26} width="20" height="16" rx="0.5" fill={D} fillOpacity="0.04" stroke={D} strokeWidth="1" strokeOpacity="0.4" />
          ))}
          <text x={BL + BW + 45} y={GY + 18} textAnchor="middle" fontSize="8" fill={D} fillOpacity="0.4" fontFamily="'Plus Jakarta Sans', sans-serif">BQ</text>
        </motion.g>
      )}
    </AnimatePresence>
  );
}

function Roof({ visible, roofType, floors }: { visible: boolean; roofType: string | null; floors: number }) {
  const top = buildingTop(floors);

  return (
    <AnimatePresence>
      {visible && (
        <motion.g
          key={`roof-${roofType}`}
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.55, ease, type: 'spring', bounce: 0.3 }}
        >
          {roofType === 'concrete_flat' ? (
            <>
              <rect x={BL - 6} y={top - 10} width={BW + 12} height="10" rx="0.5" fill={D} fillOpacity="0.08" stroke={D} strokeWidth="2" strokeOpacity="0.7" />
              <rect x={BL + 6} y={top - 20} width="12" height="10" rx="0.5" fill={D} fillOpacity="0.1" stroke={D} strokeWidth="1.2" strokeOpacity="0.5" />
              <rect x={BL + BW - 18} y={top - 20} width="12" height="10" rx="0.5" fill={D} fillOpacity="0.1" stroke={D} strokeWidth="1.2" strokeOpacity="0.5" />
            </>
          ) : (
            <>
              <path
                d={`M${BL - 8} ${top} L${CX} ${top - 44} L${BL + BW + 8} ${top}`}
                fill={D} fillOpacity="0.04"
                stroke={D} strokeWidth="2.5" strokeOpacity="0.7" strokeLinejoin="round"
              />
              {/* Ridge cap */}
              <circle cx={CX} cy={top - 44} r="3" fill={D} fillOpacity="0.4" />
              {roofType === 'clay_tiles' && (
                <>
                  {[8, 16, 24, 32].map(offset => (
                    <g key={offset}>
                      <line x1={CX - offset * 1.8} y1={top - offset} x2={CX} y2={top - 44} stroke={D} strokeWidth="0.8" strokeOpacity="0.22" />
                      <line x1={CX + offset * 1.8} y1={top - offset} x2={CX} y2={top - 44} stroke={D} strokeWidth="0.8" strokeOpacity="0.22" />
                    </g>
                  ))}
                </>
              )}
              {roofType === 'shingle' && (
                <>
                  {[0, 1, 2, 3].map(i => {
                    const y1 = top - i * 10;
                    const x1 = BL - 8 + i * 12;
                    return <line key={i} x1={x1} y1={y1} x2={CX} y2={top - 44} stroke={D} strokeWidth="0.7" strokeOpacity="0.2" />;
                  })}
                </>
              )}
            </>
          )}
        </motion.g>
      )}
    </AnimatePresence>
  );
}

function LocationPin({ visible, countryName }: { visible: boolean; countryName: string }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.g
          key="pin"
          initial={{ opacity: 0, y: -20, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0 }}
          style={{ transformOrigin: `${CX}px 230px` }}
          transition={{ duration: 0.5, ease, type: 'spring', bounce: 0.35 }}
        >
          {/* Ripple circles */}
          {[1, 2, 3].map(i => (
            <circle key={i} cx={CX} cy={GY - 20} r={i * 28}>
              <animate attributeName="r" values={`${i * 20};${i * 32};${i * 20}`} dur={`${2 + i * 0.6}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.15;0;0.15" dur={`${2 + i * 0.6}s`} repeatCount="indefinite" />
              <animate attributeName="stroke-opacity" values="0.15;0;0.15" dur={`${2 + i * 0.6}s`} repeatCount="indefinite" />
            </circle>
          ))}
          <circle cx={CX} cy={GY - 20} r="30" fill={D} fillOpacity="0.04" stroke={D} strokeWidth="1.5" strokeOpacity="0.15" />
          {/* Terrain */}
          <ellipse cx={CX} cy={GY} rx="100" ry="14" fill={D} fillOpacity="0.05" />
          <ellipse cx={CX} cy={GY} rx="60" ry="8" fill={D} fillOpacity="0.06" />
          {/* Pin body */}
          <motion.path
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
            d={`M${CX} ${GY - 140} C${CX} ${GY - 140} ${CX - 34} ${GY - 100} ${CX - 34} ${GY - 80} C${CX - 34} ${GY - 60} ${CX - 18} ${GY - 48} ${CX} ${GY - 48} C${CX + 18} ${GY - 48} ${CX + 34} ${GY - 60} ${CX + 34} ${GY - 80} C${CX + 34} ${GY - 100} ${CX} ${GY - 140} ${CX} ${GY - 140}Z`}
            fill={D} fillOpacity="0.08"
            stroke={D} strokeWidth="2.5" strokeOpacity="0.8"
          />
          <motion.circle
            cx={CX} cy={GY - 86}
            r="11"
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
            fill={D} fillOpacity="0.7"
          />
          {/* Pin shadow */}
          <ellipse cx={CX} cy={GY - 44}>
            <animate attributeName="rx" values="8;16;8" dur="3.5s" repeatCount="indefinite" />
            <animate attributeName="ry" values="3;6;3" dur="3.5s" repeatCount="indefinite" />
            <animate attributeName="fill-opacity" values="0.12;0.04;0.12" dur="3.5s" repeatCount="indefinite" />
          </ellipse>
        </motion.g>
      )}
    </AnimatePresence>
  );
}

function CompletionCelebration({ visible, floors }: { visible: boolean; floors: number }) {
  const bTop = buildingTop(floors);
  const midY = (bTop + GY) / 2;

  return (
    <AnimatePresence>
      {visible && (
        <motion.g key="celebrate"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}>
          <defs>
            <radialGradient id="glow-grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={D} stopOpacity="0.07" />
              <stop offset="100%" stopColor={D} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Ambient glow behind building */}
          <ellipse cx={CX} cy={midY} rx={BW * 0.8} ry={(GY - bTop) * 0.55} fill="url(#glow-grad)">
            <animate attributeName="rx" values={`${BW*0.7};${BW};${BW*0.7}`} dur="4s" repeatCount="indefinite" />
            <animate attributeName="ry" values={`${(GY-bTop)*0.5};${(GY-bTop)*0.65};${(GY-bTop)*0.5}`} dur="4s" repeatCount="indefinite" />
          </ellipse>

          {/* Shadow pool */}
          <ellipse cx={CX} cy={GY} rx="120" ry="14" fill={D} fillOpacity="0.06" />

          {/* Sparkle stars around roofline — cross shape */}
          {[0,1,2,3,4,5,6,7,8,9].map(i => {
            const spread = i % 2 === 0 ? 110 : 80;
            const ang = (i / 10) * Math.PI * 2;
            const sx = CX + Math.cos(ang) * spread;
            const sy = bTop - 20 + Math.sin(ang) * 55;
            const dur = 1.2 + (i % 4) * 0.22;
            const beg = `${i * 0.18}s`;
            return (
              <g key={i}>
                <circle cx={sx} cy={sy} r="2.5" fill={D}>
                  <animate attributeName="opacity" values="0;0.85;0" dur={`${dur}s`} begin={beg} repeatCount="indefinite" />
                  <animate attributeName="r" values="1;3.5;1" dur={`${dur}s`} begin={beg} repeatCount="indefinite" />
                </circle>
                <line x1={sx - 5} y1={sy} x2={sx + 5} y2={sy} stroke={D} strokeWidth="1.2">
                  <animate attributeName="stroke-opacity" values="0;0.5;0" dur={`${dur}s`} begin={beg} repeatCount="indefinite" />
                </line>
                <line x1={sx} y1={sy - 5} x2={sx} y2={sy + 5} stroke={D} strokeWidth="1.2">
                  <animate attributeName="stroke-opacity" values="0;0.5;0" dur={`${dur}s`} begin={beg} repeatCount="indefinite" />
                </line>
              </g>
            );
          })}

          {/* Particles raining from roofline */}
          {Array.from({ length: 18 }, (_, i) => {
            const xOff = ((i * 19 + 5) % (BW - 10));
            const px   = BL + 5 + xOff;
            const dur  = 1.6 + (i % 5) * 0.28;
            const beg  = `${(i * 0.13) % 1.8}s`;
            const startY = bTop - 10;
            const endY   = GY - 10;
            return (
              <circle key={i} cx={px} cy={startY} r="1.8" fill={D}>
                <animate attributeName="cy" values={`${startY};${endY}`} dur={`${dur}s`} begin={beg} repeatCount="indefinite" calcMode="linear" />
                <animate attributeName="opacity" values="0;0.55;0.55;0" dur={`${dur}s`} begin={beg} repeatCount="indefinite" />
                <animate attributeName="r" values="1.5;2.5;1" dur={`${dur}s`} begin={beg} repeatCount="indefinite" />
              </circle>
            );
          })}

          {/* Pulsing ring around building base */}
          <rect x={BL - 4} y={bTop - 4} width={BW + 8} height={GY - bTop + 4} rx="2"
            fill="none" stroke={D} strokeWidth="1.5">
            <animate attributeName="stroke-opacity" values="0;0.35;0" dur="2.5s" repeatCount="indefinite" />
            <animate attributeName="stroke-dasharray" values="0 1000;60 940;0 1000" dur="2.5s" repeatCount="indefinite" />
          </rect>
        </motion.g>
      )}
    </AnimatePresence>
  );
}

function Signpost({ visible, name }: { visible: boolean; name: string }) {
  return (
    <AnimatePresence>
      {visible && name.trim().length > 0 && (
        <motion.g
          key="sign"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease }}
        >
          <line x1={BL + 20} y1={GY - 52} x2={BL + 20} y2={GY} stroke={D} strokeWidth="1.5" strokeOpacity="0.35" />
          <rect x={BL - 16} y={GY - 66} width="72" height="20" rx="3" fill="white" stroke={D} strokeWidth="1.2" strokeOpacity="0.45" />
          <text x={BL + 20} y={GY - 53} textAnchor="middle" fontSize="8" fill={D} fillOpacity="0.8" fontFamily="'Plus Jakarta Sans', sans-serif" fontWeight="600">
            {name.length > 12 ? name.slice(0, 12) + '…' : name}
          </text>
        </motion.g>
      )}
    </AnimatePresence>
  );
}

// ── Per-step badge content ─────────────────────────────────────

function StepBadges({ step, data }: { step: number; data: ReturnType<typeof useWizard>['data'] }) {
  const budget = step === 9 ? calculateBudget(data) : null;

  return (
    <AnimatePresence mode="popLayout">
      {step === 1 && data.country && (
        <Badge key="loc" icon={<MapPin className="size-3.5" />} label={`Building in ${data.countryName}`} pos="tr" />
      )}
      {step === 2 && (
        <Badge key="type" icon={<Building2 className="size-3.5" />} label="Planning phase" sub="Foundation next" pos="tr" />
      )}
      {step === 3 && data.buildingType && (
        <Badge key="bt" icon={<Building2 className="size-3.5" />} label={getBuildingTypeLabel(data.buildingType)} pos="tr" />
      )}
      {step === 4 && (
        <>
          <Badge key="floors" icon={<Layers className="size-3.5" />} label={`${data.floors} ${data.floors === 1 ? 'floor' : 'floors'}`} sub={`${data.floors * 3}m tall`} pos="tr" />
          <InfoBadge pos="bl" delay={0.2}>
            <div className="flex items-center gap-1.5">
              <Ruler className="size-3 opacity-50" />
              <span className="opacity-60">Est. height</span>
              <span className="font-semibold">{data.floors * 3}m</span>
            </div>
          </InfoBadge>
        </>
      )}
      {step === 5 && (
        <>
          <Badge
            key={`rooms-${data.bedrooms}-${data.bathrooms}`}
            icon={<Home className="size-3.5" />}
            label={`${data.bedrooms} beds · ${data.bathrooms} baths`}
            pos="tr"
          />
          {(data.kitchens > 0 || data.livingRooms > 0) && (
            <InfoBadge key={`extra-${data.kitchens}-${data.livingRooms}`} pos="bl" delay={0.1}>
              <span className="opacity-60">Kitchen </span>
              <span className="font-semibold">{data.kitchens}</span>
              <span className="mx-2 opacity-30">·</span>
              <span className="opacity-60">Living </span>
              <span className="font-semibold">{data.livingRooms}</span>
            </InfoBadge>
          )}
        </>
      )}
      {step === 6 && data.hasBoysQuarters && (
        <Badge key="bq" icon={<Home className="size-3.5" />} label={`Staff Quarters ×${data.bqRooms}`} pos="tr" />
      )}
      {step === 7 && data.roofType && (
        <Badge key="roof" icon={<Wrench className="size-3.5" />} label={getRoofLabel(data.roofType)} pos="tr" />
      )}
      {step === 8 && data.projectName && (
        <Badge key="name" icon={<Building2 className="size-3.5" />} label={data.projectName} sub={data.city || undefined} pos="tr" />
      )}
      {step === 9 && budget && (
        <>
          <Badge key="budget" icon={<DollarSign className="size-3.5" />} label={formatUSD(budget.total)} sub="est." pos="tr" />
          <Badge key="done" icon={<CheckCircle2 className="size-3.5" />} label="Ready to build" pos="bl" />
        </>
      )}
    </AnimatePresence>
  );
}

function getBuildingTypeLabel(bt: string): string {
  const map: Record<string, string> = {
    single_family: 'Single Family', multi_family: 'Multi-Family', townhouse: 'Townhouse',
    semi_detached: 'Semi-Detached', office: 'Office Building', retail: 'Retail',
    warehouse_commercial: 'Warehouse', hotel: 'Hotel', factory: 'Factory',
    warehouse_industrial: 'Industrial', industrial_complex: 'Industrial Complex',
    distribution_centre: 'Distribution Centre', mixed_residential_commercial: 'Mixed Use',
    live_work: 'Live / Work', mixed_retail_residential: 'Retail + Residential', transit_oriented: 'Transit-Oriented',
  };
  return map[bt] ?? bt;
}

function getRoofLabel(rt: string): string {
  const map: Record<string, string> = {
    long_span_aluminum: 'Long Span Aluminum', clay_tiles: 'Clay Tiles',
    concrete_flat: 'Concrete Flat', shingle: 'Shingle',
  };
  return map[rt] ?? rt;
}

// ── Step hint text ─────────────────────────────────────────────

function getHint(step: number, data: ReturnType<typeof useWizard>['data']): string {
  switch (step) {
    case 1: return data.countryName ? `Building in ${data.countryName}` : 'Choose your location';
    case 2: return 'What kind of project?';
    case 3: return 'Defining the building type';
    case 4: return `${data.floors} ${data.floors === 1 ? 'storey' : 'storeys'}`;
    case 5: return 'Rooms per floor';
    case 6: return data.hasBoysQuarters ? 'Including staff annex' : 'Main building only';
    case 7: return data.roofType ? getRoofLabel(data.roofType) : 'Choose a roof type';
    case 8: return data.projectName || 'Name your project';
    case 9: return 'Ready to build';
    default: return '';
  }
}

// ── Room-change flash particle ─────────────────────────────────

function RoomChangeBurst({ totalRooms, step }: { totalRooms: number; step: number }) {
  const prevRef  = useRef(totalRooms);
  const controls = useAnimation();

  useEffect(() => {
    if (step !== 5) { prevRef.current = totalRooms; return; }
    if (totalRooms !== prevRef.current) {
      const delta = totalRooms - prevRef.current;
      prevRef.current = totalRooms;
      if (delta !== 0) {
        controls.start({
          opacity: [0, 1, 1, 0],
          y: [0, -24, -36, -48],
          scale: [0.7, 1.1, 1, 0.9],
          transition: { duration: 0.9, ease: 'easeOut' },
        });
      }
    }
  }, [totalRooms, step, controls]);

  const label = totalRooms > (prevRef.current - 1)
    ? `+room`
    : `−room`;

  return (
    <motion.div
      animate={controls}
      initial={{ opacity: 0 }}
      className="absolute left-1/2 -translate-x-1/2 bottom-[42%] z-30 pointer-events-none"
    >
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-near-black text-white text-[10px] font-bold px-2.5 py-1 shadow-lg">
        {label}
      </span>
    </motion.div>
  );
}

// ── Main component ─────────────────────────────────────────────

export function BuildingPreview() {
  const { step, data } = useWizard();

  const isMapStep      = step === 1;
  const isImageStep    = step === 2 || step === 3 || step === 7;
  const showCrane      = step >= 4 && step <= 5;
  const showFoundation = step >= 4;
  const totalRooms     = data.bedrooms + data.bathrooms + data.livingRooms + data.kitchens;
  const showBody       = step >= 4;
  const showWindows    = step >= 5;
  const showBQ         = step >= 6 && data.hasBoysQuarters;
  const showRoof       = step >= 8 && !!data.roofType;
  const showSign       = step >= 8;
  const showComplete   = step >= 9;

  // Which image key to show per step
  const imageKey = step === 2
    ? (data.projectType ?? null)
    : step === 3
      ? (data.buildingType ?? data.projectType ?? null)
      : step === 7
        ? (data.roofType ?? null)
        : null;

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden">

      {/* ── Step 1: Real satellite map ───────────────────────── */}
      <AnimatePresence>
        {isMapStep && (
          <motion.div
            key="map"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0 z-0"
          >
            {data.country ? (
              <CountryMap countryCode={data.country} countryName={data.countryName} />
            ) : (
              <MapEmptyState />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Steps 2, 3, 7: Photo image panel ────────────────── */}
      <AnimatePresence>
        {isImageStep && (
          <motion.div
            key={`image-${step}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 z-0"
          >
            <ImagePanel imageKey={imageKey} />
            {/* Hint label top-left */}
            <div className="absolute top-0 left-0 right-0 z-20 px-6 pt-5 pointer-events-none">
              <AnimatePresence mode="wait">
                <motion.p
                  key={step}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.25 }}
                  className="text-[11px] font-semibold text-white/60 uppercase tracking-wider drop-shadow-sm"
                >
                  {getHint(step, data)}
                </motion.p>
              </AnimatePresence>
            </div>
            {/* Floating badges on top of image */}
            <div className="absolute inset-0 z-20 pointer-events-none">
              <StepBadges step={step} data={data} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Steps 4-9: Blueprint SVG animation ──────────────── */}
      <AnimatePresence>
        {!isMapStep && !isImageStep && (
          <motion.div
            key="blueprint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 flex flex-col"
          >
            {/* Dot-grid background — dark-mode aware */}
            <div
              className="absolute inset-0 pointer-events-none dark:opacity-25"
              style={{
                backgroundImage: 'radial-gradient(circle, rgba(10,10,10,0.18) 1px, transparent 1px)',
                backgroundSize: '28px 28px',
              }}
            />

            {/* Step hint */}
            <div className="relative z-10 px-6 pt-5 pb-2 shrink-0">
              <AnimatePresence mode="wait">
                <motion.p
                  key={step}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.25 }}
                  className="text-[11px] font-semibold text-brand-mid-grey dark:text-white/40 uppercase tracking-wider"
                >
                  {getHint(step, data)}
                </motion.p>
              </AnimatePresence>
            </div>

            {/* Main visual area */}
            <div className="relative flex-1 flex items-end justify-center overflow-hidden">
              <RoomChangeBurst totalRooms={totalRooms} step={step} />
              <StepBadges step={step} data={data} />

              {/* SVG — dark:invert so blueprint lines show on dark background */}
              <svg
                viewBox="0 0 380 470"
                className="w-full h-full dark:filter-[invert(0.88)]"
                preserveAspectRatio="xMidYMax meet"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <BlueprintGrid />
                <Crane visible={showCrane} step={step} />
                <Foundation visible={showFoundation} />
                <AnimatePresence>
                  {showBody && (
                    <BuildingBody visible={showBody} floors={data.floors} buildingType={data.buildingType} />
                  )}
                </AnimatePresence>
                {showWindows && (
                  <Windows
                    visible={showWindows}
                    floors={data.floors}
                    floorRooms={data.floorRooms}
                    activeFloor={data.previewActiveFloor ?? 0}
                  />
                )}
                <AnimatePresence>
                  {showBQ && <BQAnnex visible={showBQ} floors={data.floors} />}
                </AnimatePresence>
                <Roof visible={showRoof} roofType={data.roofType} floors={data.floors} />
                <Signpost visible={showSign} name={data.projectName} />
                <Ground />
                <CompletionCelebration visible={showComplete} floors={data.floors} />
              </svg>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Step hint overlay for map step */}
      {isMapStep && (
        <div className="relative z-10 px-6 pt-5 pb-2 shrink-0 pointer-events-none">
          <AnimatePresence mode="wait">
            <motion.p
              key={step}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.25 }}
              className="text-[11px] font-semibold text-white/80 uppercase tracking-wider drop-shadow-sm"
            >
              {getHint(step, data)}
            </motion.p>
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
