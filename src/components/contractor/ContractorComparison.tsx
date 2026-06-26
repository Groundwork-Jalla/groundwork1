import { motion } from "framer-motion";
import { X, Check } from "lucide-react";
import { Reveal } from "@/components/landing/Reveal";

const without = ["Unclear clients", "Payment delays", "Disorganized workflow", "Constant confusion", "Heavy competition"];
const withJalla = ["Structured projects", "Secured, milestone payments", "Coordinated execution", "Defined roles and sequence", "Trade caps per region"];

export default function ContractorComparison() {
  return (
    <section className="bg-brand-off-white px-7 py-18">
      <div className="max-w-[750px] mx-auto">
        <Reveal className="text-center mb-9">
          <h2 className="font-['Playfair_Display'] text-2xl md:text-3xl font-medium text-brand-near-black">
            Without Jalla vs. With Jalla
          </h2>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Reveal direction="left">
            <motion.div whileHover={{ y: -3 }} className="bg-white rounded-2xl border border-brand-border-grey p-7 h-full">
              <h3 className="text-base font-bold text-brand-near-black mb-4">Without Jalla</h3>
              <ul className="space-y-2.5">
                {without.map((t) => (
                  <li key={t} className="flex gap-2 text-sm text-brand-mid-grey">
                    <X className="size-4 shrink-0 mt-0.5" />
                    {t}
                  </li>
                ))}
              </ul>
            </motion.div>
          </Reveal>

          <Reveal direction="right" delay={0.15}>
            <motion.div whileHover={{ y: -3 }} className="bg-brand-near-black rounded-2xl p-7 h-full">
              <h3 className="text-base font-bold text-white mb-4">With Jalla</h3>
              <ul className="space-y-2.5">
                {withJalla.map((t) => (
                  <li key={t} className="flex gap-2 text-sm text-white/70">
                    <Check className="size-4 shrink-0 mt-0.5" />
                    {t}
                  </li>
                ))}
              </ul>
            </motion.div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
