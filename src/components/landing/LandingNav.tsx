import { motion } from "framer-motion";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LandingNav() {
  return (
    <motion.nav
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="sticky top-0 z-50 bg-white/92 backdrop-blur-lg border-b border-brand-border-grey"
    >
      <div className="max-w-[1100px] mx-auto px-4 sm:px-7 py-3.5 flex justify-between items-center">
        <div className="flex items-baseline gap-2">
          <span className="font-['Playfair_Display'] text-xl sm:text-[26px] font-semibold text-brand-near-black">Jalla</span>
          <span className="text-[10px] text-brand-mid-grey tracking-[0.12em]">THE FIRM</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            asChild
            variant="ghost"
            className="hidden sm:inline-flex text-brand-near-black hover:bg-brand-light-grey text-xs font-semibold px-4 rounded-md"
          >
            <a href="/contractor-apply">For Contractors</a>
          </Button>
          <Link
            to="/auth/login"
            className="text-[11px] sm:text-xs text-brand-mid-grey hover:text-brand-near-black transition-colors font-medium"
          >
            Log In
          </Link>
          <Button asChild className="bg-brand-near-black text-white hover:bg-brand-black text-[11px] sm:text-xs font-semibold px-4 py-2 sm:px-6 rounded-md group">
            <Link to="/auth/signup" className="flex items-center gap-1.5">
              Join Free
              <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </Button>
        </div>
      </div>
    </motion.nav>
  );
}
