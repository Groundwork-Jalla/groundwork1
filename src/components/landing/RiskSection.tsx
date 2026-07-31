import { motion } from "framer-motion";
import { useT, type TKey } from "@/lib/i18n";
import { Reveal } from "./Reveal";
import LossCounter from "./LossCounter";
import {
  MoneyLeakScene,
  NoMilestonesScene,
  NoVerificationScene,
  NoProofScene,
  DelaysScene,
  MisalignedScene,
} from "./RiskScenes";

const risks: { Scene: () => React.ReactElement; titleKey: TKey; descKey: TKey; statKey: TKey; labelKey: TKey }[] = [
  { Scene: MoneyLeakScene,       titleKey: "landing.risk.r1Title", descKey: "landing.risk.r1Desc", statKey: "landing.risk.r1Stat", labelKey: "landing.risk.r1Label" },
  { Scene: NoMilestonesScene,    titleKey: "landing.risk.r2Title", descKey: "landing.risk.r2Desc", statKey: "landing.risk.r2Stat", labelKey: "landing.risk.r2Label" },
  { Scene: NoVerificationScene,  titleKey: "landing.risk.r3Title", descKey: "landing.risk.r3Desc", statKey: "landing.risk.r3Stat", labelKey: "landing.risk.r3Label" },
  { Scene: NoProofScene,         titleKey: "landing.risk.r4Title", descKey: "landing.risk.r4Desc", statKey: "landing.risk.r4Stat", labelKey: "landing.risk.r4Label" },
  { Scene: DelaysScene,          titleKey: "landing.risk.r5Title", descKey: "landing.risk.r5Desc", statKey: "landing.risk.r5Stat", labelKey: "landing.risk.r5Label" },
  { Scene: MisalignedScene,      titleKey: "landing.risk.r6Title", descKey: "landing.risk.r6Desc", statKey: "landing.risk.r6Stat", labelKey: "landing.risk.r6Label" },
];

export default function RiskSection() {
  const t = useT();

  return (
    <section className="bg-white px-7 py-16 border-t border-brand-border-grey">
      <div className="max-w-[1000px] mx-auto">
      <Reveal className="text-center mb-16">
        <h2 className="font-sans text-3xl sm:text-4xl lg:text-5xl font-bold text-brand-near-black">
          {t('landing.risk.title')}
        </h2>
        <p className="text-brand-mid-grey mt-4 max-w-[500px] mx-auto text-base">
          {t('landing.risk.subtitle')}
        </p>
      </Reveal>

      <div className="flex flex-col gap-7">
        {risks.map(({ Scene, titleKey, descKey, statKey, labelKey }, i) => {
          const illustrationFirst = i % 2 === 0;
          return (
            <Reveal key={titleKey} direction={illustrationFirst ? "left" : "right"} delay={i * 0.1}>
              <motion.div
                whileHover={{ y: -4 }}
                className={`group bg-white rounded-2xl border border-brand-border-grey overflow-hidden flex flex-col shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_16px_40px_rgba(0,0,0,0.08)] transition-shadow duration-300 ${
                  illustrationFirst ? "md:flex-row" : "md:flex-row-reverse"
                }`}
              >
                <div className="relative bg-brand-off-white p-6 sm:p-9 flex items-center justify-center md:w-[320px] shrink-0 overflow-hidden">
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                    style={{
                      backgroundImage: "radial-gradient(circle, rgba(10,10,10,0.07) 1px, transparent 1px)",
                      backgroundSize: "14px 14px",
                    }}
                  />
                  <div className="relative w-full max-w-[260px]">
                    <Scene />
                  </div>
                </div>
                <div className="flex-1 p-6 sm:p-9 flex flex-col justify-center">
                  <div className="flex items-baseline gap-4">
                    <span className="font-sans text-3xl sm:text-5xl text-brand-border-grey leading-none">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-lg font-bold text-brand-near-black">{t(titleKey)}</h3>
                  </div>
                  <p className="text-sm text-brand-mid-grey mt-2 leading-relaxed">{t(descKey)}</p>
                  <div className="inline-flex items-center gap-2.5 bg-brand-near-black rounded-full px-4 py-2 mt-4 self-start">
                    <span className="font-sans text-xl font-bold text-white">{t(statKey)}</span>
                    <span className="text-xs text-white/60">{t(labelKey)}</span>
                  </div>
                </div>
              </motion.div>
            </Reveal>
          );
        })}
      </div>

      <p className="italic text-center text-brand-mid-grey mt-12 text-lg">
        {t('landing.risk.footer')}
      </p>
      <LossCounter />
      </div>
    </section>
  );
}
