import { motion } from "framer-motion";
import { Reveal } from "./Reveal";
import LossCounter from "./LossCounter";
import {
  MoneyLeakScene,
  NoMilestonesScene,
  NoVerificationScene,
  NoProofScene,
  DelaysScene,
  MisalignedScene,
} from "./RiskScenes";

const risks = [
  {
    Scene: MoneyLeakScene,
    title: "Budget Drains Silently",
    description: "Money moves before work happens, and there's no record of where it went.",
    stat: "30%+",
    statLabel: "average overrun",
  },
  {
    Scene: NoMilestonesScene,
    title: "No Clear Milestones",
    description: "Without defined stages, progress is whatever the contractor says it is.",
    stat: "10",
    statLabel: "stages, undefined",
  },
  {
    Scene: NoVerificationScene,
    title: "No One Verifies the Work",
    description: "Payments get released on trust, not on confirmed, inspected progress.",
    stat: "1 in 3",
    statLabel: "skip inspection",
  },
  {
    Scene: NoProofScene,
    title: "No Photo or Video Proof",
    description: "When a dispute happens, there's nothing to show what was actually built.",
    stat: "48%",
    statLabel: "disputes, no evidence",
  },
  {
    Scene: DelaysScene,
    title: "Costly Delays",
    description: "Without checkpoints, slippage compounds quietly month over month.",
    stat: "3-6mo",
    statLabel: "average slippage",
  },
  {
    Scene: MisalignedScene,
    title: "Builder & Owner Misaligned",
    description: "You're picturing one thing. The contractor is building another.",
    stat: "67%",
    statLabel: "report miscommunication",
  },
];

export default function RiskSection() {
  return (
    <section className="max-w-[1000px] mx-auto px-7 py-28 border-t-2 border-brand-near-black">
      <Reveal className="text-center mb-16">
        <span className="text-xs font-semibold tracking-[0.12em] text-brand-mid-grey">HOW JALLA WORKS</span>
        <h2 className="font-['Playfair_Display'] text-5xl font-medium text-brand-near-black mt-3">
          6 Ways Builds Lose Control.
        </h2>
        <p className="text-brand-mid-grey mt-4 max-w-[500px] mx-auto text-base">
          None of them look dangerous at first. All of them compound.
        </p>
      </Reveal>

      <div className="flex flex-col gap-7">
        {risks.map(({ Scene, title, description, stat, statLabel }, i) => {
          const illustrationFirst = i % 2 === 0;
          return (
            <Reveal key={title} direction={illustrationFirst ? "left" : "right"} delay={i * 0.1}>
              <motion.div
                whileHover={{ y: -4 }}
                className={`group bg-white rounded-2xl border border-brand-border-grey overflow-hidden flex flex-col shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_16px_40px_rgba(0,0,0,0.08)] transition-shadow duration-300 ${
                  illustrationFirst ? "md:flex-row" : "md:flex-row-reverse"
                }`}
              >
                <div className="relative bg-brand-off-white p-9 flex items-center justify-center md:w-[320px] shrink-0 overflow-hidden">
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                    style={{
                      backgroundImage: "radial-gradient(circle, rgba(10,10,10,0.07) 1px, transparent 1px)",
                      backgroundSize: "14px 14px",
                    }}
                  />
                  <div className="relative w-full max-w-[260px]">
                    <Scene />
                  </div>
                </div>
                <div className="flex-1 p-9 flex flex-col justify-center">
                  <div className="flex items-baseline gap-4">
                    <span className="font-['Playfair_Display'] text-5xl text-brand-border-grey leading-none">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-lg font-bold text-brand-near-black">{title}</h3>
                  </div>
                  <p className="text-sm text-brand-mid-grey mt-2 leading-relaxed">{description}</p>
                  <div className="inline-flex items-center gap-2.5 bg-brand-near-black rounded-full px-4 py-2 mt-4 self-start">
                    <span className="font-['Playfair_Display'] text-xl font-bold text-white">{stat}</span>
                    <span className="text-xs text-white/60">{statLabel}</span>
                  </div>
                </div>
              </motion.div>
            </Reveal>
          );
        })}
      </div>

      <p className="italic text-center text-brand-mid-grey mt-12 text-lg">
        Once control is lost, it is hard to get back.
      </p>
      <LossCounter />
    </section>
  );
}
