import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import HeroScene from "./HeroScene";

export default function HeroSection() {
  return (
    <section className="max-w-[1100px] mx-auto px-7 py-16 lg:py-24 flex flex-col lg:flex-row items-center gap-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="flex-1 max-w-[580px]"
      >
        <h1 className="font-['Playfair_Display'] text-4xl lg:text-5xl font-medium leading-[1.1] lg:whitespace-nowrap">
          <span className="text-brand-near-black">Build Back Home.</span>
          <br />
          <span className="text-brand-mid-grey italic font-normal">Without Losing Control.</span>
        </h1>
        <p className="mt-6 text-base leading-relaxed text-brand-mid-grey max-w-[420px]">
          Jalla gives diaspora builders a structured way to fund, verify, and track
          construction back home — so every payment is tied to proof, not promises.
        </p>
        <motion.div
          className="mt-8 inline-block rounded-lg"
          animate={{
            boxShadow: [
              "0 0 0 0 rgba(10,10,10,0.25)",
              "0 0 0 14px rgba(10,10,10,0)",
              "0 0 0 0 rgba(10,10,10,0.25)",
            ],
          }}
          transition={{ duration: 2.5, repeat: Infinity }}
        >
          <Button asChild className="bg-brand-near-black text-white text-sm font-semibold px-8 py-4 h-auto rounded-lg hover:bg-brand-black">
            <a href="#join">Join the Community — Free</a>
          </Button>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: "easeOut", delay: 0.15 }}
        className="flex-1 w-full max-w-[560px]"
      >
        <HeroScene />
      </motion.div>
    </section>
  );
}
