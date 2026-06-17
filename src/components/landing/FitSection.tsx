import { Check, X } from "lucide-react";
import { Reveal } from "./Reveal";

const fitFor = [
  "You're building or renovating from abroad",
  "You want payments tied to verified progress",
  "You need photo and video proof, not promises",
  "You want an independent check on the work",
  "You're serious about protecting your budget",
];

const notFor = [
  "You're fine paying on trust alone",
  "You don't want any oversight on your contractor",
  "You're not actively building right now",
];

export default function FitSection() {
  return (
    <section className="bg-brand-near-black py-16 text-white">
      <div className="max-w-[700px] mx-auto px-7 grid grid-cols-1 lg:grid-cols-2 gap-12">
        <Reveal>
          <h3 className="font-['Playfair_Display'] text-2xl mb-5">Jalla is for you if:</h3>
          <ul className="space-y-3">
            {fitFor.map((item) => (
              <li key={item} className="flex gap-2 text-sm text-white/80">
                <Check className="size-4 shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={0.2}>
          <h3 className="font-['Playfair_Display'] text-2xl mb-5 opacity-40">Not for:</h3>
          <ul className="space-y-3">
            {notFor.map((item) => (
              <li key={item} className="flex gap-2 text-sm text-white/25 line-through">
                <X className="size-4 shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="italic text-white/50 mt-6 text-sm">Serious builders only.</p>
        </Reveal>
      </div>
    </section>
  );
}
