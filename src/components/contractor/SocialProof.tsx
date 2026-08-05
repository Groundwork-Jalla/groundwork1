import { Quote } from "lucide-react";
import { Reveal } from "@/components/landing/Reveal";
import { useT, type TKey } from '@/lib/i18n';

const QUOTES = [1, 2, 3] as const;

export default function SocialProof() {
  const t = useT();
  return (
    <section className="bg-white px-7 py-16">
      <div className="max-w-[900px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-5">
        {QUOTES.map((n, i) => (
          <Reveal key={n} delay={i * 0.15}>
            <div className="border border-brand-border-grey rounded-2xl p-6 h-full">
              <Quote className="size-6 text-brand-border-grey mb-2" />
              <p className="text-sm italic text-brand-mid-grey leading-relaxed">{t(`contractorApply.quotes.q${n}` as TKey)}</p>
              <span className="block text-xs text-brand-soft-grey mt-3">— {t('contractorApply.quotes.soon')}</span>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
