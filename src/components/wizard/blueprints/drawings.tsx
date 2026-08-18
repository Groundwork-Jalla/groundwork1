import { Blueprint, Dim, Door, Ground, Hatch, Ink, Note, Storeys, Win, WinRow } from './frame';

// =========================================================
// One elevation per selectable type. Read the frame module first — everything here is
// a composition of its primitives, and the fidelity lives there.
//
// Each drawing is written in build order: ground, shell, structure, openings, roof,
// then annotation. That order is what the stagger animates through, so a sketch that
// is composed out of order will also *draw* out of order.
//
// Scale is nominal, not literal: 320x248 units reading as roughly 24m of frontage.
// Dimension figures are indicative and deliberately round — they say "this is a
// drawing", they are not a quantity anyone should take off.
// =========================================================

const G = 196;   // ground line

// ── Project type (step 2) ─────────────────────────────────

export const residential = (
  <Blueprint>
    <Ground />
    {/* Two-storey house: plinth, storeys, pitched roof, chimney */}
    <Ink as="rect" x={86} y={104} width={148} height={92} />
    <Hatch x={86} y={186} w={148} h={10} gap={6} />
    <Storeys x={86} y={104} w={148} h={92} floors={2} />
    <Ink d="M 74 106 L 160 58 L 246 106" bold />
    <Ink as="line" x1={74} y1={106} x2={86} y2={106} faint />
    <Ink as="line" x1={234} y1={106} x2={246} y2={106} faint />
    <Ink as="rect" x={196} y={70} width={13} height={26} />
    <Ink as="line" x1={194} y1={70} x2={211} y2={70} />
    <WinRow x={96} y={116} w={128} h={22} count={3} cols={2} />
    <Win x={100} y={158} w={30} h={26} cols={2} rows={2} />
    <Win x={192} y={158} w={30} h={26} cols={2} rows={2} />
    <Door x={146} y={162} w={26} h={34} />
    <Dim x1={86} y1={214} x2={234} y2={214} label="14 850" />
    <Dim x1={64} y1={104} x2={64} y2={196} label="6 200" />
    <Note x={160} y={50} anchor="middle">RESIDENTIAL — FRONT ELEVATION</Note>
  </Blueprint>
);

export const commercial = (
  <Blueprint>
    <Ground />
    {/* Curtain-walled block with a recessed entrance bay */}
    <Ink as="rect" x={78} y={54} width={164} height={142} bold />
    <Hatch x={78} y={188} w={164} h={8} gap={6} />
    <Storeys x={78} y={54} w={164} h={142} floors={5} />
    {[0, 1, 2, 3].map(i => (
      <WinRow key={i} x={86} y={62 + i * 28.4} w={148} h={17} count={5} cols={2} />
    ))}
    <Ink as="rect" x={128} y={168} width={64} height={28} />
    <Ink as="line" x1={160} y1={168} x2={160} y2={196} faint />
    <Ink as="line" x1={120} y1={164} x2={200} y2={164} />
    <Ink as="rect" x={246} y={92} width={16} height={104} faint />
    <Dim x1={78} y1={214} x2={242} y2={214} label="18 400" />
    <Dim x1={58} y1={54} x2={58} y2={196} label="17 500" />
    <Note x={160} y={44} anchor="middle">COMMERCIAL — FRONT ELEVATION</Note>
  </Blueprint>
);

export const industrial = (
  <Blueprint>
    <Ground />
    {/* Portal-frame shed: sawtooth roof lights, roller shutters */}
    <Ink as="rect" x={40} y={116} width={216} height={80} bold />
    <Hatch x={40} y={188} w={216} h={8} gap={6} />
    {[0, 1, 2, 3].map(i => (
      <Ink key={i} d={`M ${44 + i * 54} 116 L ${44 + i * 54} 96 L ${90 + i * 54} 96 L ${90 + i * 54} 116`} />
    ))}
    {[0, 1, 2, 3].map(i => (
      <Ink key={`g${i}`} as="line" x1={44 + i * 54} y1={96} x2={90 + i * 54} y2={106} faint />
    ))}
    {[0, 1, 2].map(i => (
      <Ink key={`c${i}`} as="line" x1={94 + i * 54} y1={116} x2={94 + i * 54} y2={196} faint />
    ))}
    <Ink as="rect" x={56} y={148} width={52} height={48} />
    {Array.from({ length: 6 }, (_, i) => 154 + i * 8).map(y => (
      <Ink key={y} as="line" x1={56} y1={y} x2={108} y2={y} faint />
    ))}
    <Ink as="rect" x={188} y={148} width={52} height={48} />
    {Array.from({ length: 6 }, (_, i) => 154 + i * 8).map(y => (
      <Ink key={`r${y}`} as="line" x1={188} y1={y} x2={240} y2={y} faint />
    ))}
    <Win x={130} y={132} w={36} h={16} cols={3} />
    <Dim x1={40} y1={214} x2={256} y2={214} label="27 000" />
    <Note x={148} y={86} anchor="middle">INDUSTRIAL — NORTH-LIGHT SHED</Note>
  </Blueprint>
);

