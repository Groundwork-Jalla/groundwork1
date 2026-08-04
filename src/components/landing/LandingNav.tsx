import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GroundworkLogo } from "@/components/ui/GroundworkLogo";
import { LanguageToggle } from "@/components/ui/LanguageToggle";
import { useT } from "@/lib/i18n";

export default function LandingNav() {
  const t = useT();

  return (
    <motion.nav
      aria-label={t('nav.mainNavigation')}
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="sticky top-0 z-50 bg-brand-near-black backdrop-blur-lg border-b border-white/10"
    >
      <div className="max-w-275 mx-auto px-4 sm:px-7 py-3.5 flex justify-between items-center">
        <GroundworkLogo variant="light" size="xl" linkTo="/" />
        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageToggle segmented onDark />
          {/* Contractor entry point.
              Previously `hidden sm:inline-flex` + ghost — invisible on mobile and reading as a
              footnote, so the contractor page was effectively only reachable via the footer.
              Now a bordered button at every width. `variant="outline"` assumes a light
              background, so the dark-bar colours are set here rather than in the variant. */}
          <Button
            asChild
            variant="outline"
            className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white text-[11px] sm:text-xs font-semibold px-3 sm:px-4 h-10 sm:h-auto sm:py-2 rounded-md"
          >
            <a href="/contractor-apply">
              {/* Full label from sm up; short one below it so both CTAs fit at 375px. */}
              <span className="hidden sm:inline">{t('landing.nav.forContractors')}</span>
              <span className="sm:hidden">{t('landing.nav.forContractorsShort')}</span>
            </a>
          </Button>
          <Button asChild className="bg-white text-brand-near-black hover:bg-brand-off-white text-[11px] sm:text-xs font-semibold px-4 h-10 sm:h-auto sm:py-2 sm:px-6 rounded-md group">
            <a href="/community" className="flex items-center gap-1.5">
              {t('landing.nav.joinFree')}
              <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </a>
          </Button>
        </div>
      </div>
    </motion.nav>
  );
}
