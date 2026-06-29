import { motion } from "framer-motion";
import { CheckCircle2, Check, Lock, Camera } from "lucide-react";

export default function HeroScene() {
  const corners = [
    { x: 65, y: 48 },
    { x: 495, y: 48 },
    { x: 65, y: 352 },
    { x: 495, y: 352 },
  ];

  return (
    <div className="relative w-full max-w-[320px] lg:max-w-[560px] mx-auto">
      <svg viewBox="0 0 560 400" className="w-full h-auto rounded-xl" aria-hidden="true">
        <defs>
          <pattern id="bp-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="white" strokeWidth="0.4" strokeOpacity="0.06" />
          </pattern>
        </defs>

        {/* Blueprint background */}
        <rect width="560" height="400" fill="#0B1526" rx="10" />
        <rect width="560" height="400" fill="url(#bp-grid)" rx="10" />

        {/* Outer walls */}
        <rect x="65" y="48" width="430" height="304" fill="none" stroke="white" strokeWidth="2.5" strokeOpacity="0.85" />

        {/* Interior walls */}
        {/* Main vertical divider: living vs bedrooms */}
        <line x1="263" y1="48" x2="263" y2="352" stroke="white" strokeWidth="2" strokeOpacity="0.85" />
        {/* Horizontal divider: master vs bed2+bath */}
        <line x1="263" y1="210" x2="495" y2="210" stroke="white" strokeWidth="2" strokeOpacity="0.85" />
        {/* Bathroom divider */}
        <line x1="390" y1="210" x2="390" y2="352" stroke="white" strokeWidth="2" strokeOpacity="0.85" />

        {/* Door: main entrance (bottom of living, hinge left, swings in) */}
        <line x1="125" y1="352" x2="125" y2="302" stroke="white" strokeWidth="1.2" strokeOpacity="0.5" />
        <path d="M125,302 A50,50 0 0,1 175,352" fill="none" stroke="white" strokeWidth="1" strokeOpacity="0.38" />

        {/* Door: master bedroom (hinge at top, swings right) */}
        <line x1="263" y1="90" x2="313" y2="90" stroke="white" strokeWidth="1.2" strokeOpacity="0.5" />
        <path d="M313,90 A50,50 0 0,1 263,140" fill="none" stroke="white" strokeWidth="1" strokeOpacity="0.38" />

        {/* Door: bedroom 2 (hinge top, swings right) */}
        <line x1="263" y1="258" x2="313" y2="258" stroke="white" strokeWidth="1.2" strokeOpacity="0.5" />
        <path d="M313,258 A50,50 0 0,1 263,308" fill="none" stroke="white" strokeWidth="1" strokeOpacity="0.38" />

        {/* Room labels */}
        <text x="164" y="184" textAnchor="middle" fontSize="10" fill="white" fillOpacity="0.58" letterSpacing="1.5" fontFamily="monospace">LIVING / DINING</text>
        <text x="164" y="198" textAnchor="middle" fontSize="8" fill="white" fillOpacity="0.32" fontFamily="monospace">6.5m × 10.0m</text>

        <text x="379" y="122" textAnchor="middle" fontSize="9" fill="white" fillOpacity="0.58" letterSpacing="1.2" fontFamily="monospace">MASTER</text>
        <text x="379" y="135" textAnchor="middle" fontSize="9" fill="white" fillOpacity="0.58" letterSpacing="1.2" fontFamily="monospace">BEDROOM</text>
        <text x="379" y="149" textAnchor="middle" fontSize="7.5" fill="white" fillOpacity="0.32" fontFamily="monospace">7.5m × 5.4m</text>

        <text x="326" y="278" textAnchor="middle" fontSize="8.5" fill="white" fillOpacity="0.58" letterSpacing="1" fontFamily="monospace">BEDROOM 2</text>
        <text x="326" y="291" textAnchor="middle" fontSize="7" fill="white" fillOpacity="0.32" fontFamily="monospace">4.2m × 4.7m</text>

        <text x="442" y="280" textAnchor="middle" fontSize="8.5" fill="white" fillOpacity="0.58" letterSpacing="1" fontFamily="monospace">BATH</text>

        {/* Dimension lines — bottom (total width) */}
        <line x1="65" y1="370" x2="495" y2="370" stroke="white" strokeOpacity="0.32" strokeWidth="0.8" />
        <line x1="65" y1="365" x2="65" y2="375" stroke="white" strokeOpacity="0.32" strokeWidth="0.8" />
        <line x1="495" y1="365" x2="495" y2="375" stroke="white" strokeOpacity="0.32" strokeWidth="0.8" />
        <text x="280" y="383" textAnchor="middle" fontSize="8" fill="white" fillOpacity="0.32" fontFamily="monospace">18.0m total width</text>

        {/* Dimension lines — right side (total height) */}
        <line x1="510" y1="48" x2="510" y2="352" stroke="white" strokeOpacity="0.32" strokeWidth="0.8" />
        <line x1="505" y1="48" x2="515" y2="48" stroke="white" strokeOpacity="0.32" strokeWidth="0.8" />
        <line x1="505" y1="352" x2="515" y2="352" stroke="white" strokeOpacity="0.32" strokeWidth="0.8" />
        <text x="535" y="204" textAnchor="middle" fontSize="8" fill="white" fillOpacity="0.32" fontFamily="monospace" transform="rotate(90 535 204)">12.5m</text>

        {/* Sub-dimension: living width */}
        <line x1="65" y1="34" x2="263" y2="34" stroke="white" strokeOpacity="0.22" strokeWidth="0.7" />
        <line x1="65" y1="30" x2="65" y2="38" stroke="white" strokeOpacity="0.22" strokeWidth="0.7" />
        <line x1="263" y1="30" x2="263" y2="38" stroke="white" strokeOpacity="0.22" strokeWidth="0.7" />
        <text x="164" y="27" textAnchor="middle" fontSize="7" fill="white" fillOpacity="0.22" fontFamily="monospace">6.5m</text>

        {/* Sub-dimension: bedroom wing width */}
        <line x1="263" y1="34" x2="495" y2="34" stroke="white" strokeOpacity="0.22" strokeWidth="0.7" />
        <line x1="495" y1="30" x2="495" y2="38" stroke="white" strokeOpacity="0.22" strokeWidth="0.7" />
        <text x="379" y="27" textAnchor="middle" fontSize="7" fill="white" fillOpacity="0.22" fontFamily="monospace">7.5m</text>

        {/* Corner crosshair markers */}
        {corners.map((pt, i) => (
          <g key={i}>
            <circle cx={pt.x} cy={pt.y} r="4" fill="none" stroke="white" strokeOpacity="0.32" strokeWidth="1" />
            <line x1={pt.x - 8} y1={pt.y} x2={pt.x + 8} y2={pt.y} stroke="white" strokeOpacity="0.14" strokeWidth="0.8" />
            <line x1={pt.x} y1={pt.y - 8} x2={pt.x} y2={pt.y + 8} stroke="white" strokeOpacity="0.14" strokeWidth="0.8" />
          </g>
        ))}

        {/* Compass rose — top left */}
        <g transform="translate(30,26)">
          <circle r="10" fill="none" stroke="white" strokeOpacity="0.28" strokeWidth="0.8" />
          <polygon points="0,-7 2,-1 -2,-1" fill="white" fillOpacity="0.55" />
          <polygon points="0,7 2,1 -2,1" fill="white" fillOpacity="0.2" />
          <text x="0" y="-11" textAnchor="middle" fontSize="7" fill="white" fillOpacity="0.4" fontFamily="monospace" fontWeight="bold">N</text>
        </g>

        {/* Title block — bottom right */}
        <rect x="390" y="356" width="100" height="32" fill="none" stroke="white" strokeOpacity="0.15" strokeWidth="0.7" />
        <text x="440" y="368" textAnchor="middle" fontSize="7" fill="white" fillOpacity="0.28" fontFamily="monospace" letterSpacing="1">GROUNDWORK</text>
        <text x="440" y="380" textAnchor="middle" fontSize="6" fill="white" fillOpacity="0.18" fontFamily="monospace">FLOOR PLAN · REV.03</text>
      </svg>

      {/* Progress bar — floats over the blueprint */}
      <div className="absolute left-[57%] top-[6%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 bg-white/10 backdrop-blur-sm rounded-lg px-2.5 py-2">
        <div className="w-[110px] h-1.5 rounded-full bg-white/20 overflow-hidden">
          <div className="h-full rounded-full bg-white animate-fill-progress" />
        </div>
        <span className="text-[10px] font-semibold text-white/80">60% complete</span>
        <div className="flex gap-1.5 mt-0.5">
          {[true, true, true, false, null].map((done, i) => (
            <span
              key={i}
              className={
                done
                  ? "flex h-3 w-3 items-center justify-center rounded-full bg-white text-[7px] text-[#0B1526]"
                  : done === false
                    ? "h-3 w-3 rounded-full bg-white/25"
                    : "h-3 w-3 rounded-full border border-white/30 bg-transparent"
              }
            >
              {done ? <Check className="size-2" /> : ""}
            </span>
          ))}
        </div>
      </div>

      {/* Floating badge: Stage Verified */}
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="absolute right-[2%] top-[8%] flex items-center gap-1.5 rounded-full bg-white shadow-[0_4px_18px_rgba(0,0,0,0.18)] px-2 py-1 sm:px-3 sm:py-1.5 text-[9px] sm:text-[11px] font-medium text-brand-near-black whitespace-nowrap"
      >
        <CheckCircle2 className="size-3.5" />
        Stage 3 Verified
      </motion.div>

      {/* Floating badge: Funds Held */}
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
        className="absolute left-[20%] top-[62%] -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-white shadow-[0_4px_18px_rgba(0,0,0,0.18)] px-2 py-1 sm:px-3 sm:py-1.5 text-[9px] sm:text-[11px] font-medium text-brand-near-black whitespace-nowrap"
      >
        <Lock className="size-3.5" />
        $41K Held
      </motion.div>

      {/* Floating badge: Evidence Uploaded */}
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        className="absolute left-[36%] top-[26%] -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5 rounded-full bg-white shadow-[0_4px_18px_rgba(0,0,0,0.12)] px-2 py-1 sm:px-3 sm:py-1.5 text-[9px] sm:text-[11px] font-medium text-brand-near-black whitespace-nowrap"
      >
        <motion.span
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          className="flex"
        >
          <Camera className="size-3.5" />
        </motion.span>
        Evidence Uploaded
      </motion.div>
    </div>
  );
}
