import { motion } from "framer-motion";
import { X, Check } from "lucide-react";
import { Reveal } from "./Reveal";
import { WithoutStructureScene, WithGroundworkScene } from "./ComparisonScenes";

const without = [
  "Hard to know what is happening on-site",
  "Updates come late, or not at all",
  "Disputes over what was actually completed",
  "Money can get stuck, or paid too early",
  "You rely on trust and scattered updates",
  "You spend time chasing information",
  "You risk paying for work you cannot confirm",
  "Problems show up late, when they cost more",
];

const withGroundwork = [
  "Clear milestones and expectations from day one",
  "Evidence-based updates you can review anytime",
  "Independent verification before payment",
  "Payments tied to each stage's progress",
  "You get a clear project record in one place",
  "You see progress with proof, not promises",
  "You reduce payment risk with verification",
  "Problems are discovered and fixed before the next stage unlocks",
];

export default function ComparisonSection() {
  return (
    <section className="bg-brand-near-black py-20 px-4 sm:px-7">
      <div className="max-w-260 mx-auto">
        <Reveal className="text-center mb-16">
          <span className="text-xs font-semibold tracking-[0.12em] text-white/40">THE DIFFERENCE</span>
          <h2 className="font-sans text-2xl sm:text-3xl lg:text-5xl font-bold text-white mt-3">
            Building Back Home: Without Structure vs. With Groundwork
          </h2>
          <p className="text-white/50 mt-4 text-base">The same build. Two very different outcomes.</p>
        </Reveal>

        <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-0">
          <div className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 items-center justify-center">
            <div className="h-16 w-16 rounded-full bg-white border-4 border-brand-near-black shadow-[0_4px_16px_rgba(0,0,0,0.3)] flex items-center justify-center">
              <span className="font-sans text-brand-near-black text-sm font-bold tracking-wide">VS</span>
            </div>
          </div>

          {/* Without Structure — white card on dark section */}
          <Reveal direction="left">
            <motion.div
              whileHover={{ y: -4 }}
              className="bg-white rounded-2xl lg:rounded-r-none border border-white/10 overflow-hidden h-full shadow-[0_4px_20px_rgba(0,0,0,0.25)]"
            >
              <div className="bg-brand-pale h-52 flex items-center justify-center p-5">
                <WithoutStructureScene />
              </div>
              <div className="p-5 sm:p-8">
                <h3 className="font-sans text-2xl text-brand-near-black mb-1">Without Structure</h3>
                <p className="text-xs text-brand-mid-grey mb-5">What happens by default</p>
                <ul className="divide-y divide-brand-border-grey">
                  {without.map((item) => (
                    <li key={item} className="flex items-center gap-3 py-2.5">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-brand-border-grey text-brand-mid-grey shrink-0">
                        <X className="size-3.5" />
                      </span>
                      <span className="text-sm text-brand-mid-grey">{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 pt-5 border-t border-brand-border-grey">
                  <span className="inline-flex items-center gap-2 bg-brand-pale rounded-full px-4 py-2">
                    <span className="font-sans text-lg font-bold text-brand-near-black">$48,000</span>
                    <span className="text-xs text-brand-mid-grey">average loss</span>
                  </span>
                </div>
              </div>
            </motion.div>
          </Reveal>

          {/* Mobile VS divider — between cards in single-column layout */}
          <div className="lg:hidden flex items-center justify-center py-1">
            <div className="h-9 w-9 rounded-full bg-white border-2 border-brand-near-black flex items-center justify-center">
              <span className="font-sans text-brand-near-black text-xs font-bold">VS</span>
            </div>
          </div>

          {/* With Groundwork — slightly lifted dark card */}
          <Reveal direction="right" delay={0.15}>
            <motion.div
              whileHover={{ y: -4 }}
              className="bg-white/[0.07] border border-white/[0.14] rounded-2xl lg:rounded-l-none overflow-hidden h-full shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
            >
              <div className="bg-white/5 h-52 flex items-center justify-center p-5">
                <WithGroundworkScene />
              </div>
              <div className="p-5 sm:p-8">
                <h3 className="font-sans text-2xl text-white mb-1">With Groundwork</h3>
                <p className="text-xs text-white/40 mb-5">What happens by design</p>
                <ul className="divide-y divide-white/10">
                  {withGroundwork.map((item) => (
                    <li key={item} className="flex items-center gap-3 py-2.5">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-brand-near-black shrink-0">
                        <Check className="size-3.5" />
                      </span>
                      <span className="text-sm text-white/80">{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 pt-5 border-t border-white/10">
                  <span className="inline-flex items-center gap-2 bg-white/10 rounded-full px-4 py-2">
                    <span className="font-sans text-lg font-bold text-white">100%</span>
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
