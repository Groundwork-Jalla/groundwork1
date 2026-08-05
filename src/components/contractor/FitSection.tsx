import { Check, X } from "lucide-react";
import { Reveal } from "@/components/landing/Reveal";
import { useT, type TKey } from '@/lib/i18n';

const NOT_FOR = [1, 2, 3, 4] as const;
const IS_FOR  = [1, 2, 3, 4] as const;

export default function FitSection() {
  const t = useT();
  return (
    <section className="bg-brand-off-white px-7 py-18">
      <div className="max-w-[900px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-5">
        <Reveal direction="left">
          <div className="bg-brand-near-black rounded-2xl p-8 md:p-10 h-full">
            <h3 className="text-xl font-bold text-white/40 mb-5">{t('contractorApply.notForYou')}</h3>
            <ul className="space-y-3">
              {NOT_FOR.map((n) => (
                <li key={n} className="flex gap-2.5 text-sm text-white/30 line-through">
                  <X className="size-4 shrink-0 mt-0.5" />
                  <span>{t(`contractorApply.notFor.n${n}` as TKey)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
        <Reveal direction="right" delay={0.15}>
          <div className="bg-white rounded-2xl border border-brand-border-grey p-8 md:p-10 h-full">
            <h3 className="text-xl font-bold text-brand-near-black mb-5">{t('contractorApply.isForYou')}</h3>
            <ul className="space-y-3">
              {IS_FOR.map((n) => (
                <li key={n} className="flex gap-2.5 text-sm font-medium text-brand-near-black">
                  <Check className="size-4 shrink-0 mt-0.5" />
                  <span>{t(`contractorApply.isFor.i${n}` as TKey)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