export const mixed_use = (
  <Blueprint>
    <Ground />
    {/* Retail plinth, residential above, expressed as a change of grain */}
    <Ink as="rect" x={82} y={50} width={156} height={146} bold />
    <Hatch x={82} y={188} w={156} h={8} gap={6} />
    <Ink as="line" x1={82} y1={144} x2={238} y2={144} bold />
    <Storeys x={82} y={50} w={156} h={94} floors={3} />
    {[0, 1, 2].map(i => (
      <WinRow key={i} x={90} y={58 + i * 31.3} w={140} h={20} count={4} cols={2} />
    ))}
    <Ink as="rect" x={92} y={152} width={54} height={44} />
    <Ink as="rect" x={174} y={152} width={54} height={44} />
    <Door x={150} y={162} w={20} h={34} swing={false} />
    <Ink as="line" x1={86} y1={148} x2={234} y2={148} faint />
    <Note x={119} y={176} anchor="middle" size={6}>RETAIL</Note>
    <Note x={201} y={176} anchor="middle" size={6}>RETAIL</Note>
    <Dim x1={82} y1={214} x2={238} y2={214} label="17 200" />
    <Dim x1={62} y1={50} x2={62} y2={144} label="RESI" />
    <Note x={160} y={40} anchor="middle">MIXED USE — FRONT ELEVATION</Note>
  </Blueprint>
);

// ── Residential building types (step 3) ───────────────────

export const single_family = (
  <Blueprint>
    <Ground />
    <Ink as="rect" x={92} y={118} width={136} height={78} />
    <Hatch x={92} y={188} w={136} h={8} gap={6} />
    <Ink d="M 80 120 L 160 68 L 240 120" bold />
    <Ink as="rect" x={198} y={78} width={12} height={26} />
    <Win x={104} y={130} w={34} h={26} cols={2} rows={2} />
    <Win x={182} y={130} w={34} h={26} cols={2} rows={2} />
    <Door x={146} y={162} w={26} h={34} />
    <Ink as="line" x1={132} y1={196} x2={186} y2={196} faint />
    <Ink as="rect" x={236} y={148} width={30} height={48} faint />
    <Note x={251} y={176} anchor="middle" size={6}>GAR</Note>
    <Dim x1={92} y1={214} x2={228} y2={214} label="12 400" />
    <Note x={160} y={58} anchor="middle">DETACHED — SINGLE FAMILY</Note>
  </Blueprint>
);

export const multi_family = (
  <Blueprint>
    <Ground />
    <Ink as="rect" x={76} y={52} width={168} height={144} bold />
    <Hatch x={76} y={188} w={168} h={8} gap={6} />
    <Storeys x={76} y={52} w={168} h={144} floors={5} />
    {[0, 1, 2, 3].map(i => (
      <WinRow key={i} x={84} y={60 + i * 28.8} w={152} h={18} count={4} cols={2} />
    ))}
    {[0, 1, 2, 3].map(i => (
      <Ink key={`b${i}`} as="line" x1={84} y1={82 + i * 28.8} x2={236} y2={82 + i * 28.8} faint />
    ))}
    <Door x={148} y={170} w={24} h={26} />
    <Win x={92} y={168} w={40} h={22} cols={3} />
    <Win x={188} y={168} w={40} h={22} cols={3} />
    <Dim x1={76} y1={214} x2={244} y2={214} label="19 600" />
    <Dim x1={56} y1={52} x2={56} y2={196} label="5 LEVELS" />
    <Note x={160} y={42} anchor="middle">APARTMENT BLOCK</Note>
  </Blueprint>
);

