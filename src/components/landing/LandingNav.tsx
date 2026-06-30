import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LandingNav() {
  return (
    <motion.nav
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="sticky top-0 z-50 bg-[#D4D4D4]/95 backdrop-blur-lg border-b border-brand-border-grey"
    >
      <div className="max-w-[1100px] mx-auto px-4 sm:px-7 py-3.5 flex justify-between items-center">
        <div className="flex items-baseline gap-1.5">
          <span className="font-sans text-xl sm:text-[22px] font-semibold text-brand-near-black">Groundwork</span>
          <span className="text-[11px] sm:text-sm text-brand-mid-grey">by Jalla</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            asChild
            variant="ghost"
            className="hidden sm:inline-flex text-brand-near-black hover:bg-brand-light-grey text-xs font-semibold px-4 rounded-md"
          >
            <a href="/contractor-apply">For Contractors</a>
          </Button>
          <Button asChild className="bg-brand-near-black text-white hover:bg-brand-black text-[11px] sm:text-xs font-semibold px-4 py-2 sm:px-6 rounded-md group">
            <a href="/community" className="flex items-center gap-1.5">
              Join for Free
              <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </a>
          </Button>
        </div>
      </div>
    </motion.nav>
  );
}
