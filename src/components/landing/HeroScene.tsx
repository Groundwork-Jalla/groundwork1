import { motion } from "framer-motion";
import { CheckCircle2, Check, Lock, Camera } from "lucide-react";

export default function HeroScene() {
  return (
    <div className="relative w-full max-w-[320px] lg:max-w-[560px] mx-auto">
      <svg viewBox="0 0 560 400" className="w-full h-auto" aria-hidden="true">
        <defs>
          <style>{`.dim-line { stroke: #E5E5E5; }`}</style>
          <pattern id="blueprint-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#0A0A0A" strokeWidth="0.5" strokeOpacity="0.05" />
          </pattern>
        </defs>

        <rect x="0" y="0" width="560" height="400" fill="url(#blueprint-grid)" />

        {/* Connection line between person and house */}
        <line x1="100" y1="190" x2="220" y2="190" stroke="#E5E5E5" strokeWidth="2" strokeDasharray="6 6" />
        {[0, 0.8, 1.6].map((delay, i) => (
          <circle key={i} cy="190" r="4" fill="#0A0A0A">
            <animate attributeName="cx" values="100;220" dur="2.5s" begin={`${delay}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="2.5s" begin={`${delay}s`} repeatCount="indefinite" />
          </circle>
        ))}

        {/* Lock at center of connection */}
        <circle cx="160" cy="190" r="14" fill="none" stroke="#0A0A0A" strokeWidth="1.5" opacity="0.5">
          <animate attributeName="r" values="14;19;14" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="160" cy="190" r="13" fill="white" stroke="#0A0A0A" strokeWidth="2" />
        <path d="M154 187 v-3.5 a6 6 0 0 1 12 0 v3.5" fill="none" stroke="#0A0A0A" strokeWidth="2" strokeLinecap="round" />
        <rect x="153" y="187" width="14" height="10" rx="2" fill="#0A0A0A" />

        {/* Person */}
        <g transform="translate(50,140)">
          <motion.g animate={{ y: [0, -10, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
            <circle cx="0" cy="-40" r="16" fill="white" stroke="#0A0A0A" strokeWidth="2" />
            <circle cx="-5" cy="-42" r="1.5" fill="#0A0A0A" />
            <circle cx="5" cy="-42" r="1.5" fill="#0A0A0A" />
            <path d="M-6 -36 Q0 -32 6 -36" fill="none" stroke="#0A0A0A" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M-20 30 Q-20 -22 0 -22 Q20 -22 20 30 Z" fill="#0A0A0A" />
            <rect x="18" y="-6" width="16" height="26" rx="3" fill="white" stroke="#0A0A0A" strokeWidth="2" />
            <rect x="21" y="1" width="10" height="3" rx="1.5" fill="#E5E5E5" />
            <rect x="21" y="1" width="6" height="3" rx="1.5" fill="#0A0A0A" />
            <rect x="21" y="7" width="10" height="3" rx="1.5" fill="#E5E5E5" />
          </motion.g>
          <text x="0" y="58" textAnchor="middle" fontSize="11" fill="#888888">You, Abroad</text>
        </g>

        {/* House */}
        <g transform="translate(320,100)">
          <motion.g animate={{ y: [0, -10, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
            {/* scaffold */}
            <line x1="-95" y1="10" x2="-95" y2="130" stroke="#E5E5E5" strokeWidth="2" strokeDasharray="4 4" />
            <line x1="95" y1="10" x2="95" y2="130" stroke="#E5E5E5" strokeWidth="2" strokeDasharray="4 4" />
            <line x1="-95" y1="60" x2="-70" y2="45" stroke="#E5E5E5" strokeWidth="2" strokeDasharray="4 4" />
            <line x1="95" y1="60" x2="70" y2="45" stroke="#E5E5E5" strokeWidth="2" strokeDasharray="4 4" />

            <rect x="-80" y="120" width="160" height="10" fill="#E5E5E5" />
            <polygon points="-85,20 0,-50 85,20" fill="#F2F2F2" stroke="#0A0A0A" strokeWidth="2" />
            <rect x="-70" y="20" width="140" height="100" fill="white" stroke="#0A0A0A" strokeWidth="2" />

            <rect x="-55" y="40" width="30" height="30" fill="white" stroke="#0A0A0A" strokeWidth="2" />
            <line x1="-40" y1="40" x2="-40" y2="70" stroke="#0A0A0A" strokeWidth="1" />
            <line x1="-55" y1="55" x2="-25" y2="55" stroke="#0A0A0A" strokeWidth="1" />

            <rect x="25" y="40" width="30" height="30" fill="white" stroke="#0A0A0A" strokeWidth="2" />
            <line x1="40" y1="40" x2="40" y2="70" stroke="#0A0A0A" strokeWidth="1" />
            <line x1="25" y1="55" x2="55" y2="55" stroke="#0A0A0A" strokeWidth="1" />

            <path d="M-14 120 V90 a14 14 0 0 1 28 0 v30 Z" fill="white" stroke="#0A0A0A" strokeWidth="2" />
            <circle cx="8" cy="105" r="2" fill="#0A0A0A" />

            {/* Blueprint dimension annotations */}
            <g opacity="0.55">
              <line x1="-80" y1="138" x2="80" y2="138" stroke="#888888" strokeWidth="1" />
              <line x1="-80" y1="134" x2="-80" y2="142" stroke="#888888" strokeWidth="1" />
              <line x1="80" y1="134" x2="80" y2="142" stroke="#888888" strokeWidth="1" />
              <text x="0" y="150" textAnchor="middle" fontSize="9" fill="#888888">12m</text>

              <line x1="112" y1="-50" x2="112" y2="130" stroke="#888888" strokeWidth="1" />
              <line x1="108" y1="-50" x2="116" y2="-50" stroke="#888888" strokeWidth="1" />
              <line x1="108" y1="130" x2="116" y2="130" stroke="#888888" strokeWidth="1" />
              <text x="124" y="43" textAnchor="middle" fontSize="9" fill="#888888" transform="rotate(90 124 43)">8m</text>
            </g>
          </motion.g>
        </g>
      </svg>

      {/* Progress bar overlay above house */}
      <div className="absolute left-[57%] top-[6%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1">
        <div className="w-[120px] h-2 rounded-full bg-[#E0E0E0] overflow-hidden">
          <div className="h-full rounded-full bg-brand-near-black animate-fill-progress" />
        </div>
        <span className="text-[11px] font-semibold text-brand-near-black">60%</span>
        <div className="flex gap-1.5 mt-0.5">
          {[true, true, true, false, null].map((done, i) => (
            <span
              key={i}
              className={
                done
                  ? "flex h-3.5 w-3.5 items-center justify-center rounded-full bg-brand-near-black text-[8px] text-white"
                  : done === false
                    ? "h-3.5 w-3.5 rounded-full bg-brand-soft-grey"
                    : "h-3.5 w-3.5 rounded-full border border-brand-border-grey bg-white"
              }
            >
              {done ? <Check className="size-2.5" /> : ""}
            </span>
          ))}
        </div>
      </div>

      {/* Floating badges */}
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="absolute right-[2%] top-[8%] flex items-center gap-1.5 rounded-full bg-white shadow-[0_4px_18px_rgba(0,0,0,0.12)] px-2 py-1 sm:px-3 sm:py-1.5 text-[9px] sm:text-[11px] font-medium text-brand-near-black whitespace-nowrap"
      >
        <CheckCircle2 className="size-3.5" />
        Stage 3 Verified
      </motion.div>

      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
        className="absolute left-[24%] top-[60%] -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-brand-near-black shadow-[0_4px_18px_rgba(0,0,0,0.18)] px-2 py-1 sm:px-3 sm:py-1.5 text-[9px] sm:text-[11px] font-medium text-white whitespace-nowrap"
      >
        <Lock className="size-3.5" />
        $4K Held
      </motion.div>

      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        className="absolute left-[33%] top-[27%] -translate-x-1/2 -translate-y-1/2 flex items-center gap-1.5 rounded-full bg-white shadow-[0_4px_18px_rgba(0,0,0,0.12)] px-2 py-1 sm:px-3 sm:py-1.5 text-[9px] sm:text-[11px] font-medium text-brand-near-black whitespace-nowrap"
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