export const townhouse = (
  <Blueprint>
    <Ground />
    {/* Three repeating units, party walls expressed bold */}
    {[0, 1, 2].map(i => (
      <Ink key={i} as="rect" x={64 + i * 64} y={96} width={64} height={100} />
    ))}
    <Hatch x={64} y={188} w={192} h={8} gap={6} />
    {[1, 2].map(i => (
      <Ink key={`p${i}`} as="line" x1={64 + i * 64} y1={96} x2={64 + i * 64} y2={196} bold />
    ))}
    {[0, 1, 2].map(i => (
      <Ink key={`r${i}`} d={`M ${58 + i * 64} 98 L ${96 + i * 64} 70 L ${134 + i * 64} 98`} />
    ))}
    {[0, 1, 2].map(i => (
      <Win key={`w${i}`} x={78 + i * 64} y={110} w={36} h={22} cols={2} />
    ))}
    {[0, 1, 2].map(i => (
      <Door key={`d${i}`} x={84 + i * 64} y={164} w={22} h={32} swing={false} />
    ))}
    {[0, 1, 2].map(i => (
      <Win key={`v${i}`} x={110 + i * 64} y={150} w={14} h={14} cols={1} />
    ))}
    <Dim x1={64} y1={214} x2={128} y2={214} label="5 400" />
    <Dim x1={128} y1={214} x2={256} y2={214} label="10 800" />
    <Note x={160} y={60} anchor="middle">TERRACE — 3 UNITS</Note>
  </Blueprint>
);

export const semi_detached = (
  <Blueprint>
    <Ground />
    <Ink as="rect" x={70} y={104} width={90} height={92} />
    <Ink as="rect" x={160} y={104} width={90} height={92} />
    <Hatch x={70} y={188} w={180} h={8} gap={6} />
    <Ink as="line" x1={160} y1={104} x2={160} y2={196} bold />
    <Ink d="M 60 106 L 115 66 L 160 96 L 205 66 L 260 106" bold />
    <Win x={84} y={118} w={30} h={22} cols={2} />
    <Win x={196} y={118} w={30} h={22} cols={2} />
    <Door x={128} y={164} w={22} h={32} swing={false} />
    <Door x={172} y={164} w={22} h={32} swing={false} />
    <Win x={84} y={156} w={30} h={22} cols={2} />
    <Win x={196} y={156} w={30} h={22} cols={2} />
    <Dim x1={70} y1={214} x2={160} y2={214} label="7 600" />
    <Dim x1={160} y1={214} x2={250} y2={214} label="7 600" />
    <Note x={160} y={56} anchor="middle">SEMI-DETACHED PAIR</Note>
  </Blueprint>
);

// ── Commercial building types (step 3) ────────────────────

export const office = (
  <Blueprint>
    <Ground />
    <Ink as="rect" x={72} y={48} width={176} height={148} bold />
    <Hatch x={72} y={188} w={176} h={8} gap={6} />
    <Storeys x={72} y={48} w={176} h={148} floors={6} />
    {[0, 1, 2, 3, 4].map(i => (
      <Ink key={i} as="rect" x={80} y={56 + i * 24.6} width={160} height={15} />
    ))}
    {[0, 1, 2, 3, 4].map(i => (
      <Ink key={`m${i}`} as="line" x1={160} y1={56 + i * 24.6} x2={160} y2={71 + i * 24.6} faint />
    ))}
    {[0, 1, 2, 3, 4].map(i => (
      <Ink key={`n${i}`} as="line" x1={120} y1={56 + i * 24.6} x2={120} y2={71 + i * 24.6} faint />
    ))}
    {[0, 1, 2, 3, 4].map(i => (
      <Ink key={`o${i}`} as="line" x1={200} y1={56 + i * 24.6} x2={200} y2={71 + i * 24.6} faint />
    ))}
    <Ink as="rect" x={132} y={172} width={56} height={24} />
    <Ink as="line" x1={160} y1={172} x2={160} y2={196} faint />
    <Ink as="line" x1={124} y1={168} x2={196} y2={168} bold />
    <Dim x1={72} y1={214} x2={248} y2={214} label="21 000" />
    <Dim x1={54} y1={48} x2={54} y2={196} label="6 LEVELS" />
    <Note x={160} y={38} anchor="middle">OFFICE — CURTAIN WALL</Note>
  </Blueprint>
);

