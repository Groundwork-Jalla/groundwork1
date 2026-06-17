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
    <section className="max-w-[900px] mx-auto px-7 py-20 border-t-2 border-brand-near-black">
      <Reveal className="text-center mb-10">
        <span className="text-xs font-semibold tracking-[0.12em] text-brand-mid-grey">IT STARTS SMALL</span>
        <h2 className="font-['Playfair_Display'] text-4xl font-medium text-brand-near-black mt-3">
          6 Ways Builds Lose Control.
        </h2>
        <p className="text-brand-mid-grey mt-3 max-w-[480px] mx-auto">
          None of them look dangerous at first. All of them compound.
        </p>
      </Reveal>

      <div className="flex flex-col gap-5">
        {risks.map(({ Scene, title, description, stat, statLabel }, i) => {
          const illustrationFirst = i % 2 === 0;
          return (
            <Reveal key={title} direction={illustrationFirst ? "left" : "right"} delay={i * 0.1}>
              <motion.div
                whileHover={{ y: -2 }}
                className={`bg-white rounded-xl border border-brand-border-grey overflow-hidden flex flex-col hover:shadow-lg transition-shadow ${
                  illustrationFirst ? "md:flex-row" : "md:flex-row-reverse"
                }`}
              >
                <div className="bg-brand-off-white p-6 flex items-center justify-center md:w-[280px] shrink-0">
                  <div className="w-full max-w-[240px]">
                    <Scene />
                  </div>
                </div>
                <div className="flex-1 p-6 flex flex-col justify-center">
                  <div className="flex items-baseline gap-3">
                    <span className="font-['Playfair_Display'] text-[28px] text-brand-border-grey">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-[15px] font-bold text-brand-near-black">{title}</h3>
                  </div>
                  <p className="text-sm text-brand-mid-grey mt-1">{description}</p>
                  <div className="inline-flex items-center gap-2 bg-brand-pale rounded-full px-3 py-1 mt-3 self-start">
                    <span className="font-['Playfair_Display'] text-base font-bold text-brand-near-black">{stat}</span>
                    <span className="text-[11px] text-brand-mid-grey">{statLabel}</span>
                  </div>
                </div>
              </motion.div>
            </Reveal>
          );
        })}
      </div>

      <p className="italic text-center text-brand-mid-grey mt-10">
        Once control is lost, it is hard to get back.
      </p>
      <LossCounter />
    </section>
  );
}
