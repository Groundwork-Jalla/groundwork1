import { motion } from "framer-motion";
import { Reveal } from "./Reveal";
import { BudgetScene, StagesScene, ProofScene, VerifyScene, FixScene } from "./ProtectionScenes";

const steps = [
  { Scene: BudgetScene, title: "Set the Right Budget", desc: "Anchor the project against real costs before a single payment moves." },
  { Scene: StagesScene, title: "Break Into Clear Steps", desc: "Every build is split into stages and substages, each one verifiable." },
  { Scene: ProofScene, title: "Tie Payments to Proof", desc: "Funds release only when a stage is confirmed complete." },
  { Scene: VerifyScene, title: "Check the Work", desc: "Independent verification on every checkpoint, not just your contractor's word." },
  { Scene: FixScene, title: "Fix Problems Early", desc: "Catch deviations while they're cheap to fix, not after the walls are up." },
];

export default function ProtectionSteps() {
  return (
    <section className="bg-brand-near-black py-[72px]">
      <div className="max-w-[1100px] mx-auto px-7">
        <Reveal className="text-center mb-10">
          <span className="text-xs font-semibold tracking-[0.12em] text-white/40">HOW JALLA PROTECTS YOU</span>
          <h2 className="font-['Playfair_Display'] text-4xl font-medium text-white mt-3">
            Five Steps. Total Control.
          </h2>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
          {steps.map((step, i) => (
            <Reveal key={step.title} delay={i * 0.1} className={i === 4 ? "md:col-span-2 lg:col-span-1" : undefined}>
              <motion.div
                whileHover={{ y: -4 }}
                className="bg-brand-rich-black rounded-2xl p-6 min-h-[280px] flex flex-col h-full"
              >
                <motion.div whileHover={{ scale: 1.06 }} className="h-40 flex items-center justify-center mb-4">
                  <step.Scene />
                </motion.div>
                <div className="mt-auto">
                  <div className="font-['Playfair_Display'] text-[32px] font-extralight text-white/10 mb-2">
                    0{i + 1}
                  </div>
                  <h3 className="text-xs font-semibold text-white mb-1.5">{step.title}</h3>
                  <p className="text-[11px] text-white/40 leading-relaxed">{step.desc}</p>
                </div>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
