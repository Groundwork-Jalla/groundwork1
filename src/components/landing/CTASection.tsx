import { motion } from "framer-motion";
import { Link } from "react-router";
import { Home, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { useJoinDestination } from "@/hooks/useJoinDestination";

export default function CTASection() {
  const t = useT();
  const join    = useJoinDestination();
  const knownUs = join !== '/auth/signup';

  return (
    <section id="join" className="bg-brand-near-black py-20 text-center px-5 sm:px-7">
      <div className="max-w-140 mx-auto">
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="inline-flex text-white mb-3"
        >
          <Home className="size-9" />
        </motion.div>
        <p className="text-sm sm:text-base text-white/60 mt-8">
          {t('landing.cta.body')}
        </p>
        <p className="text-sm text-white/40 mt-2 italic">
          {t('landing.cta.sub')}
        </p>

        <Button asChild className="mt-8 w-full sm:w-auto bg-white text-brand-near-black font-bold text-sm px-8 h-auto py-4 hover:bg-brand-pale group">
          <Link to={join} className="flex items-center justify-center gap-1.5">
            {t('landing.signup.cta')}
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </Button>

        {/* Flips with the button above, for the reason given in HeroSection. */}
        <p className="mt-4 text-xs text-white/50">
          {t(knownUs ? 'landing.signup.newHere' : 'landing.signup.haveAccount')}{' '}
          <Link
            to={knownUs ? '/auth/signup' : '/auth/login'}
            className="font-semibold text-white underline underline-offset-4 hover:text-white/80"
          >
            {t(knownUs ? 'landing.signup.createAccount' : 'landing.signup.logIn')}
          </Link>
        </p>

        <div className="mt-4">
          <a
            href="/contractor-apply"
            className="text-xs sm:text-sm text-white/40 underline underline-offset-4 hover:text-white/70 transition-colors"
          >
            {t('landing.cta.contractorLink')}
          </a>
        </div>
      </div>
    </section>
  );
}
