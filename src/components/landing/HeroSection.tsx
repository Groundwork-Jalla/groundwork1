import { motion } from "framer-motion";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import HeroScene from "./HeroScene";

// TODO: Update font-family to SFR font once Philip confirms the exact
// web font. Currently using Playfair Display as placeholder.
export default function HeroSection() {
  return (
    <section className="max-w-[1100px] mx-auto px-7 py-16 lg:py-24 flex flex-col lg:flex-row items-center gap-8 lg:gap-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="flex-1 max-w-[580px] w-full"
      >
        <h1 className="font-['Playfair_Display'] text-3xl lg:text-5xl font-medium leading-[1.1]">
          <span className="text-brand-near-black">Introducing the New Way of Building Back Home</span>{" "}
          <span className="text-brand-mid-grey italic font-normal">Without Losing Control.</span>
        </h1>
        <p className="mt-6 text-sm lg:text-base leading-relaxed text-brand-mid-grey max-w-[460px]">
          Groundwork by Jalla gives diaspora builders a structured and transparent way to fund, verify, and track
          construction back home. Every payment is tied to proof, every stage is independently verified for
          quality, and every penny is properly accounted for.
        </p>
        <motion.div
          className="mt-8 w-full sm:inline-block sm:w-auto rounded-lg"
          animate={{
            boxShadow: [
              "0 0 0 0 rgba(10,10,10,0.25)",
              "0 0 0 14px rgba(10,10,10,0)",
              "0 0 0 0 rgba(10,10,10,0.25)",
            ],
          }}
          transition={{ duration: 2.5, repeat: Infinity }}
        >
          <Button asChild className="w-full sm:w-auto bg-brand-near-black text-white text-sm font-semibold px-8 py-4 h-auto rounded-lg hover:bg-brand-black group">
            <Link to="/community" className="flex items-center justify-center gap-2">
              Join the Community — Free
              <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
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
