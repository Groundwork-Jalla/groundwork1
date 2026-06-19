import { motion } from "framer-motion";
import { X, Check } from "lucide-react";
import { Reveal } from "./Reveal";
import { WithoutStructureScene, WithGroundworkScene } from "./ComparisonScenes";

const without = [
  "Payments made on trust, not proof",
  "No clear record of progress",
  "Disputes with no evidence to settle them",
  "Delays discovered too late",
  "Budget overruns nobody saw coming",
];

const withGroundwork = [
  "Payments tied to verified milestones",
  "Photo and video proof at every stage",
  "An independent record everyone can see",
  "Deviations caught while they're cheap",
  "A budget that holds, stage by stage",
];

export default function ComparisonSection() {
  return (
    <section className="bg-brand-off-white border-y border-brand-border-grey py-24 px-7">
      <div className="max-w-[1040px] mx-auto">
        <Reveal className="text-center mb-16">
          <span className="text-xs font-semibold tracking-[0.12em] text-brand-mid-grey">THE DIFFERENCE</span>
          <h2 className="font-['Playfair_Display'] text-5xl font-medium text-brand-near-black mt-3">
            Without Structure vs. With Groundwork
          </h2>
          <p className="text-brand-mid-grey mt-4 text-base">The same build. Two very different outcomes.</p>
        </Reveal>

        <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-0">
          <div className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 items-center justify-center">
            <div className="h-16 w-16 rounded-full bg-brand-near-black border-4 border-brand-off-white shadow-[0_4px_16px_rgba(0,0,0,0.2)] flex items-center justify-center">
              <span className="font-['Playfair_Display'] text-white text-sm font-bold tracking-wide">VS</span>
            </div>
          </div>

          <Reveal direction="left">
            <motion.div
              whileHover={{ y: -4 }}
              className="bg-white rounded-2xl lg:rounded-r-none border border-brand-border-grey overflow-hidden h-full shadow-[0_4px_20px_rgba(0,0,0,0.04)]"
            >
              <div className="bg-brand-pale h-52 flex items-center justify-center p-5">
                <WithoutStructureScene />
              </div>
              <div className="p-8">
                <h3 className="font-['Playfair_Display'] text-2xl text-brand-near-black mb-1">Without Structure</h3>
                <p className="text-xs text-brand-mid-grey mb-5">What happens by default</p>
                <ul className="divide-y divide-brand-border-grey">
                  {without.map((item) => (
                    <li key={item} className="flex items-center gap-3 py-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-brand-border-grey text-brand-mid-grey shrink-0">
                        <X className="size-3.5" />
                      </span>
                      <span className="text-sm text-brand-mid-grey">{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 pt-5 border-t border-brand-border-grey">
                  <span className="inline-flex items-center gap-2 bg-brand-pale rounded-full px-4 py-2">
                    <span className="font-['Playfair_Display'] text-lg font-bold text-brand-near-black">$48,000</span>
                    <span className="text-xs text-brand-mid-grey">average loss</span>
                  </span>
                </div>
              </div>
            </motion.div>
          </Reveal>

          <Reveal direction="right" delay={0.15}>
            <motion.div
              whileHover={{ y: -4 }}
              className="bg-brand-near-black rounded-2xl lg:rounded-l-none overflow-hidden h-full shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
            >
              <div className="bg-white/5 h-52 flex items-center justify-center p-5">
                <WithGroundworkScene />
              </div>
              <div className="p-8">
                <h3 className="font-['Playfair_Display'] text-2xl text-white mb-1">With Groundwork</h3>
                <p className="text-xs text-white/40 mb-5">What happens by design</p>
                <ul className="divide-y divide-white/10">
                  {withGroundwork.map((item) => (
                    <li key={item} className="flex items-center gap-3 py-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-brand-near-black shrink-0">
                        <Check className="size-3.5" />
                      </span>
                      <span className="text-sm text-white/80">{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 pt-5 border-t border-white/10">
                  <span className="inline-flex items-center gap-2 bg-white/10 rounded-full px-4 py-2">
                    <span className="font-['Playfair_Display'] text-lg font-bold text-white">100%</span>
                    <span className="text-xs text-white/50">payments verified</span>
                  </span>
                </div>
              </div>
            </motion.div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