export const retail = (
  <Blueprint>
    <Ground />
    <Ink as="rect" x={62} y={92} width={196} height={104} bold />
    <Hatch x={62} y={188} w={196} h={8} gap={6} />
    {/* Full-height shopfront glazing with a fascia band above */}
    <Ink as="rect" x={62} y={92} width={196} height={26} />
    <Note x={160} y={109} anchor="middle" size={7}>SHOPFRONT SIGNAGE</Note>
    <Ink as="rect" x={72} y={128} width={176} height={68} />
    {[1, 2, 3, 4, 5].map(i => (
      <Ink key={i} as="line" x1={72 + i * 29.3} y1={128} x2={72 + i * 29.3} y2={196} faint />
    ))}
    <Ink as="line" x1={72} y1={146} x2={248} y2={146} faint />
    <Door x={144} y={152} w={32} h={44} swing={false} />
    <Ink as="line" x1={160} y1={152} x2={160} y2={196} faint />
    {/* Canopy */}
    <Ink d="M 56 124 L 264 124 L 258 118 L 62 118 Z" faint />
    <Dim x1={62} y1={214} x2={258} y2={214} label="23 500" />
    <Note x={160} y={80} anchor="middle">RETAIL UNIT — SHOPFRONT</Note>
  </Blueprint>
);

export const warehouse_commercial = (
  <Blueprint>
    <Ground />
    <Ink as="rect" x={44} y={112} width={232} height={84} bold />
    <Hatch x={44} y={188} w={232} h={8} gap={6} />
    <Ink d="M 38 114 L 160 88 L 282 114" bold />
    {/* Profiled cladding runs */}
    {Array.from({ length: 11 }, (_, i) => 56 + i * 21).map(x => (
      <Ink key={x} as="line" x1={x} y1={112} x2={x} y2={196} faint />
    ))}
    <Ink as="rect" x={64} y={140} width={64} height={56} />
    {Array.from({ length: 7 }, (_, i) => 146 + i * 8).map(y => (
      <Ink key={y} as="line" x1={64} y1={y} x2={128} y2={y} faint />
    ))}
    <Door x={148} y={158} w={24} h={38} />
    <Win x={196} y={132} w={60} h={18} cols={4} />
    <Ink as="line" x1={44} y1={126} x2={276} y2={126} faint />
    <Dim x1={44} y1={214} x2={276} y2={214} label="29 000" />
    <Note x={160} y={78} anchor="middle">TRADE WAREHOUSE</Note>
  </Blueprint>
);

export const hotel = (
  <Blueprint>
    <Ground />
    <Ink as="rect" x={70} y={44} width={180} height={152} bold />
    <Hatch x={70} y={188} w={180} h={8} gap={6} />
    <Storeys x={70} y={44} w={180} h={152} floors={6} />
    {/* Repeating guest-room bays with balconies — the hotel tell */}
    {[0, 1, 2, 3].map(r => (
      <WinRow key={r} x={78} y={52 + r * 25.3} w={164} h={15} count={6} cols={1} />
    ))}
    {[0, 1, 2, 3].map(r => (
      <Ink key={`bal${r}`} as="line" x1={78} y1={69 + r * 25.3} x2={242} y2={69 + r * 25.3} faint />
    ))}
    {/* Porte-cochère */}
    <Ink d="M 92 172 L 92 152 L 228 152 L 228 172" />
    <Ink as="line" x1={86} y1={152} x2={234} y2={152} bold />
    <Door x={148} y={166} w={24} h={30} swing={false} />
    <Ink as="line" x1={100} y1={196} x2={100} y2={152} faint />
    <Ink as="line" x1={220} y1={196} x2={220} y2={152} faint />
    <Dim x1={70} y1={214} x2={250} y2={214} label="21 500" />
    <Note x={160} y={34} anchor="middle">HOTEL — GUEST ROOM BAYS</Note>
  </Blueprint>
);

// ── Industrial building types (step 3) ────────────────────

export const factory = (
  <Blueprint>
    <Ground />
    <Ink as="rect" x={48} y={118} width={200} height={78} bold />
    <Hatch x={48} y={188} w={200} h={8} gap={6} />
    {[0, 1, 2].map(i => (
      <Ink key={i} d={`M ${56 + i * 66} 118 L ${56 + i * 66} 94 L ${110 + i * 66} 94 L ${110 + i * 66} 118`} />
    ))}
    {[0, 1, 2].map(i => (
      <Ink key={`gl${i}`} as="line" x1={56 + i * 66} y1={94} x2={110 + i * 66} y2={108} faint />
    ))}
    {/* Stack */}
    <Ink as="rect" x={262} y={66} width={18} height={130} />
    <Ink as="line" x1={258} y1={66} x2={284} y2={66} />
    <Ink as="line" x1={262} y1={92} x2={280} y2={92} faint />
    <Ink as="line" x1={262} y1={120} x2={280} y2={120} faint />
    <Ink as="rect" x={64} y={146} width={56} height={50} />
    {Array.from({ length: 6 }, (_, i) => 152 + i * 8).map(y => (
      <Ink key={y} as="line" x1={64} y1={y} x2={120} y2={y} faint />
    ))}
    <Door x={150} y={160} w={22} h={36} />
    <Win x={192} y={134} w={44} h={16} cols={3} />
    <Dim x1={48} y1={214} x2={248} y2={214} label="25 000" />
    <Note x={150} y={84} anchor="middle">FACTORY — PRODUCTION HALL</Note>
  </Blueprint>
);

