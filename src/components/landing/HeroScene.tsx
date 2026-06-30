import { motion } from "framer-motion";
import { CheckCircle2, Check, Lock, Camera } from "lucide-react";

const D = "#0A0A0A";

export default function HeroScene() {
  return (
    <div className="relative w-full max-w-[320px] lg:max-w-[560px] mx-auto">
      <svg viewBox="0 0 560 400" className="w-full h-auto" aria-hidden="true">
        <defs>
          <pattern id="hero-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke={D} strokeWidth="0.4" strokeOpacity="0.04" />
          </pattern>
        </defs>

        <rect x="0" y="0" width="560" height="400" fill="url(#hero-grid)" />

        {/* Dashed connection line: person → house */}
        <line x1="100" y1="230" x2="230" y2="230" stroke={D} strokeWidth="1.5" strokeDasharray="6 6" strokeOpacity="0.18" />

        {/* Traveling dots along the connection */}
        {[0, 0.8, 1.6].map((delay, i) => (
          <circle key={i} cy="230" r="4" fill={D}>
            <animate attributeName="cx" values="100;230" dur="2.5s" begin={`${delay}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;0.7;0.7;0" keyTimes="0;0.1;0.85;1" dur="2.5s" begin={`${delay}s`} repeatCount="indefinite" />
          </circle>
        ))}

        {/* Lock at center of connection */}
        <circle cx="165" cy="230" r="14" fill="none" stroke={D} strokeWidth="1.5" strokeOpacity="0.15">
          <animate attributeName="r" values="14;20;14" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="165" cy="230" r="13" fill={D} fillOpacity="0.06" stroke={D} strokeWidth="1.5" strokeOpacity="0.5" />
        <path d="M159 227 v-3.5 a6 6 0 0 1 12 0 v3.5" fill="none" stroke={D} strokeWidth="2" strokeLinecap="round" />
        <rect x="158" y="227" width="14" height="10" rx="2" fill={D} fillOpacity="0.85" />

        {/* Person — floats on 5s cycle */}
        <g transform="translate(50,150)">
          <motion.g animate={{ y: [0, -10, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
            {/* Head */}
            <circle cx="0" cy="-40" r="16" fill={D} fillOpacity="0.9" />
            <circle cx="-5" cy="-43" r="1.5" fill="white" />
            <circle cx="5" cy="-43" r="1.5" fill="white" />
            <path d="M-6 -37 Q0 -33 6 -37" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            {/* Body */}
            <path d="M-20 30 Q-20 -22 0 -22 Q20 -22 20 30 Z" fill={D} fillOpacity="0.82" />
            {/* Phone */}
            <rect x="18" y="-6" width="16" height="26" rx="3" fill={D} fillOpacity="0.08" stroke={D} strokeWidth="1.5" strokeOpacity="0.5" />
            <rect x="21" y="1" width="10" height="3" rx="1.5" fill={D} fillOpacity="0.18" />
            <rect x="21" y="1" width="6" height="3" rx="1.5" fill={D} fillOpacity="0.5" />
            <rect x="21" y="7" width="10" height="3" rx="1.5" fill={D} fillOpacity="0.18" />
          </motion.g>
          <text x="0" y="62" textAnchor="middle" fontSize="11" fill={D} fillOpacity="0.45" fontFamily="Satoshi, sans-serif">You, Abroad</text>
        </g>

        {/* House — floats on 6s cycle */}
        <g transform="translate(330,100)">
          <motion.g animate={{ y: [0, -10, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
            {/* Scaffold */}
            <line x1="-95" y1="10" x2="-95" y2="130" stroke={D} strokeWidth="1.5" strokeDasharray="4 4" strokeOpacity="0.15" />
            <line x1="95" y1="10" x2="95" y2="130" stroke={D} strokeWidth="1.5" strokeDasharray="4 4" strokeOpacity="0.15" />
            <line x1="-95" y1="60" x2="-70" y2="45" stroke={D} strokeWidth="1.5" strokeDasharray="4 4" strokeOpacity="0.15" />
            <line x1="95" y1="60" x2="70" y2="45" stroke={D} strokeWidth="1.5" strokeDasharray="4 4" strokeOpacity="0.15" />
            {/* Foundation */}
            <rect x="-80" y="120" width="160" height="10" fill={D} fillOpacity="0.1" />
            {/* Roof */}
            <polygon points="-85,20 0,-50 85,20" fill={D} fillOpacity="0.04" stroke={D} strokeWidth="2" strokeOpacity="0.55" />
            {/* Walls */}
            <rect x="-70" y="20" width="140" height="100" fill={D} fillOpacity="0.03" stroke={D} strokeWidth="2" strokeOpacity="0.55" />
            {/* Window left */}
            <rect x="-55" y="40" width="30" height="30" fill={D} fillOpacity="0.05" stroke={D} strokeWidth="1.5" strokeOpacity="0.5" />
            <line x1="-40" y1="40" x2="-40" y2="70" stroke={D} strokeWidth="1" strokeOpacity="0.35" />
            <line x1="-55" y1="55" x2="-25" y2="55" stroke={D} strokeWidth="1" strokeOpacity="0.35" />
            {/* Window right */}
            <rect x="25" y="40" width="30" height="30" fill={D} fillOpacity="0.05" stroke={D} strokeWidth="1.5" strokeOpacity="0.5" />
            <line x1="40" y1="40" x2="40" y2="70" stroke={D} strokeWidth="1" strokeOpacity="0.35" />
            <line x1="25" y1="55" x2="55" y2="55" stroke={D} strokeWidth="1" strokeOpacity="0.35" />
            {/* Door */}
            <path d="M-14 120 V90 a14 14 0 0 1 28 0 v30 Z" fill={D} fillOpacity="0.05" stroke={D} strokeWidth="1.5" strokeOpacity="0.5" />
            <circle cx="8" cy="105" r="2" fill={D} fillOpacity="0.6" />
            {/* Dimension annotations */}
            <g opacity="0.4">
              <line x1="-80" y1="138" x2="80" y2="138" stroke={D} strokeWidth="1" />
              <line x1="-80" y1="134" x2="-80" y2="142" stroke={D} strokeWidth="1" />
              <line x1="80" y1="134" x2="80" y2="142" stroke={D} strokeWidth="1" />
              <text x="0" y="150" textAnchor="middle" fontSize="9" fill={D} fontFamily="Satoshi, sans-serif">12m</text>
              <line x1="112" y1="-50" x2="112" y2="130" stroke={D} strokeWidth="1" />
              <line x1="108" y1="-50" x2="116" y2="-50" stroke={D} strokeWidth="1" />
              <line x1="108" y1="130" x2="116" y2="130" stroke={D} strokeWidth="1" />
              <text x="124" y="43" textAnchor="middle" fontSize="9" fill={D} fontFamily="Satoshi, sans-serif" transform="rotate(90 124 43)">8m</text>
            </g>
          </motion.g>
        </g>
      </svg>

      {/* Progress bar */}
      <div className="absolute left-[62%] top-[5%] -translate-x-1/2 flex flex-col items-center gap-1">
        <div className="w-[110px] h-1.5 rounded-full bg-brand-near-black/10 overflow-hidden">
          <div className="h-full rounded-full bg-brand-near-black animate-fill-progress" />
        </div>
        <span className="text-[10px] font-semibold text-brand-mid-grey">60%</span>
        <div className="flex gap-1.5 mt-0.5">
          {[true, true, true, false, null].map((done, i) => (
            <span
              key={i}
              className={
                done
                  ? "flex h-3.5 w-3.5 items-center justify-center rounded-full bg-brand-near-black text-[8px] text-white"
                  : done === false
                    ? "h-3.5 w-3.5 rounded-full bg-brand-near-black/15"
                    : "h-3.5 w-3.5 rounded-full border border-brand-near-black/25 bg-transparent"
              }
            >
              {done ? <Check className="size-2.5" /> : ""}
            </span>
          ))}
        </div>
      </div>

      {/* Badge: Stage Verified */}
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="absolute right-[2%] top-[8%] flex items-center gap-1.5 rounded-full bg-brand-near-black shadow-[0_4px_18px_rgba(0,0,0,0.15)] px-2 py-1 sm:px-3 sm:py-1.5 text-[9px] sm:text-[11px] font-medium text-white whitespace-nowrap"
      >
        <CheckCircle2 className="size-3.5" />
        Stage 3 Verified
      </motion.div>

      {/* Badge: Funds Held */}
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
        className="absolute left-[24%] top-[62%] -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-brand-near-black shadow-[0_4px_18px_rgba(0,0,0,0.15)] px-2 py-1 sm:px-3 sm:py-1.5 text-[9px] sm:text-[11px] font-medium text-white whitespace-nowrap"
      >
        <Lock className="size-3.5" />
        $41K Held
      </motion.div>

      {/* Badge: Evidence Uploaded */}
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        className="absolute left-[40%] top-[28%] -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5 rounded-full bg-brand-near-black shadow-[0_4px_18px_rgba(0,0,0,0.12)] px-2 py-1 sm:px-3 sm:py-1.5 text-[9px] sm:text-[11px] font-medium text-white whitespace-nowrap"
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
