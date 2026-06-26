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
    <section className="flex flex-col md:flex-row">
      <div className="flex-1 bg-brand-near-black px-7 md:px-10 py-14">
        <Reveal direction="left">
          <h3 className="text-xl font-bold text-white/40 mb-5">This is NOT for you if:</h3>
          <ul className="space-y-3">
            {notFor.map((t) => (
              <li key={t} className="flex gap-2.5 text-sm text-white/30 line-through">
                <X className="size-4 shrink-0 mt-0.5" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
      <div className="flex-1 bg-white px-7 md:px-10 py-14">
        <Reveal direction="right">
          <h3 className="text-xl font-bold text-brand-near-black mb-5">This IS for you if:</h3>
          <ul className="space-y-3">
            {isFor.map((t) => (
              <li key={t} className="flex gap-2.5 text-sm font-medium text-brand-near-black">
                <Check className="size-4 shrink-0 mt-0.5" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
