import { motion } from "framer-motion";
import { ClipboardList, SearchCheck, Rocket, TrendingUp } from "lucide-react";
import { Reveal } from "@/components/landing/Reveal";

const steps = [
  { Icon: ClipboardList, title: "Apply", desc: "Share your trade, location, experience, and past work." },
  { Icon: SearchCheck, title: "Vetting & Verification", desc: "We verify credentials, track record, and reputation." },
  { Icon: Rocket, title: "Activation", desc: "Placed into projects matching your role and capacity." },
  { Icon: TrendingUp, title: "Grow", desc: "Strong performance unlocks more projects and higher value work." },
];

export default function HowItWorks() {
  return (
    <section className="bg-white px-7 py-18">
      <div className="max-w-[900px] mx-auto">
        <Reveal className="text-center mb-12">
          <h2 className="font-['Playfair_Display'] text-2xl md:text-3xl font-medium text-brand-near-black">
            How it works.
          </h2>
        </Reveal>

        <div className="relative grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 md:gap-4">
          <div className="hidden md:block absolute top-[26px] left-[12%] right-[12%] h-px border-t border-dashed border-brand-border-grey" />
          {steps.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.12} className="text-center relative">
              <div className="font-['Playfair_Display'] text-4xl font-light text-brand-border-grey mb-1">0{i + 1}</div>
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 }}
                className="inline-flex bg-white relative z-10 text-brand-near-black mb-2"
              >
                <s.Icon className="size-6" />
              </motion.div>
              <h3 className="text-sm font-bold text-brand-near-black">{s.title}</h3>
              <p className="text-xs text-brand-mid-grey mt-1 leading-relaxed">{s.desc}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
