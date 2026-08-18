import { motion } from 'framer-motion';

// =========================================================
// Blueprint frame and drawing primitives.
//
// Replaces the photographs the wizard preview used to show. Twelve of those were
// hotlinked from Unsplash — they had already broken once, which is why the panel still
// carries a `failed` fallback — and the rest were stock interiors standing in for a
// building type they only loosely matched. A drawing cannot drift away from its
// caption, and it is the register this product speaks in: the wizard ends in a bill of
// quantities, not a mood board.
//
// Fidelity comes from the primitives, not from hand-drawing every stroke. A `Facade`
// composes storey lines, a mullioned window grid and a hatched plinth from one call,
// so each building is a short composition that renders thirty-odd strokes. That is
// what keeps twenty-five drawings consistent with each other and worth looking at.
//
// Everything strokes itself on. `pathLength` animates on path, line, rect, circle,
// ellipse, polyline and polygon; the parent staggers children, so declaration order is
// drawing order. Each sketch is written the way it would be drawn: ground, then shell,
// then openings, then annotation.
// =========================================================

/**
 * Brand near-black, not blueprint blue. A literal cyanotype was the obvious reading of
 * "blueprint" and the wrong one here: the palette is black, white and greys, with
 * colour reserved as a status accent. A blue field would be the only hue on the screen
 * and would read as a status the drawing does not have.
 *
 * White linework on near-black keeps the technical register — it is a drawing, not a
 * photograph — without spending the one colour channel the design system reserves.
 */
export const BLUEPRINT_BG = '#0a0a0a';

const DRAW = {
  hidden:  { pathLength: 0, opacity: 0 },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: {
      pathLength: { duration: 0.85, ease: [0.22, 1, 0.36, 1] as const },
      opacity:    { duration: 0.18 },
    },
  },
};

const FADE = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.35 } },
};

const CONTAINER = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.022, delayChildren: 0.08 } },
};

type El = 'path' | 'line' | 'rect' | 'circle' | 'ellipse' | 'polyline' | 'polygon';

/**
 * One stroke. Three weights, and they carry meaning rather than decoration:
 * `bold` is cut fabric (ground, primary structure), the default is the drawn edge,
 * `faint` is annotation — hatching, witness lines, mullions, setting-out.
 */
export function Ink({
  as = 'path', faint, bold, ...props
}: React.SVGProps<never> & { as?: El; faint?: boolean; bold?: boolean }) {
  const Comp = motion[as] as typeof motion.path;
  return (
    <Comp
      variants={DRAW}
      fill="none"
      stroke="currentColor"
      strokeWidth={bold ? 2.1 : faint ? 0.7 : 1.3}
      strokeOpacity={faint ? 0.34 : 0.92}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(props as object)}
    />
  );
}

/** Annotation text. Cannot stroke on, so it fades. */
export function Note({ x, y, children, anchor = 'start', size = 7 }: {
  x: number; y: number; children: React.ReactNode;
  anchor?: 'start' | 'middle' | 'end'; size?: number;
}) {
  return (
    <motion.text
      variants={FADE}
      x={x} y={y}
      textAnchor={anchor}
      fill="currentColor"
      fillOpacity={0.5}
      fontSize={size}
      letterSpacing={0.8}
      fontFamily="ui-monospace, monospace"
    >
      {children}
    </motion.text>
  );
}

/** Dimension run with witness ticks, and an optional figure sitting on it. */
export function Dim({ x1, y1, x2, y2, label }: {
  x1: number; y1: number; x2: number; y2: number; label?: string;
}) {
  const vertical = x1 === x2;
  const t = 3.5;
  return (
    <>
      <Ink as="line" x1={x1} y1={y1} x2={x2} y2={y2} faint />
      <Ink as="line" faint
        x1={vertical ? x1 - t : x1} y1={vertical ? y1 : y1 - t}
        x2={vertical ? x1 + t : x1} y2={vertical ? y1 : y1 + t} />
      <Ink as="line" faint
        x1={vertical ? x2 - t : x2} y1={vertical ? y2 : y2 - t}
        x2={vertical ? x2 + t : x2} y2={vertical ? y2 : y2 + t} />
      {label && (
        <Note x={vertical ? x1 - 5 : (x1 + x2) / 2} y={vertical ? (y1 + y2) / 2 : y1 - 4}
              anchor={vertical ? 'end' : 'middle'}>{label}</Note>
      )}
    </>
  );
}

