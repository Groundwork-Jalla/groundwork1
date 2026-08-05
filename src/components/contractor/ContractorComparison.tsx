import { motion } from "framer-motion";
import { X, Check } from "lucide-react";
import { Reveal } from "@/components/landing/Reveal";
import { useT, type TKey } from '@/lib/i18n';

const WITHOUT = [1, 2, 3, 4, 5] as const;
const WITH    = [1, 2, 3, 4, 5] as const;

export default function ContractorComparison() {
  const t = useT();
  return (
    <section className="bg-brand-off-white px-7 py-18">
      <div className="max-w-[750px] mx-auto">
        <Reveal className="text-center mb-9">
          <h2 className="font-sans text-2xl md:text-3xl font-bold text-brand-near-black">
            {t('contractorApply.comparisonTitle')}
          </h2>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Reveal direction="left">
            <motion.div whileHover={{ y: -3 }} className="bg-white rounded-2xl border border-brand-border-grey p-7 h-full">
              <h3 className="text-base font-bold text-brand-near-black mb-4">{t('contractorApply.withoutJalla')}</h3>
              <ul className="space-y-2.5">
                {WITHOUT.map((n) => (
                  <li key={n} className="flex gap-2 text-sm text-brand-mid-grey">
                    <X className="size-4 shrink-0 mt-0.5" />
                    {t(`contractorApply.without.w${n}` as TKey)}
                  </li>
                ))}
              </ul>
            </motion.div>
          </Reveal>

          <Reveal direction="right" delay={0.15}>
            <motion.div whileHover={{ y: -3 }} className="bg-brand-near-black rounded-2xl p-7 h-full">
              <h3 className="text-base font-bold text-white mb-4">{t('contractorApply.withJalla')}</h3>
              <ul className="space-y-2.5">
                {WITH.map((n) => (
                  <li key={n} className="flex gap-2 text-sm text-white/70">
                    <Check className="size-4 shrink-0 mt-0.5" />
                    {t(`contractorApply.with.w${n}` as TKey)}
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
