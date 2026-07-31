import { AnimatePresence, motion } from "framer-motion";
import { useCarousel } from "@/hooks/useCarousel";
import { useT, type TKey } from "@/lib/i18n";
import { Reveal } from "./Reveal";
import { CreateProjectSlide, UploadProofSlide, VerifySlide, PaymentSlide } from "./CarouselSlides";

const slides: { Illustration: () => React.ReactElement; titleKey: TKey; descKey: TKey }[] = [
  { Illustration: CreateProjectSlide, titleKey: "landing.carousel.s1Title", descKey: "landing.carousel.s1Desc" },
  { Illustration: UploadProofSlide,   titleKey: "landing.carousel.s2Title", descKey: "landing.carousel.s2Desc" },
  { Illustration: VerifySlide,        titleKey: "landing.carousel.s3Title", descKey: "landing.carousel.s3Desc" },
  { Illustration: PaymentSlide,       titleKey: "landing.carousel.s4Title", descKey: "landing.carousel.s4Desc" },
];

export default function PlatformCarousel() {
  const [index, goTo] = useCarousel(slides.length, 6000);
  const slide = slides[index];
  const t = useT();

  return (
    <section className="bg-brand-near-black py-20">
      <div className="max-w-[900px] mx-auto px-7">
        <Reveal className="text-center mb-10">
          <h2 className="font-sans text-3xl sm:text-4xl font-bold text-white">
            {t('landing.carousel.title')}
          </h2>
          <p className="text-white/50 mt-3">{t('landing.carousel.subtitle')}</p>
        </Reveal>

        <div className="bg-white rounded-[20px] overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.06)]">
          <AnimatePresence mode="wait">
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col lg:flex-row items-center"
            >
              <div className="flex-1 basis-full lg:basis-[440px] flex justify-center p-8">
                <slide.Illustration />
              </div>
              <div className="flex-1 basis-full lg:basis-[260px] p-6 lg:p-10">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-near-black text-white text-xs font-semibold">
                  {index + 1}
                </div>
                <span className="block text-xs text-brand-mid-grey mt-3">
                  {t('landing.carousel.step', { current: index + 1, total: slides.length })}
                </span>
                <h3 className="font-sans text-[26px] text-brand-near-black mt-1">{t(slide.titleKey)}</h3>
                <p className="text-sm text-brand-mid-grey mt-3 leading-relaxed">{t(slide.descKey)}</p>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex justify-center gap-2 mt-6">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={t('landing.carousel.goToSlide', { n: i + 1 })}
              className={`h-[10px] rounded-[5px] transition-all duration-300 ${
                i === index ? "w-[36px] bg-white" : "w-[10px] bg-white/25"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