/** Diagonal hatching inside a box — cut ground, solid walls, paving. */
export function Hatch({ x, y, w, h, gap = 7 }: { x: number; y: number; w: number; h: number; gap?: number }) {
  const lines: React.ReactNode[] = [];
  for (let o = -h; o < w; o += gap) {
    const x1 = Math.max(x + o, x);
    const y1 = y + Math.max(-o, 0);
    const x2 = Math.min(x + o + h, x + w);
    const y2 = y + Math.min(h, w - o);
    if (x2 > x1) lines.push(<Ink key={o} as="line" x1={x1} y1={y1} x2={x2} y2={y2} faint />);
  }
  return <>{lines}</>;
}

/** A mullioned opening: frame, vertical mullions, transom. */
export function Win({ x, y, w, h, cols = 2, rows = 1 }: {
  x: number; y: number; w: number; h: number; cols?: number; rows?: number;
}) {
  return (
    <>
      <Ink as="rect" x={x} y={y} width={w} height={h} rx={0.6} />
      {Array.from({ length: cols - 1 }, (_, i) => x + ((i + 1) * w) / cols).map(mx => (
        <Ink key={`v${mx}`} as="line" x1={mx} y1={y} x2={mx} y2={y + h} faint />
      ))}
      {Array.from({ length: rows - 1 }, (_, i) => y + ((i + 1) * h) / rows).map(my => (
        <Ink key={`h${my}`} as="line" x1={x} y1={my} x2={x + w} y2={my} faint />
      ))}
    </>
  );
}

/** A run of identical openings across a bay. */
export function WinRow({ x, y, w, h, count, cols = 2 }: {
  x: number; y: number; w: number; h: number; count: number; cols?: number;
}) {
  const pitch = w / count;
  const ww = pitch * 0.62;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Win key={i} x={x + i * pitch + (pitch - ww) / 2} y={y} w={ww} h={h} cols={cols} />
      ))}
    </>
  );
}

/** Door with a swing arc — the detail that reads instantly as an architect's drawing. */
export function Door({ x, y, w, h, swing = true }: {
  x: number; y: number; w: number; h: number; swing?: boolean;
}) {
  return (
    <>
      <Ink as="rect" x={x} y={y} width={w} height={h} rx={0.6} />
      <Ink as="circle" cx={x + w - 2.5} cy={y + h / 2} r={0.9} faint />
      {swing && <Ink d={`M ${x} ${y + h} A ${w} ${w} 0 0 1 ${x + w} ${y + h - w}`} faint />}
    </>
  );
}

/** Storey division lines across a facade. */
export function Storeys({ x, y, w, h, floors }: {
  x: number; y: number; w: number; h: number; floors: number;
}) {
  const fh = h / floors;
  return (
    <>
      {Array.from({ length: floors - 1 }, (_, i) => y + (i + 1) * fh).map(ly => (
        <Ink key={ly} as="line" x1={x} y1={ly} x2={x + w} y2={ly} faint />
      ))}
    </>
  );
}

/** Ground line with cut hatching below it. Every elevation stands on this. */
export function Ground({ y = 196, x1 = 18, x2 = 302 }: { y?: number; x1?: number; x2?: number }) {
  return (
    <>
      <Ink as="line" x1={x1} y1={y} x2={x2} y2={y} bold />
      {Array.from({ length: 14 }, (_, i) => x1 + 6 + i * ((x2 - x1 - 12) / 13)).map(x => (
        <Ink key={x} as="line" x1={x} y1={y} x2={x - 6} y2={y + 7} faint />
      ))}
    </>
  );
}

/** Drawing furniture: scale bar and north point, bottom-left of every sheet. */
function Furniture() {
  return (
    <>
      <Ink as="line" x1={20} y1={224} x2={68} y2={224} faint />
      <Ink as="line" x1={20} y1={221} x2={20} y2={227} faint />
      <Ink as="line" x1={44} y1={222} x2={44} y2={226} faint />
      <Ink as="line" x1={68} y1={221} x2={68} y2={227} faint />
      <Note x={74} y={226} size={6}>SCALE 1:100</Note>
      <Ink d="M 296 228 L 300 216 L 304 228 L 300 224 Z" faint />
      <Note x={300} y={236} anchor="middle" size={6}>N</Note>
    </>
  );
}

export function Blueprint({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0" style={{ backgroundColor: BLUEPRINT_BG }}>
      {/* Grid in CSS so it fills any aspect ratio, while the drawing stays centred
          and unstretched inside its own viewBox. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.075) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,255,255,0.075) 1px, transparent 1px),' +
            'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '84px 84px, 84px 84px, 14px 14px, 14px 14px',
        }}
      />
      <motion.svg
        viewBox="0 0 320 248"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full px-8 pb-24 pt-10 text-white"
        variants={CONTAINER}
        initial="hidden"
        animate="visible"
        aria-hidden="true"
      >
        {children}
        <Furniture />
      </motion.svg>
    </div>
  );
}
