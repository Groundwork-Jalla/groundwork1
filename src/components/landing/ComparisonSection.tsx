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
    <section className="bg-brand-off-white border-y border-brand-border-grey py-20 px-7">
      <div className="max-w-[1000px] mx-auto">
        <Reveal className="text-center mb-12">
          <span className="text-xs font-semibold tracking-[0.12em] text-brand-mid-grey">THE DIFFERENCE</span>
          <h2 className="font-['Playfair_Display'] text-4xl font-medium text-brand-near-black mt-3">
            Without Structure vs. With Groundwork
          </h2>
        </Reveal>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Reveal direction="left">
            <motion.div
              whileHover={{ y: -4 }}
              className="bg-white rounded-2xl border border-brand-border-grey overflow-hidden h-full shadow-[0_4px_20px_rgba(0,0,0,0.04)]"
            >
              <div className="bg-brand-pale h-40 flex items-center justify-center p-4">
                <WithoutStructureScene />
              </div>
              <div className="p-8">
                <h3 className="font-['Playfair_Display'] text-xl text-brand-near-black mb-4">Without Structure</h3>
                <ul className="space-y-3">
                  {without.map((item) => (
                    <li key={item} className="flex gap-2 text-sm text-brand-mid-grey">
                      <X className="size-4 shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          </Reveal>

          <Reveal direction="right" delay={0.15}>
            <motion.div
              whileHover={{ y: -4 }}
              className="bg-brand-near-black rounded-2xl overflow-hidden h-full shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
            >
              <div className="bg-white/5 h-40 flex items-center justify-center p-4">
                <WithGroundworkScene />
              </div>
              <div className="p-8">
                <h3 className="font-['Playfair_Display'] text-xl text-white mb-4">With Groundwork</h3>
                <ul className="space-y-3">
                  {withGroundwork.map((item) => (
                    <li key={item} className="flex gap-2 text-sm text-white/70">
                      <Check className="size-4 shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