export const warehouse_industrial = (
  <Blueprint>
    <Ground />
    <Ink as="rect" x={36} y={106} width={248} height={90} bold />
    <Hatch x={36} y={188} w={248} h={8} gap={6} />
    <Ink d="M 30 108 L 160 80 L 290 108" bold />
    <Ink as="line" x1={160} y1={80} x2={160} y2={106} faint />
    {/* Loading bays with dock levellers */}
    {[0, 1, 2, 3].map(i => (
      <Ink key={i} as="rect" x={56 + i * 58} y={140} width={42} height={56} />
    ))}
    {[0, 1, 2, 3].map(i => (
      Array.from({ length: 6 }, (_, k) => 146 + k * 9).map(y => (
        <Ink key={`${i}-${y}`} as="line" x1={56 + i * 58} y1={y} x2={98 + i * 58} y2={y} faint />
      ))
    ))}
    {[0, 1, 2, 3].map(i => (
      <Ink key={`d${i}`} as="line" x1={52 + i * 58} y1={196} x2={102 + i * 58} y2={196} bold />
    ))}
    <Ink as="line" x1={36} y1={122} x2={284} y2={122} faint />
    <Dim x1={36} y1={214} x2={284} y2={214} label="31 000" />
    <Note x={160} y={70} anchor="middle">DISTRIBUTION WAREHOUSE</Note>
  </Blueprint>
);

export const industrial_complex = (
  <Blueprint>
    <Ground />
    {/* Three linked volumes of differing height — a complex, not one shed */}
    <Ink as="rect" x={30} y={132} width={80} height={64} bold />
    <Ink as="rect" x={110} y={104} width={100} height={92} bold />
    <Ink as="rect" x={210} y={140} width={80} height={56} bold />
    <Hatch x={30} y={188} w={260} h={8} gap={6} />
    <Ink d="M 104 106 L 160 84 L 216 106" />
    {[0, 1].map(i => (
      <Ink key={i} d={`M ${120 + i * 44} 104 L ${120 + i * 44} 90 L ${152 + i * 44} 90 L ${152 + i * 44} 104`} faint />
    ))}
    <Ink as="rect" x={44} y={152} width={52} height={44} />
    {Array.from({ length: 5 }, (_, i) => 158 + i * 9).map(y => (
      <Ink key={y} as="line" x1={44} y1={y} x2={96} y2={y} faint />
    ))}
    <Win x={124} y={124} w={72} h={16} cols={5} />
    <Ink as="rect" x={224} y={158} width={52} height={38} />
    {/* Link bridge */}
    <Ink as="line" x1={110} y1={148} x2={110} y2={132} faint />
    <Ink as="line" x1={210} y1={156} x2={210} y2={140} faint />
    <Dim x1={30} y1={214} x2={290} y2={214} label="33 000" />
    <Note x={160} y={74} anchor="middle">INDUSTRIAL COMPLEX</Note>
  </Blueprint>
);

export const distribution_centre = (
  <Blueprint>
    <Ground />
    <Ink as="rect" x={32} y={116} width={256} height={80} bold />
    <Hatch x={32} y={188} w={256} h={8} gap={6} />
    <Ink as="line" x1={32} y1={116} x2={288} y2={116} bold />
    <Ink as="line" x1={32} y1={128} x2={288} y2={128} faint />
    {/* A long dock face: six bays, canopy over */}
    <Ink d="M 26 138 L 294 138 L 288 130 L 32 130 Z" faint />
    {Array.from({ length: 6 }, (_, i) => 44 + i * 40).map((x, i) => (
      <Ink key={i} as="rect" x={x} y={146} width={30} height={50} />
    ))}
    {Array.from({ length: 6 }, (_, i) => 44 + i * 40).map((x, i) => (
      Array.from({ length: 5 }, (_, k) => 152 + k * 9).map(y => (
        <Ink key={`${i}-${y}`} as="line" x1={x} y1={y} x2={x + 30} y2={y} faint />
      ))
    ))}
    {Array.from({ length: 6 }, (_, i) => 59 + i * 40).map((x, i) => (
      <Note key={i} x={x} y={208} anchor="middle" size={5.5}>{`B${i + 1}`}</Note>
    ))}
    <Dim x1={32} y1={222} x2={288} y2={222} label="32 000" />
    <Note x={160} y={106} anchor="middle">DISTRIBUTION CENTRE — DOCK FACE</Note>
  </Blueprint>
);

