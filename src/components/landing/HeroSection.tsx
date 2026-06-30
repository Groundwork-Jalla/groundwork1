import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import HeroScene from "./HeroScene";

export default function HeroSection() {
  return (
    <section className="bg-white">
      <div className="max-w-275 mx-auto px-7 py-16 lg:py-24 flex flex-col lg:flex-row items-center gap-8 lg:gap-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="flex-1 max-w-145 w-full"
        >
          <h1 className="font-sans text-3xl lg:text-5xl font-black leading-[1.1]">
            <span className="text-brand-near-black">Introducing the New Way of Building Back Home</span>{" "}
            <span className="text-brand-near-black/40 italic font-bold">Without Losing Control.</span>
          </h1>
          <p className="mt-6 text-sm lg:text-base leading-relaxed text-brand-mid-grey max-w-115">
            Groundwork by Jalla gives diaspora builders a structured and transparent way to fund, verify, and track
            construction back home. Every payment is tied to proof, every stage is independently verified for
            quality, and every penny is properly accounted for.
          </p>
          <motion.div
            className="mt-8 w-full sm:inline-block sm:w-auto rounded-lg"
            animate={{
              boxShadow: [
                "0 0 0 0 rgba(10,10,10,0.12)",
                "0 0 0 14px rgba(10,10,10,0)",
                "0 0 0 0 rgba(10,10,10,0.12)",
              ],
            }}
            transition={{ duration: 2.5, repeat: Infinity }}
          >
            <Button asChild className="w-full sm:w-auto bg-brand-near-black text-white text-sm font-semibold px-8 py-4 h-auto rounded-lg hover:bg-brand-black group">
              <a href="/community" className="flex items-center justify-center gap-2">
                Join for Free
                <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
              </a>
            </Button>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut", delay: 0.15 }}
          className="flex-1 w-full max-w-140"
        >
          <HeroScene />
        </motion.div>
      </div>
    </section>
  );
}
