import { Check, X } from "lucide-react";
import { Reveal } from "@/components/landing/Reveal";

const notFor = [
  "Avoid documentation and structure",
  "Cannot verify past work or credentials",
  "Prefer informal, cash-only arrangements",
  "Resist milestone-based delivery and transparency",
];

const isFor = [
  "You take your craft seriously",
  "You want consistent, organized projects",
  "You value clarity, accountability, and standards",
  "You want to grow beyond small, informal jobs",
];

export default function FitSection() {
  return (
    <section className="bg-brand-off-white px-7 py-18">
      <div className="max-w-[900px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-5">
        <Reveal direction="left">
          <div className="bg-brand-near-black rounded-2xl p-8 md:p-10 h-full">
            <h3 className="text-xl font-bold text-white/40 mb-5">This is NOT for you if:</h3>
            <ul className="space-y-3">
              {notFor.map((t) => (
                <li key={t} className="flex gap-2.5 text-sm text-white/30 line-through">
                  <X className="size-4 shrink-0 mt-0.5" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
        <Reveal direction="right" delay={0.15}>
          <div className="bg-white rounded-2xl border border-brand-border-grey p-8 md:p-10 h-full">
            <h3 className="text-xl font-bold text-brand-near-black mb-5">This IS for you if:</h3>
            <ul className="space-y-3">
              {isFor.map((t) => (
                <li key={t} className="flex gap-2.5 text-sm font-medium text-brand-near-black">
                  <Check className="size-4 shrink-0 mt-0.5" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
