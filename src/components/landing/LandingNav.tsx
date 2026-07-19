import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GroundworkLogo } from "@/components/ui/GroundworkLogo";

export default function LandingNav() {
  return (
    <motion.nav
      aria-label="Main navigation"
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="sticky top-0 z-50 bg-brand-near-black backdrop-blur-lg border-b border-white/10"
    >
      <div className="max-w-275 mx-auto px-4 sm:px-7 py-3.5 flex justify-between items-center">
        <GroundworkLogo variant="light" size="xl" linkTo="/" />
        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            asChild
            variant="ghost"
            className="hidden sm:inline-flex text-white/80 hover:text-white hover:bg-white/10 text-xs font-semibold px-4 rounded-md"
          >
            <a href="/contractor-apply">For Contractors</a>
          </Button>
          <Button asChild className="bg-white text-brand-near-black hover:bg-brand-off-white text-[11px] sm:text-xs font-semibold px-4 h-10 sm:h-auto sm:py-2 sm:px-6 rounded-md group">
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
