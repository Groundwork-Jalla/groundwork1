import { Quote } from "lucide-react";
import { Reveal } from "@/components/landing/Reveal";

const quotes = [
  "Completed multiple diaspora projects with clear milestones and on-time payment.",
  "Handled land verification end-to-end with clean documentation.",
  "Consistent pipeline without chasing clients.",
];

export default function SocialProof() {
  return (
    <section className="bg-white px-7 py-16">
      <div className="max-w-[900px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-5">
        {quotes.map((q, i) => (
          <Reveal key={q} delay={i * 0.15}>
            <div className="border border-brand-border-grey rounded-2xl p-6 h-full">
              <Quote className="size-6 text-brand-border-grey mb-2" />
              <p className="text-sm italic text-brand-mid-grey leading-relaxed">{q}</p>
              <span className="block text-xs text-brand-soft-grey mt-3">— Coming Soon</span>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