// ── Mixed-use building types (step 3) ─────────────────────

export const mixed_residential_commercial = (
  <Blueprint>
    <Ground />
    <Ink as="rect" x={78} y={48} width={164} height={148} bold />
    <Hatch x={78} y={188} w={164} h={8} gap={6} />
    <Ink as="line" x1={78} y1={140} x2={242} y2={140} bold />
    <Storeys x={78} y={48} w={164} h={92} floors={3} />
    {[0, 1, 2].map(i => (
      <WinRow key={i} x={86} y={56 + i * 30.6} w={148} h={19} count={4} cols={2} />
    ))}
    {[0, 1, 2].map(i => (
      <Ink key={`b${i}`} as="line" x1={86} y1={79 + i * 30.6} x2={234} y2={79 + i * 30.6} faint />
    ))}
    <Ink as="rect" x={88} y={148} width={62} height={48} />
    <Ink as="rect" x={170} y={148} width={62} height={48} />
    <Door x={152} y={158} w={18} h={38} swing={false} />
    <Note x={119} y={176} anchor="middle" size={6}>COMMERCIAL</Note>
    <Note x={201} y={176} anchor="middle" size={6}>COMMERCIAL</Note>
    <Dim x1={258} y1={48} x2={258} y2={140} label="RESI" />
    <Dim x1={258} y1={140} x2={258} y2={196} label="COMM" />
    <Note x={160} y={38} anchor="middle">MIXED — RESIDENTIAL OVER COMMERCIAL</Note>
  </Blueprint>
);

export const live_work = (
  <Blueprint>
    <Ground />
    {/* One volume, split section: workshop at grade, dwelling over, double-height void */}
    <Ink as="rect" x={86} y={70} width={148} height={126} bold />
    <Hatch x={86} y={188} w={148} h={8} gap={6} />
    <Ink d="M 78 72 L 160 40 L 242 72" bold />
    <Ink as="line" x1={86} y1={134} x2={186} y2={134} bold />
    <Ink as="line" x1={186} y1={70} x2={186} y2={196} faint />
    <Note x={136} y={158} anchor="middle" size={6}>WORKSHOP</Note>
    <Note x={136} y={106} anchor="middle" size={6}>LIVING</Note>
    <Note x={210} y={130} anchor="middle" size={6}>VOID</Note>
    <Win x={100} y={86} w={70} h={26} cols={3} rows={2} />
    <Win x={196} y={86} w={30} h={90} cols={1} rows={5} />
    <Ink as="rect" x={100} y={148} width={54} height={48} />
    {Array.from({ length: 5 }, (_, i) => 154 + i * 9).map(y => (
      <Ink key={y} as="line" x1={100} y1={y} x2={154} y2={y} faint />
    ))}
    <Door x={162} y={162} w={20} h={34} swing={false} />
    <Dim x1={86} y1={214} x2={234} y2={214} label="14 800" />
    <Note x={160} y={32} anchor="middle">LIVE / WORK UNIT</Note>
  </Blueprint>
);

export const mixed_retail_residential = (
  <Blueprint>
    <Ground />
    <Ink as="rect" x={68} y={54} width={184} height={142} bold />
    <Hatch x={68} y={188} w={184} h={8} gap={6} />
    <Ink as="line" x1={68} y1={132} x2={252} y2={132} bold />
    <Storeys x={68} y={54} w={184} h={78} floors={3} />
    {[0, 1, 2].map(i => (
      <WinRow key={i} x={76} y={60 + i * 26} w={168} h={16} count={5} cols={2} />
    ))}
    {/* Continuous shopfront with a canopy — retail reads by its glazing rhythm */}
    <Ink d="M 62 142 L 258 142 L 252 134 L 68 134 Z" faint />
    <Ink as="rect" x={76} y={150} width={168} height={46} />
    {[1, 2, 3, 4, 5].map(i => (
      <Ink key={i} as="line" x1={76 + i * 28} y1={150} x2={76 + i * 28} y2={196} faint />
    ))}
    <Door x={150} y={158} w={26} h={38} swing={false} />
    <Dim x1={68} y1={214} x2={252} y2={214} label="22 000" />
    <Note x={160} y={44} anchor="middle">RETAIL AT GRADE — FLATS OVER</Note>
  </Blueprint>
);

