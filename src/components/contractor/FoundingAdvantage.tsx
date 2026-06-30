import { motion } from "framer-motion";
import { User, VolumeX } from "lucide-react";
import { Reveal } from "@/components/landing/Reveal";

function StableLineIcon() {
  return (
    <svg viewBox="0 0 40 40" className="w-7 h-7" aria-hidden="true">
      <line x1="4" y1="20" x2="36" y2="20" stroke="white" strokeWidth="2.5" strokeLinecap="round">
        <animate attributeName="opacity" values="0.6;1;0.6" dur="2.4s" repeatCount="indefinite" />
      </line>
      <circle r="2.5" fill="white">
        <animate attributeName="cx" values="4;36;4" dur="3s" repeatCount="indefinite" />
        <animate attributeName="cy" values="20;20;20" dur="3s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

function StaircaseIcon() {
  return (
    <svg viewBox="0 0 40 40" className="w-7 h-7" aria-hidden="true">
      <path d="M4 34 H12 V26 H20 V18 H28 V10 H36" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {[[12, 26], [20, 18], [28, 10]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y - 4} r="2" fill="white" opacity="0">
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.8;1" dur="2.4s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </svg>
  );
}

const advantages = [
  { Icon: User, title: "Less saturation", desc: "One figure, not a crowd" },
  { Icon: StableLineIcon, title: "Less price racing", desc: "Stable, not volatile", custom: true },
  { Icon: VolumeX, title: "Less noise", desc: "Signal, not static" },
  { Icon: StaircaseIcon, title: "More consistent opportunities", desc: "Climbing, not waiting", custom: true },
];

export default function FoundingAdvantage() {
  return (
    <section className="bg-brand-near-black px-7 py-18">
      <div className="max-w-[900px] mx-auto">
        <Reveal className="text-center mb-10">
          <h2 className="font-sans text-3xl md:text-4xl font-bold text-white">
            First in gets the best position.
          </h2>
          <p className="text-sm text-white/50 mt-3">We're onboarding a limited number of partners per trade, per region.</p>
        </Reveal>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {advantages.map((a, i) => (
            <Reveal key={a.title} delay={i * 0.12}>
              <motion.div
                whileHover={{ y: -4, backgroundColor: "rgba(255,255,255,0.08)" }}
                className="bg-white/5 border border-white/10 rounded-xl p-6 text-center h-full"
              >
                <div className="inline-flex mb-3 text-white/80">
                  {a.custom ? <a.Icon /> : <a.Icon className="size-7" />}
                </div>
                <h3 className="text-xs font-semibold text-white">{a.title}</h3>
                <p className="text-[11px] text-white/40 mt-1">{a.desc}</p>
              </motion.div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.5}>
          <p className="font-sans italic text-white/40 text-center mt-8 max-w-[480px] mx-auto">
            If you're accepted as a Founding Partner, you're positioned for early access and priority placement as
            demand ramps.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
