import { motion } from "framer-motion";
import { Reveal } from "./Reveal";

function ProtectedIcon() {
  return (
    <svg viewBox="0 0 140 140" className="w-full h-full" aria-hidden="true">
      <circle cx="70" cy="70" r="55" fill="none" stroke="white" strokeOpacity="0.15" strokeWidth="1.5">
        <animate attributeName="r" values="55;63;55" dur="2.6s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.3;0;0.3" dur="2.6s" repeatCount="indefinite" />
      </circle>
      <path
        d="M70,15 L115,32 V70 C115,100 95,118 70,128 C45,118 25,100 25,70 V32 Z"
        fill="none"
        stroke="white"
        strokeOpacity="0.7"
        strokeWidth="2"
      />
      <rect x="58" y="68" width="24" height="18" rx="3" fill="white" />
      <path d="M62,68 v-7 a8,8 0 1,1 16,0 v7" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function CheckedIcon() {
  return (
    <svg viewBox="0 0 140 140" className="w-full h-full" aria-hidden="true">
      <circle cx="60" cy="78" r="26" fill="white" />
      <path d="M50,78 L57,85 L72,68" fill="none" stroke="#0A0A0A" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <motion.g animate={{ y: [0, -4, 0], x: [0, 3, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
        <circle cx="92" cy="46" r="22" fill="none" stroke="white" strokeOpacity="0.8" strokeWidth="3" />
        <line x1="107" y1="61" x2="119" y2="73" stroke="white" strokeOpacity="0.8" strokeWidth="4" strokeLinecap="round" />
      </motion.g>
      <line x1="20" y1="20" x2="120" y2="20" stroke="white" strokeOpacity="0.25" strokeWidth="1.5">
        <animate attributeName="y1" values="20;120;20" dur="3.4s" repeatCount="indefinite" />
        <animate attributeName="y2" values="20;120;20" dur="3.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.4;0" dur="3.4s" repeatCount="indefinite" />
      </line>
    </svg>
  );
}

function VisibilityIcon() {
  return (
    <svg viewBox="0 0 140 140" className="w-full h-full" aria-hidden="true">
      <rect x="40" y="20" width="40" height="72" rx="8" fill="none" stroke="white" strokeOpacity="0.8" strokeWidth="2" />
      <line x1="50" y1="62" x2="70" y2="62" stroke="white" strokeOpacity="0.4" strokeWidth="2" />
      <line x1="50" y1="70" x2="64" y2="70" stroke="white" strokeOpacity="0.4" strokeWidth="2" />
      {[28, 38, 48].map((r, i) => (
        <path
          key={i}
          d={`M ${85 + r * 0.3} ${45 - r * 0.6} A ${r} ${r} 0 0 1 ${85 + r * 0.3} ${45 + r * 0.6}`}
          fill="none"
          stroke="white"
          strokeOpacity="0"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <animate attributeName="stroke-opacity" values="0;0.5;0" dur="2.4s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
        </path>
      ))}
      <motion.g animate={{ y: [0, -5, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
        <circle cx="100" cy="105" r="8" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="2" />
        <path d="M100,113 L100,124" stroke="white" strokeOpacity="0.7" strokeWidth="2" strokeLinecap="round" />
      </motion.g>
    </svg>
  );
}

const reasons = [
  {
    Icon: ProtectedIcon,
    title: "Your money stays protected",
    desc: "Funds don't move without verified proof, every time.",
  },
  {
    Icon: CheckedIcon,
    title: "Every stage is independently checked",
    desc: "Not your contractor's word — real, on-site verification.",
  },
  {
    Icon: VisibilityIcon,
    title: "Full visibility from anywhere",
    desc: "Track your build from your phone, 6,000 miles away.",
  },
];

export default function WhyUseJalla() {
  return (
    <section className="bg-brand-near-black py-24 px-7">
      <div className="max-w-[1000px] mx-auto">
        <Reveal className="text-center mb-14">
          <span className="text-xs font-semibold tracking-[0.12em] text-white/40">WHY JALLA</span>
          <h2 className="font-['Playfair_Display'] text-4xl font-medium text-white mt-3">
            Built to Be Trusted.
          </h2>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {reasons.map((reason, i) => (
            <Reveal key={reason.title} delay={i * 0.15}>
              <motion.div
                whileHover={{ y: -6 }}
                className="bg-white/5 border border-white/10 rounded-2xl p-8 h-full shadow-[0_8px_30px_rgba(0,0,0,0.3)] hover:bg-white/[0.08] transition-colors"
              >
                <div className="h-32 mb-6">
                  <reason.Icon />
                </div>
                <h3 className="text-xl font-bold text-white leading-snug">{reason.title}</h3>
                <p className="text-sm text-white/55 mt-3 leading-relaxed">{reason.desc}</p>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
