import { motion } from "framer-motion";
import { Frown, Smile, X, Check } from "lucide-react";
import { Reveal } from "./Reveal";

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
    <section className="bg-brand-off-white border-y border-brand-border-grey py-20">
      <div className="max-w-[1000px] mx-auto px-7">
        <h2 className="font-['Playfair_Display'] text-4xl font-medium text-brand-near-black text-center mb-12">
          Without Structure vs. With Groundwork
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Reveal>
            <div className="bg-white rounded-2xl border border-brand-border-grey p-8 h-full">
              <motion.div
                animate={{ rotate: [0, -6, 6, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="inline-flex text-brand-mid-grey mb-2"
              >
                <Frown className="size-8" />
              </motion.div>
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
          </Reveal>

          <Reveal delay={0.2}>
            <div className="bg-brand-near-black rounded-2xl p-8 h-full">
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                className="inline-flex text-white mb-2"
              >
                <Smile className="size-8" />
              </motion.div>
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
          </Reveal>
        </div>
      </div>
    </section>
  );
}