export const transit_oriented = (
  <Blueprint>
    <Ground />
    {/* Two blocks flanking a concourse, platform canopy at grade */}
    <Ink as="rect" x={30} y={62} width={92} height={134} bold />
    <Ink as="rect" x={198} y={62} width={92} height={134} bold />
    <Hatch x={30} y={188} w={260} h={8} gap={6} />
    <Storeys x={30} y={62} w={92} h={134} floors={5} />
    <Storeys x={198} y={62} w={92} h={134} floors={5} />
    {[0, 1, 2, 3].map(i => (
      <WinRow key={`l${i}`} x={38} y={70 + i * 26.8} w={76} h={16} count={3} cols={2} />
    ))}
    {[0, 1, 2, 3].map(i => (
      <WinRow key={`r${i}`} x={206} y={70 + i * 26.8} w={76} h={16} count={3} cols={2} />
    ))}
    {/* Concourse roof spanning between */}
    <Ink d="M 118 120 Q 160 96 202 120" bold />
    {[0, 1, 2, 3, 4].map(i => (
      <Ink key={i} as="line" x1={128 + i * 16} y1={196} x2={128 + i * 16} y2={112 + Math.abs(i - 2) * 3} faint />
    ))}
    <Ink as="line" x1={122} y1={196} x2={198} y2={196} bold />
    <Ink as="line" x1={122} y1={186} x2={198} y2={186} faint />
    <Note x={160} y={176} anchor="middle" size={6}>PLATFORM</Note>
    <Dim x1={30} y1={214} x2={290} y2={214} label="34 000" />
    <Note x={160} y={52} anchor="middle">TRANSIT-ORIENTED DEVELOPMENT</Note>
  </Blueprint>
);

// ── Roof types (step 7) ───────────────────────────────────
// Sectional details rather than elevations: the choice here is about build-up, and a
// section is the only view that shows a build-up.

// The three pitched coverings share a geometry — in reality they differ only in what
// is laid on the rafters. Drawn small they were three identical triangles, so these are
// zoomed slope details: enough of the pitch to place you, with the covering at a scale
// where its profile is the subject rather than a texture.

/** Common furniture for a slope detail: rafter, ridge and the eaves line. */
function Slope({ label }: { label: string }) {
  return (
    <>
      <Ink as="line" x1={24} y1={188} x2={296} y2={188} bold />
      <Ink as="line" x1={40} y1={60} x2={40} y2={188} faint />
      <Ink as="line" x1={280} y1={148} x2={280} y2={188} faint />
      <Dim x1={40} y1={202} x2={280} y2={202} label="RAFTER SPAN" />
      <Note x={160} y={38} anchor="middle">{label}</Note>
    </>
  );
}

export const long_span_aluminum = (
  <Blueprint>
    <Slope label="LONG-SPAN ALUMINIUM — SLOPE DETAIL" />
    {/* Rafter, then purlins running across it, then sheet with raised standing seams */}
    <Ink d="M 40 74 L 280 158" bold />
    <Ink d="M 40 86 L 280 170" />
    {Array.from({ length: 7 }, (_, i) => i).map(i => (
      <Ink key={`p${i}`} as="rect" x={58 + i * 34} y={84 + i * 11.9} width={9} height={7} faint />
    ))}
    {/* Standing seams: the tell — upstands at every sheet joint */}
    {Array.from({ length: 9 }, (_, i) => i).map(i => (
      <Ink key={`s${i}`} d={`M ${50 + i * 27} ${72 + i * 9.4} l 2 -11 l 4 0 l 2 11`} />
    ))}
    <Ink d="M 40 74 L 40 86" />
    <Ink d="M 280 158 L 280 170" />
    <Note x={196} y={104} size={6}>0.55mm PROFILED SHEET</Note>
    <Note x={196} y={114} size={6}>ON 50x75 PURLINS @ 900</Note>
    <Ink as="line" x1={192} y1={101} x2={168} y2={92} faint />
    <Note x={44} y={64} size={6}>RIDGE</Note>
    <Note x={262} y={182} size={6} anchor="end">EAVES</Note>
  </Blueprint>
);

