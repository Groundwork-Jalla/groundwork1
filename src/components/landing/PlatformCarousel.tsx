import { AnimatePresence, motion } from "framer-motion";
import { useCarousel } from "@/hooks/useCarousel";
import { Reveal } from "./Reveal";
import { CreateProjectSlide, UploadProofSlide, VerifySlide, PaymentSlide } from "./CarouselSlides";

const slides = [
  {
    Illustration: CreateProjectSlide,
    title: "Create a project",
    description: "Tell us what you're building. We break it into stages, substages, and set the budget from day one.",
  },
  {
    Illustration: UploadProofSlide,
    title: "Contractor submits evidence",
    description: "Photo and video evidence for every substage, captured directly on site.",
  },
  {
    Illustration: VerifySlide,
    title: "Jalla verifies the work",
    description: "An independent check confirms the stage's completion and quality before anything moves.",
  },
  {
    Illustration: PaymentSlide,
    title: "Payment gets sent out",
    description: "Funds release only once verification clears. No verification, no payment goes out.",
  },
];

export default function PlatformCarousel() {
  const [index, goTo] = useCarousel(slides.length, 6000);
  const slide = slides[index];

  return (
    <section className="py-20 max-w-[900px] mx-auto px-7">
      <Reveal className="text-center mb-10">
        <h2 className="font-['Playfair_Display'] text-3xl sm:text-4xl font-medium text-brand-near-black">
          How Groundwork Keeps You in Control
        </h2>
        <p className="text-brand-mid-grey mt-3">Step by Step</p>
      </Reveal>

      <div className="bg-brand-pale rounded-[20px] overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.06)]">
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
              <span className="block text-xs text-brand-mid-grey mt-3">Step {index + 1} of {slides.length}</span>
              <h3 className="font-['Playfair_Display'] text-[26px] text-brand-near-black mt-1">{slide.title}</h3>
              <p className="text-sm text-brand-mid-grey mt-3 leading-relaxed">{slide.description}</p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex justify-center gap-2 mt-6">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            aria-label={`Go to slide ${i + 1}`}
            className={`h-[10px] rounded-[5px] transition-all duration-300 ${
              i === index ? "w-[36px] bg-brand-near-black" : "w-[10px] bg-brand-border-grey"
            }`}
          />
        ))}
      </div>
    </section>
  );
}
