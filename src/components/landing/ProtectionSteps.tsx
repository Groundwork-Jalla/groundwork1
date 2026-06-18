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
    <section className="bg-brand-near-black py-20 px-7 overflow-hidden">
      <div className="max-w-[1000px] mx-auto">
        <Reveal className="text-center mb-12">
          <span className="text-xs font-semibold tracking-[0.12em] text-white/40">HOW JALLA PROTECTS YOU</span>
          <h2 className="font-['Playfair_Display'] text-4xl font-medium text-white mt-3">
            Five Steps. Total Control.
          </h2>
        </Reveal>

        <div className="flex flex-col gap-10 sm:gap-12">
          {steps.map((step, i) => {
            const illustrationLeft = i % 2 === 0;
            return (
              <Reveal key={step.title} direction={illustrationLeft ? "left" : "right"} delay={0.05}>
                <div className={`flex flex-col md:items-center gap-6 md:gap-10 ${illustrationLeft ? "md:flex-row" : "md:flex-row-reverse"}`}>
                  <div className="flex-1 max-w-[300px] mx-auto md:mx-0 min-h-[180px] flex items-center">
                    <step.Scene />
                  </div>
                  <div className="flex-1">
                    <div className="font-['Playfair_Display'] text-[48px] leading-none text-white/10 font-medium">
                      0{i + 1}
                    </div>
                    <h3 className="text-xl font-bold text-white mt-1">{step.title}</h3>
                    <p className="text-sm text-white/50 mt-2 leading-relaxed max-w-[360px]">{step.desc}</p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
