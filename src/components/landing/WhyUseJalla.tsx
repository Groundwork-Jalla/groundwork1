import { motion } from "framer-motion";
import { Reveal } from "./Reveal";

const D = "#0A0A0A";

function ProtectedIcon() {
  return (
    <svg viewBox="0 0 140 140" className="w-full h-full" aria-hidden="true">
      <circle cx="70" cy="70" r="55" fill="none" stroke={D} strokeOpacity="0.08" strokeWidth="1.5">
        <animate attributeName="r" values="55;63;55" dur="2.6s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.3;0;0.3" dur="2.6s" repeatCount="indefinite" />
      </circle>
      <circle cx="70" cy="70" r="55" fill="none" stroke={D} strokeOpacity="0.06" strokeWidth="1.5">
        <animate attributeName="r" values="40;55;40" dur="2.6s" begin="1.3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.25;0;0.25" dur="2.6s" begin="1.3s" repeatCount="indefinite" />
      </circle>
      <path
        d="M70,15 L115,32 V70 C115,100 95,118 70,128 C45,118 25,100 25,70 V32 Z"
        fill="none"
        stroke={D}
        strokeOpacity="0.65"
        strokeWidth="2"
      />
      <rect x="58" y="68" width="24" height="18" rx="3" fill={D} />
      <path d="M62,68 v-7 a8,8 0 1,1 16,0 v7" stroke={D} strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle r="3" fill={D}>
        <animateMotion
          path="M70,15 L115,32 V70 C115,100 95,118 70,128 C45,118 25,100 25,70 V32 Z"
          dur="4s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

function CheckedIcon() {
  return (
    <svg viewBox="0 0 140 140" className="w-full h-full" aria-hidden="true">
      <circle cx="60" cy="78" r="26" fill={D} />
      <path d="M50,78 L57,85 L72,68" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <motion.g animate={{ y: [0, -4, 0], x: [0, 3, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
        <circle cx="92" cy="46" r="22" fill="none" stroke={D} strokeOpacity="0.65" strokeWidth="3" />
        <line x1="107" y1="61" x2="119" y2="73" stroke={D} strokeOpacity="0.65" strokeWidth="4" strokeLinecap="round" />
      </motion.g>
      <line x1="20" y1="20" x2="120" y2="20" stroke={D} strokeOpacity="0.12" strokeWidth="1.5">
        <animate attributeName="y1" values="20;120;20" dur="3.4s" repeatCount="indefinite" />
        <animate attributeName="y2" values="20;120;20" dur="3.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.4;0" dur="3.4s" repeatCount="indefinite" />
      </line>
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={20 + i * 14} cy="112" r="2" fill={D} opacity="0.3">
          <animate attributeName="opacity" values="0.15;0.5;0.15" dur="1.8s" begin={`${i * 0.25}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </svg>
  );
}

function VisibilityIcon() {
  return (
    <svg viewBox="0 0 140 140" className="w-full h-full" aria-hidden="true">
      <rect x="40" y="20" width="40" height="72" rx="8" fill="none" stroke={D} strokeOpacity="0.65" strokeWidth="2" />
      <line x1="50" y1="62" x2="70" y2="62" stroke={D} strokeOpacity="0.35" strokeWidth="2" />
      <line x1="50" y1="70" x2="64" y2="70" stroke={D} strokeOpacity="0.35" strokeWidth="2" />
      <circle cx="60" cy="40" r="3" fill={D}>
        <animate attributeName="opacity" values="1;0.2;1" dur="1.6s" repeatCount="indefinite" />
      </circle>
      {[28, 38, 48].map((r, i) => (
        <path
          key={i}
          d={`M ${85 + r * 0.3} ${45 - r * 0.6} A ${r} ${r} 0 0 1 ${85 + r * 0.3} ${45 + r * 0.6}`}
          fill="none"
          stroke={D}
          strokeOpacity="0"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <animate attributeName="stroke-opacity" values="0;0.4;0" dur="2.4s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
        </path>
      ))}
      <motion.g animate={{ y: [0, -5, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
        <circle cx="100" cy="105" r="8" fill="none" stroke={D} strokeOpacity="0.6" strokeWidth="2" />
        <path d="M100,113 L100,124" stroke={D} strokeOpacity="0.6" strokeWidth="2" strokeLinecap="round" />
      </motion.g>
    </svg>
  );
}

const reasons = [
  {
    Icon: ProtectedIcon,
    title: "Your money stays protected",
    desc: "Funds don't move without verified proof, every time.",
    badge: "$0 Lost",
  },
  {
    Icon: CheckedIcon,
    title: "Every stage is independently checked",
    desc: "Not your contractor's word — real, on-site verification.",
    badge: "60+ Checkpoints",
  },
  {
    Icon: VisibilityIcon,
    title: "Full visibility from anywhere",
    desc: "Track your build from your phone, 6,000 miles away.",
    badge: "Live Updates",
  },
];

export default function WhyUseJalla() {
  return (
    <section className="bg-white py-16 px-7 border-t border-brand-border-grey">
      <div className="max-w-[1000px] mx-auto">
        <Reveal className="text-center mb-14">
          <span className="text-xs font-semibold tracking-[0.12em] text-brand-mid-grey">WHY JALLA</span>
          <h2 className="font-sans text-3xl sm:text-4xl font-bold text-brand-near-black mt-3 max-w-150 mx-auto">
            A System of Trust through Accountability and Guardrails
          </h2>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {reasons.map((reason, i) => (
            <Reveal key={reason.title} delay={i * 0.15}>
              <motion.div
                whileHover={{ y: -6 }}
                animate={{
                  boxShadow: [
                    "0 8px 30px rgba(0,0,0,0.06)",
                    "0 8px 30px rgba(0,0,0,0.12)",
                    "0 8px 30px rgba(0,0,0,0.06)",
                  ],
                }}
                transition={{
                  boxShadow: { duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: i * 0.5 },
                }}
                className="relative bg-brand-off-white border border-brand-border-grey rounded-2xl p-6 md:p-8 h-full hover:bg-brand-pale transition-colors overflow-visible"
              >
                <motion.div
                  animate={{ y: [0, -7, 0] }}
                  transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 }}
                  className="absolute -top-3 right-6 rounded-full bg-brand-near-black text-white text-[10px] font-semibold px-2.5 py-1 shadow-[0_4px_14px_rgba(0,0,0,0.18)] whitespace-nowrap"
                >
                  {reason.badge}
                </motion.div>

                <motion.div whileHover={{ scale: 1.08 }} className="h-24 md:h-32 mb-6">
                  <reason.Icon />
                </motion.div>
                <h3 className="text-lg md:text-xl font-bold text-brand-near-black leading-snug">{reason.title}</h3>
                <p className="text-sm text-brand-mid-grey mt-3 leading-relaxed">{reason.desc}</p>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