export const clay_tiles = (
  <Blueprint>
    <Slope label="CLAY TILE — SLOPE DETAIL" />
    {/* Battens on rafter, then interlocking pantiles laid to a lap */}
    <Ink d="M 40 78 L 280 162" bold />
    <Ink d="M 40 92 L 280 176" />
    {Array.from({ length: 8 }, (_, i) => i).map(i => (
      <Ink key={`b${i}`} as="rect" x={62 + i * 29} y={88 + i * 10.2} width={7} height={6} faint />
    ))}
    {/* Each course a curved pantile lapping the one below — the clay tell */}
    {Array.from({ length: 10 }, (_, i) => i).map(i => (
      <Ink key={`t${i}`}
        d={`M ${44 + i * 24} ${70 + i * 8.4} q 8 -9 16 0 q 8 -9 16 0`} />
    ))}
    <Ink d="M 40 78 L 40 92" />
    <Ink d="M 280 162 L 280 176" />
    <Note x={200} y={112} size={6}>INTERLOCKING CLAY PANTILE</Note>
    <Note x={200} y={122} size={6}>100mm LAP ON 38x25 BATTEN</Note>
    <Ink as="line" x1={196} y1={109} x2={172} y2={98} faint />
    <Note x={44} y={64} size={6}>RIDGE</Note>
  </Blueprint>
);

export const shingle = (
  <Blueprint>
    <Slope label="SHINGLE — SLOPE DETAIL" />
    {/* Sarking board on the rafter, then discrete plates each lapping the one below.
        Drawn as separate tabs with a visible butt end, which is what separates a
        shingle from the continuous sheet of long-span and the curve of a pantile. */}
    <Ink d="M 40 78 L 280 162" bold />
    <Ink d="M 40 90 L 280 174" />
    {Array.from({ length: 13 }, (_, i) => i).map(i => {
      const x = 46 + i * 18;
      const y = 66 + i * 6.3;
      return (
        <Ink key={`t${i}`} d={`M ${x} ${y} l 26 9.1 l -3.5 4 l -26 -9.1 Z`} />
      );
    })}
    {/* Butt shadow under each course — the depth that says these are laid, not rolled */}
    {Array.from({ length: 13 }, (_, i) => i).map(i => (
      <Ink key={`s${i}`} as="line" faint
        x1={46 + i * 18 + 26} y1={66 + i * 6.3 + 9.1}
        x2={46 + i * 18 + 22.5} y2={66 + i * 6.3 + 13.1} />
    ))}
    <Ink d="M 40 78 L 40 90" />
    <Ink d="M 280 162 L 280 174" />
    <Note x={206} y={112} size={6}>ASPHALT SHINGLE, 3-TAB</Note>
    <Note x={206} y={122} size={6}>ON 18mm SARKING BOARD</Note>
    <Ink as="line" x1={202} y1={109} x2={180} y2={100} faint />
    <Note x={44} y={62} size={6}>RIDGE</Note>
  </Blueprint>
);

export const aluminium_deck = (
  <Blueprint>
    <Ink as="line" x1={30} y1={186} x2={290} y2={186} bold />
    {/* Shallow fall, trapezoidal deck profile — long-span sheet laid nearly flat */}
    <Ink d="M 48 116 L 272 132" bold />
    <Ink d="M 48 124 L 272 140" faint />
    {Array.from({ length: 13 }, (_, i) => i).map(i => (
      <Ink key={i} d={`M ${54 + i * 17} ${117 + i * 1.2} l 4 -6 l 5 0 l 4 6`} faint />
    ))}
    <Ink as="line" x1={48} y1={116} x2={48} y2={186} faint />
    <Ink as="line" x1={272} y1={132} x2={272} y2={186} faint />
    {[0, 1, 2, 3].map(i => (
      <Ink key={`p${i}`} as="line" x1={78 + i * 56} y1={120 + i * 4} x2={78 + i * 56} y2={186} faint />
    ))}
    <Ink d="M 90 106 L 130 109" faint />
    <Note x={136} y={106} size={6}>FALL 1:40</Note>
    <Note x={196} y={158} size={6}>TRAPEZOIDAL DECK</Note>
    <Ink as="line" x1={210} y1={154} x2={200} y2={140} faint />
    <Dim x1={48} y1={200} x2={272} y2={200} label="SPAN" />
    <Note x={160} y={88} anchor="middle">ALUMINIUM DECK — SECTION</Note>
  </Blueprint>
);
